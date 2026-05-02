import fs from "node:fs/promises";
import path from "node:path";

const TEMPLATE_AGENT_TEAM_ROOT = path.resolve(process.cwd(), "templates", "target-repo", ".agent-team");

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
    if (await exists(file.target)) continue;
    await fs.mkdir(path.dirname(file.target), { recursive: true });
    await fs.copyFile(file.source, file.target);
    if (file.mode && process.platform !== "win32") {
      await fs.chmod(file.target, file.mode);
    }
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
