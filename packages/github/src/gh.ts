import childProcess from "node:child_process";
import util from "node:util";
import { githubAuthEnv } from "../../shared/src";

const execFile = util.promisify(childProcess.execFile);

export interface GhExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
}

export interface GhExecResult {
  stdout: string;
  stderr: string;
}

export type GhExec = (args: readonly string[], options: GhExecOptions) => Promise<GhExecResult>;

export interface GhCommandOptions extends GhExecOptions {
  exec?: GhExec;
}

export interface GhWorkflowRun {
  status: string;
  conclusion: string;
  url: string;
  workflowName: string;
  headSha: string;
}

export interface GhPullRequest {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  mergeStateStatus: string;
  reviewDecision: string;
  headRefName: string;
  headRefOid: string;
  url: string;
}

export interface GhRelease {
  tagName: string;
  name: string;
  isDraft: boolean;
  isPrerelease: boolean;
  url: string;
  targetCommitish: string;
  publishedAt: string;
}

export async function listWorkflowRuns(input: {
  repo: string;
  branch?: string;
  limit?: number;
  options?: GhCommandOptions;
}): Promise<GhWorkflowRun[]> {
  const args = [
    "run",
    "list",
    "--repo",
    input.repo,
    ...(input.branch ? ["--branch", input.branch] : []),
    "--limit",
    String(input.limit ?? 1),
    "--json",
    "status,conclusion,url,workflowName,headSha"
  ];
  const runs = await runGhJson<unknown>(args, input.options, "gh run list");
  if (!Array.isArray(runs)) {
    throw new Error("gh run list returned JSON that is not an array.");
  }
  return runs.map((run) => {
    const value = objectRecord(run, "gh run list item");
    return {
      status: stringField(value, "status", "unknown"),
      conclusion: stringField(value, "conclusion", "unknown"),
      url: stringField(value, "url", ""),
      workflowName: stringField(value, "workflowName", ""),
      headSha: stringField(value, "headSha", "")
    };
  });
}

export async function viewPullRequest(input: {
  repo: string;
  pullNumber: number;
  options?: GhCommandOptions;
}): Promise<GhPullRequest> {
  const pull = objectRecord(
    await runGhJson<unknown>(
      [
        "pr",
        "view",
        String(input.pullNumber),
        "--repo",
        input.repo,
        "--json",
        "number,title,state,isDraft,mergeStateStatus,reviewDecision,headRefName,headRefOid,url"
      ],
      input.options,
      "gh pr view"
    ),
    "gh pr view"
  );
  return {
    number: numberField(pull, "number"),
    title: stringField(pull, "title", ""),
    state: stringField(pull, "state", ""),
    isDraft: booleanField(pull, "isDraft"),
    mergeStateStatus: stringField(pull, "mergeStateStatus", ""),
    reviewDecision: stringField(pull, "reviewDecision", ""),
    headRefName: stringField(pull, "headRefName", ""),
    headRefOid: stringField(pull, "headRefOid", ""),
    url: stringField(pull, "url", "")
  };
}

export async function viewRelease(input: {
  repo: string;
  tag: string;
  options?: GhCommandOptions;
}): Promise<GhRelease> {
  const release = objectRecord(
    await runGhJson<unknown>(
      [
        "release",
        "view",
        input.tag,
        "--repo",
        input.repo,
        "--json",
        "tagName,name,isDraft,isPrerelease,url,targetCommitish,publishedAt"
      ],
      input.options,
      "gh release view"
    ),
    "gh release view"
  );
  return {
    tagName: stringField(release, "tagName", ""),
    name: stringField(release, "name", ""),
    isDraft: booleanField(release, "isDraft"),
    isPrerelease: booleanField(release, "isPrerelease"),
    url: stringField(release, "url", ""),
    targetCommitish: stringField(release, "targetCommitish", ""),
    publishedAt: stringField(release, "publishedAt", "")
  };
}

async function runGhJson<T>(args: readonly string[], options: GhCommandOptions | undefined, label: string): Promise<T> {
  const result = await runGh(args, options);
  const stdout = result.stdout.trim() || "null";
  try {
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runGh(args: readonly string[], options: GhCommandOptions = {}): Promise<GhExecResult> {
  const runner = options.exec ?? defaultGhExec;
  return runner(args, {
    cwd: options.cwd,
    env: githubAuthEnv(options.env),
    timeout: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024
  });
}

async function defaultGhExec(args: readonly string[], options: GhExecOptions): Promise<GhExecResult> {
  const result = await execFile("gh", [...args], {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned JSON that is not an object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string, fallback: string): string {
  const field = value[key];
  return typeof field === "string" ? field : fallback;
}

function numberField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number") throw new Error(`Expected numeric ${key} in gh JSON output.`);
  return field;
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}
