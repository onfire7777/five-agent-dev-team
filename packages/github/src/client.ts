import { Octokit } from "@octokit/rest";
import { AGENT_LABELS, nextLabelForStage, type WorkItemState } from "../../shared/src";

export interface GitHubTarget {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface PullRequestInput {
  title: string;
  body: string;
  head: string;
  base?: string;
}

export class GitHubAutomationClient {
  private octokit: Octokit;
  private target: GitHubTarget;

  constructor(token: string, target: GitHubTarget) {
    this.octokit = new Octokit({ auth: token });
    this.target = target;
  }

  async claimIssue(issueNumber: number): Promise<void> {
    await this.octokit.issues.addLabels({
      owner: this.target.owner,
      repo: this.target.repo,
      issue_number: issueNumber,
      labels: [AGENT_LABELS.claimed]
    });
  }

  async setStageLabel(issueNumber: number, stage: WorkItemState): Promise<void> {
    const label = nextLabelForStage(stage);
    await this.octokit.issues.addLabels({
      owner: this.target.owner,
      repo: this.target.repo,
      issue_number: issueNumber,
      labels: [label]
    });
  }

  async createOrUpdatePullRequest(input: PullRequestInput): Promise<number> {
    const pulls = await this.octokit.pulls.list({
      owner: this.target.owner,
      repo: this.target.repo,
      head: `${this.target.owner}:${input.head}`,
      state: "open"
    });

    if (pulls.data[0]) {
      await this.octokit.pulls.update({
        owner: this.target.owner,
        repo: this.target.repo,
        pull_number: pulls.data[0].number,
        title: input.title,
        body: input.body
      });
      return pulls.data[0].number;
    }

    const created = await this.octokit.pulls.create({
      owner: this.target.owner,
      repo: this.target.repo,
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base || this.target.defaultBranch
    });
    return created.data.number;
  }

  async getCombinedCheckStatus(ref: string): Promise<"passed" | "pending" | "failed"> {
    const runs = await this.octokit.checks.listForRef({
      owner: this.target.owner,
      repo: this.target.repo,
      ref
    });
    if (runs.data.check_runs.length === 0) return "pending";
    if (runs.data.check_runs.some((run) => run.status !== "completed")) return "pending";
    if (runs.data.check_runs.every((run) => run.conclusion === "success" || run.conclusion === "skipped")) {
      return "passed";
    }
    return "failed";
  }

  async mergePullRequest(pullNumber: number): Promise<string> {
    const result = await this.octokit.pulls.merge({
      owner: this.target.owner,
      repo: this.target.repo,
      pull_number: pullNumber,
      merge_method: "squash"
    });
    return result.data.sha;
  }

  async createReleaseTag(tag: string, targetCommitish: string, body: string): Promise<string> {
    const result = await this.octokit.repos.createRelease({
      owner: this.target.owner,
      repo: this.target.repo,
      tag_name: tag,
      target_commitish: targetCommitish,
      name: tag,
      body,
      draft: false,
      prerelease: false
    });
    return result.data.html_url;
  }
}

