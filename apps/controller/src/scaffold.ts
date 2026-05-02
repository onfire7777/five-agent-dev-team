import { constants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const TEMPLATE_AGENT_TEAM_ROOT = resolveTemplateRoot();

type ScaffoldFile = {
  source: string;
  target: string;
  mode?: number;
};

export async function scaffoldAgentTeam(localPath: string): Promise<void> {
  if (!localPath) return;
  const repoStat = await fs.stat(localPath).catch(() => null);
  if (!repoStat?.isDirectory()) return;

  const targetRoot = path.join(localPath, ".agent-team");
  const files: ScaffoldFile[] = [
    {
      source: path.join(TEMPLATE_AGENT_TEAM_ROOT, "context", "TEAM_RULES.md"),
      target: path.join(targetRoot, "context", "TEAM_RULES.md")
    },
    {
      source: path.join(TEMPLATE_AGENT_TEAM_ROOT, "hooks", "pre-push"),
      target: path.join(targetRoot, "hooks", "pre-push"),
      mode: 0o755
    }
  ];

  for (const file of files) {
    await fs.mkdir(path.dirname(file.target), { recursive: true });
    try {
      await fs.copyFile(file.source, file.target, constants.COPYFILE_EXCL);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") continue;
      throw error;
    }
    if (file.mode && process.platform !== "win32") {
      await fs.chmod(file.target, file.mode);
    }
  }
}

function resolveTemplateRoot(): string {
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", "templates", "target-repo", ".agent-team"),
    path.resolve(__dirname, "..", "..", "..", "..", "templates", "target-repo", ".agent-team")
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
