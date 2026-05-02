import { afterEach, describe, expect, it } from "vitest";
import {
  buildGitHubMcpStdioConfig,
  listWorkflowRuns,
  viewPullRequest,
  viewRelease,
  type GhExec,
  type GhExecOptions
} from "../packages/github/src";

const originalGithubToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  if (originalGithubToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalGithubToken;
  }
});

describe("GitHub CLI helpers", () => {
  it("lists workflow runs with typed parsing and GitHub auth environment", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const calls: Array<{ args: readonly string[]; options: GhExecOptions }> = [];
    const exec: GhExec = async (args, options) => {
      calls.push({ args: [...args], options });
      return {
        stdout: JSON.stringify([
          {
            status: "completed",
            conclusion: "success",
            url: "https://github.com/owner/repo/actions/runs/1",
            workflowName: "CI",
            headSha: "abc123"
          }
        ]),
        stderr: ""
      };
    };

    const runs = await listWorkflowRuns({
      repo: "owner/repo",
      branch: "main",
      limit: 1,
      options: { cwd: "C:\\repo", exec }
    });

    expect(runs).toEqual([
      {
        status: "completed",
        conclusion: "success",
        url: "https://github.com/owner/repo/actions/runs/1",
        workflowName: "CI",
        headSha: "abc123"
      }
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      "run",
      "list",
      "--repo",
      "owner/repo",
      "--branch",
      "main",
      "--limit",
      "1",
      "--json",
      "status,conclusion,url,workflowName,headSha"
    ]);
    expect(calls[0].options.cwd).toBe("C:\\repo");
    expect(calls[0].options.env?.GITHUB_TOKEN).toBe("test-token");
  });

  it("views pull request and release metadata with typed fields", async () => {
    const exec: GhExec = async (args) => {
      if (args[0] === "pr") {
        return {
          stdout: JSON.stringify({
            number: 7,
            title: "Ready",
            state: "OPEN",
            isDraft: false,
            mergeStateStatus: "CLEAN",
            reviewDecision: "APPROVED",
            headRefName: "codex/test",
            headRefOid: "def456",
            url: "https://github.com/owner/repo/pull/7"
          }),
          stderr: ""
        };
      }
      return {
        stdout: JSON.stringify({
          tagName: "v1.0.0",
          name: "v1.0.0",
          isDraft: false,
          isPrerelease: false,
          url: "https://github.com/owner/repo/releases/tag/v1.0.0",
          targetCommitish: "main",
          publishedAt: "2026-05-02T00:00:00Z"
        }),
        stderr: ""
      };
    };

    await expect(viewPullRequest({ repo: "owner/repo", pullNumber: 7, options: { exec } })).resolves.toMatchObject({
      number: 7,
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED"
    });
    await expect(viewRelease({ repo: "owner/repo", tag: "v1.0.0", options: { exec } })).resolves.toMatchObject({
      tagName: "v1.0.0",
      targetCommitish: "main"
    });
  });

  it("reports invalid JSON from gh output with command context", async () => {
    const exec: GhExec = async () => ({ stdout: "{not-json", stderr: "" });

    await expect(listWorkflowRuns({ repo: "owner/repo", options: { exec } })).rejects.toThrow(
      /gh run list returned invalid JSON/
    );
  });

  it("fails fast when boolean gh fields drift from the expected schema", async () => {
    const exec: GhExec = async () => ({
      stdout: JSON.stringify({
        number: 7,
        title: "Ready",
        state: "OPEN",
        isDraft: "false",
        mergeStateStatus: "CLEAN",
        reviewDecision: "APPROVED",
        headRefName: "codex/test",
        headRefOid: "def456",
        url: "https://github.com/owner/repo/pull/7"
      }),
      stderr: ""
    });

    await expect(viewPullRequest({ repo: "owner/repo", pullNumber: 7, options: { exec } })).rejects.toThrow(
      /Expected boolean isDraft/
    );
  });
});

describe("GitHub MCP config", () => {
  it("builds read-only and write-capable stdio configs with env placeholders", () => {
    expect(buildGitHubMcpStdioConfig()).toMatchObject({
      name: "github-mcp",
      category: "github",
      transport: "stdio",
      command: "github-mcp-server",
      args: ["stdio", "--read-only"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
        GITHUB_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    });

    expect(
      buildGitHubMcpStdioConfig({ readOnly: false, tokenEnv: "GITHUB_TOKEN", extraArgs: ["--toolsets", "repos"] })
    ).toMatchObject({
      args: ["stdio", "--toolsets", "repos"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
        GITHUB_TOKEN: "${GITHUB_TOKEN}"
      }
    });
  });
});
