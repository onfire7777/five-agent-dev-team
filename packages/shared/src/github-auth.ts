import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const GitHubStoredAuthSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.string().default("bearer"),
  scope: z.string().default(""),
  login: z.string().optional(),
  name: z.string().nullable().optional(),
  avatarUrl: z.string().url().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export type GitHubStoredAuth = z.infer<typeof GitHubStoredAuthSchema>;
export type GitHubStoredAuthInput = z.input<typeof GitHubStoredAuthSchema>;

export type GitHubTokenSource =
  | { source: "env"; sourceName: "GITHUB_PERSONAL_ACCESS_TOKEN" | "GH_TOKEN" | "GITHUB_TOKEN"; token: string }
  | { source: "local"; sourceName: "dashboard"; token: string; auth: GitHubStoredAuth };

export function githubAuthFilePath(): string {
  return path.resolve(process.env.AGENT_TEAM_GITHUB_AUTH_FILE || ".agent-team/github-auth.json");
}

export function readStoredGitHubAuthSync(): GitHubStoredAuth | null {
  try {
    const raw = fs.readFileSync(githubAuthFilePath(), "utf8");
    return GitHubStoredAuthSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function readStoredGitHubAuth(): Promise<GitHubStoredAuth | null> {
  try {
    const raw = await fsp.readFile(githubAuthFilePath(), "utf8");
    return GitHubStoredAuthSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeStoredGitHubAuth(input: GitHubStoredAuthInput): Promise<GitHubStoredAuth> {
  const now = new Date().toISOString();
  const auth = GitHubStoredAuthSchema.parse({
    ...input,
    createdAt: input.createdAt || now,
    updatedAt: now
  });
  const filePath = githubAuthFilePath();
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return auth;
}

export async function deleteStoredGitHubAuth(): Promise<void> {
  await fsp.rm(githubAuthFilePath(), { force: true });
}

export function githubTokenSource(): GitHubTokenSource | null {
  if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    return { source: "env", sourceName: "GITHUB_PERSONAL_ACCESS_TOKEN", token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN };
  }
  if (process.env.GH_TOKEN) {
    return { source: "env", sourceName: "GH_TOKEN", token: process.env.GH_TOKEN };
  }
  if (process.env.GITHUB_TOKEN) {
    return { source: "env", sourceName: "GITHUB_TOKEN", token: process.env.GITHUB_TOKEN };
  }
  const auth = readStoredGitHubAuthSync();
  return auth ? { source: "local", sourceName: "dashboard", token: auth.accessToken, auth } : null;
}

export function githubToken(): string {
  return githubTokenSource()?.token || "";
}

export function githubAuthEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const token = githubToken();
  if (!token) return { ...base };
  return {
    ...base,
    GH_TOKEN: base.GH_TOKEN || token,
    GITHUB_TOKEN: base.GITHUB_TOKEN || token,
    GITHUB_PERSONAL_ACCESS_TOKEN: base.GITHUB_PERSONAL_ACCESS_TOKEN || token
  };
}
