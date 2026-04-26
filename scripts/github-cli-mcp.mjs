#!/usr/bin/env node
import childProcess from "node:child_process";
import readline from "node:readline";
import util from "node:util";

const execFile = util.promisify(childProcess.execFile);

const tools = [
  {
    name: "github_repo_status",
    description: "Read GitHub repository, local remote, auth, and latest Actions status through GitHub CLI and git.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        localPath: { type: "string" },
        branch: { type: "string" }
      },
      required: ["owner", "repo", "localPath"]
    }
  },
  {
    name: "github_issue_list",
    description: "List GitHub issues for a connected repository using gh issue list.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"] },
        limit: { type: "number" }
      },
      required: ["owner", "repo"]
    }
  },
  {
    name: "github_pr_list",
    description: "List GitHub pull requests for a connected repository using gh pr list.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "merged", "all"] },
        limit: { type: "number" }
      },
      required: ["owner", "repo"]
    }
  },
  {
    name: "github_actions_latest",
    description: "Read the latest GitHub Actions runs for a connected repository and branch.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        branch: { type: "string" },
        limit: { type: "number" }
      },
      required: ["owner", "repo"]
    }
  }
];

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const response = await handleMessage(message).catch((error) => ({
    jsonrpc: "2.0",
    id: message.id ?? null,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error)
    }
  }));
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
});

async function handleMessage(message) {
  if (message.method === "notifications/initialized") return null;
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "five-agent-github-cli-mcp", version: "0.1.0" }
      }
    };
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: { tools }
    };
  }
  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params || {};
    const result = await callTool(name, args);
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      }
    };
  }
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `Unsupported method: ${message.method}` }
  };
}

async function callTool(name, args) {
  if (name === "github_repo_status") return githubRepoStatus(args);
  if (name === "github_issue_list") return ghJson(["issue", "list", "--repo", repoArg(args), "--state", stateArg(args.state, ["open", "closed", "all"], "open"), "--limit", limitArg(args.limit), "--json", "number,title,state,labels,assignees,url,updatedAt"]);
  if (name === "github_pr_list") return ghJson(["pr", "list", "--repo", repoArg(args), "--state", stateArg(args.state, ["open", "closed", "merged", "all"], "open"), "--limit", limitArg(args.limit), "--json", "number,title,state,headRefName,baseRefName,isDraft,url,updatedAt"]);
  if (name === "github_actions_latest") {
    const branch = safeRef(args.branch || "");
    const branchArgs = branch ? ["--branch", branch] : [];
    return ghJson(["run", "list", "--repo", repoArg(args), ...branchArgs, "--limit", limitArg(args.limit), "--json", "status,conclusion,url,workflowName,headSha,createdAt,updatedAt"]);
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function githubRepoStatus(args) {
  const localPath = String(args.localPath || process.cwd());
  const branch = safeRef(args.branch || "main");
  const [remote, ghAuth, repoView, actions] = await Promise.all([
    run("git", ["remote", "get-url", "origin"], localPath),
    run("gh", ["auth", "status", "--hostname", "github.com"], localPath),
    run("gh", ["repo", "view", repoArg(args), "--json", "name,owner,url,defaultBranchRef"], localPath),
    run("gh", ["run", "list", "--repo", repoArg(args), "--branch", branch, "--limit", "1", "--json", "status,conclusion,url,workflowName,headSha"], localPath)
  ]);
  return {
    localPath,
    repo: repoArg(args),
    branch,
    remoteUrl: remote.stdout.trim(),
    ghAuthed: ghAuth.ok || Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN),
    repoView: parseJson(repoView.stdout),
    latestActions: parseJson(actions.stdout),
    diagnostics: [remote, ghAuth, repoView, actions].filter((item) => !item.ok).map((item) => item.stderr || item.stdout)
  };
}

async function ghJson(args) {
  const result = await run("gh", args, process.cwd());
  if (!result.ok) throw new Error(result.stderr || result.stdout || "gh command failed");
  return parseJson(result.stdout);
}

async function run(command, args, cwd) {
  try {
    const result = await execFile(command, args, {
      cwd,
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || error.message || "")
    };
  }
}

function repoArg(args) {
  const owner = safeName(args.owner, "owner");
  const repo = safeName(args.repo, "repo");
  return `${owner}/${repo}`;
}

function stateArg(value, allowed, fallback) {
  const state = String(value || fallback);
  return allowed.includes(state) ? state : fallback;
}

function limitArg(value) {
  const parsed = Number(value || 20);
  return String(Math.min(Math.max(Number.isFinite(parsed) ? Math.floor(parsed) : 20, 1), 100));
}

function safeName(value, label) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_.-]+$/.test(text)) throw new Error(`Invalid GitHub ${label}.`);
  return text;
}

function safeRef(value) {
  const text = String(value || "");
  if (!text) return "";
  if (!/^[A-Za-z0-9._/-]+$/.test(text)) throw new Error("Invalid git ref.");
  return text;
}

function parseJson(raw) {
  try {
    return JSON.parse(raw || "null");
  } catch {
    return raw;
  }
}
