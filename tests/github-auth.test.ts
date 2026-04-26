import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteStoredGitHubAuth,
  githubAuthEnv,
  githubAuthFilePath,
  githubToken,
  githubTokenSource,
  readStoredGitHubAuth,
  writeStoredGitHubAuth
} from "../packages/shared/src";

const originalEnv = {
  AGENT_TEAM_GITHUB_AUTH_FILE: process.env.AGENT_TEAM_GITHUB_AUTH_FILE,
  GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN
};

function restoreEnv(): void {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function clearGitHubEnv(): void {
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
}

describe("github auth helpers", () => {
  beforeEach(() => {
    process.env.AGENT_TEAM_GITHUB_AUTH_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-auth-")), "github-auth.json");
    clearGitHubEnv();
  });

  afterEach(async () => {
    await deleteStoredGitHubAuth();
    restoreEnv();
  });

  it("prefers env tokens in least-surprising order", () => {
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = "personal";
    process.env.GH_TOKEN = "gh";
    process.env.GITHUB_TOKEN = "github";

    expect(githubToken()).toBe("personal");
    expect(githubTokenSource()).toMatchObject({
      source: "env",
      sourceName: "GITHUB_PERSONAL_ACCESS_TOKEN"
    });
  });

  it("persists a dashboard-managed token outside git-tracked config", async () => {
    const authFile = process.env.AGENT_TEAM_GITHUB_AUTH_FILE || "";

    await writeStoredGitHubAuth({
      accessToken: "dashboard-token",
      scope: "repo,workflow",
      login: "octo"
    });

    expect(githubAuthFilePath()).toBe(authFile);
    expect(await readStoredGitHubAuth()).toMatchObject({
      accessToken: "dashboard-token",
      scope: "repo,workflow",
      login: "octo"
    });
    expect(githubToken()).toBe("dashboard-token");
    expect(githubTokenSource()).toMatchObject({
      source: "local",
      sourceName: "dashboard"
    });

    await deleteStoredGitHubAuth();
    expect(await readStoredGitHubAuth()).toBeNull();
  });

  it("injects the active token for GitHub CLI, SDK, and MCP without overwriting explicit env", async () => {
    await writeStoredGitHubAuth({
      accessToken: "dashboard-token",
      scope: "repo",
      login: "octo"
    });

    expect(githubAuthEnv({ PATH: "x" } as NodeJS.ProcessEnv)).toMatchObject({
      PATH: "x",
      GH_TOKEN: "dashboard-token",
      GITHUB_TOKEN: "dashboard-token",
      GITHUB_PERSONAL_ACCESS_TOKEN: "dashboard-token"
    });
    expect(githubAuthEnv({ GH_TOKEN: "explicit" } as NodeJS.ProcessEnv)).toMatchObject({
      GH_TOKEN: "explicit",
      GITHUB_TOKEN: "dashboard-token",
      GITHUB_PERSONAL_ACCESS_TOKEN: "dashboard-token"
    });
  });
});
