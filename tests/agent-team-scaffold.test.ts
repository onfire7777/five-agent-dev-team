import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldAgentTeam } from "../apps/controller/src/scaffold";

describe("agent-team scaffolding", () => {
  it("creates missing files without overwriting existing ones", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-team-"));
    const repo = join(root, "repo");
    const templateRoot = join(process.cwd(), "templates", "target-repo", ".agent-team");
    const templateRules = join(templateRoot, "context", "TEAM_RULES.md");
    const templateHook = join(templateRoot, "hooks", "pre-push");
    const targetRules = join(repo, ".agent-team", "context", "TEAM_RULES.md");
    const targetHook = join(repo, ".agent-team", "hooks", "pre-push");

    try {
      mkdirSync(repo, { recursive: true });
      await scaffoldAgentTeam(repo);

      expect(readFileSync(targetRules, "utf8")).toBe(readFileSync(templateRules, "utf8"));
      expect(readFileSync(targetHook, "utf8")).toBe(readFileSync(templateHook, "utf8"));

      if (process.platform !== "win32") {
        expect(statSync(targetHook).mode & 0o777).toBe(0o755);
      }

      writeFileSync(targetRules, "custom rules\n", "utf8");
      writeFileSync(targetHook, "custom hook\n", "utf8");

      await scaffoldAgentTeam(repo);

      expect(readFileSync(targetRules, "utf8")).toBe("custom rules\n");
      expect(readFileSync(targetHook, "utf8")).toBe("custom hook\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
