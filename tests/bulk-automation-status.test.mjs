import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts", "bulk-automation-status.mjs");
const automationIds = [
  "research-five-agent-dev-team-feature-pipeline",
  "build-five-agent-dev-team-backend-core",
  "build-five-agent-dev-team-frontend-ux",
  "build-five-agent-dev-team-quality-debug",
  "build-five-agent-dev-team-security-devops",
  "build-five-agent-dev-team-docs-alignment",
  "build-five-agent-dev-team",
  "maintain-five-agent-dev-team-automation-health",
  "maintain-five-agent-dev-team-ops-janitor"
];

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("bulk automation status", () => {
  it("dry-runs bulk status changes without mutating automation files", () => {
    const root = createAutomationRoot("ACTIVE");

    const summary = runBulk(root, "--status=PAUSED");

    expect(summary.ok).toBe(true);
    expect(summary.apply).toBe(false);
    expect(summary.root).toBe("<automation-root>");
    expect(summary.results[0].path).toContain("<automation-root>/");
    expect(summary.targetCount).toBe(9);
    expect(summary.changedCount).toBe(9);
    expect(readFileSync(join(root, automationIds[0], "automation.toml"), "utf8")).toContain('status = "ACTIVE"');
  });

  it("applies all approved automation status changes atomically per file", () => {
    const root = createAutomationRoot("ACTIVE");

    const summary = runBulk(root, "--status=PAUSED", "--apply");

    expect(summary.ok).toBe(true);
    expect(summary.changedCount).toBe(9);
    for (const id of automationIds) {
      const toml = readFileSync(join(root, id, "automation.toml"), "utf8");
      expect(toml).toContain(`id = "${id}"`);
      expect(toml).toContain('prompt = "preserve this prompt"');
      expect(toml).toContain('status = "PAUSED"');
    }
  });

  it("fails verification when any approved automation has the wrong status", () => {
    const root = createAutomationRoot("ACTIVE");
    writeAutomation(root, automationIds[3], "PAUSED");

    const result = spawnSync(process.execPath, [script, `--root=${root}`, "--expect-status=ACTIVE"], {
      encoding: "utf8"
    });
    const summary = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(summary.ok).toBe(false);
    expect(summary.errors.join("\n")).toContain(`${automationIds[3]} status is PAUSED; expected ACTIVE`);
  });

  it("refuses unknown automation ids", () => {
    const root = createAutomationRoot("ACTIVE");

    const result = spawnSync(
      process.execPath,
      [script, `--root=${root}`, "--ids=unexpected-five-agent", "--status=PAUSED"],
      {
        encoding: "utf8"
      }
    );
    const summary = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(summary.ok).toBe(false);
    expect(summary.errors.join("\n")).toContain("unknown automation id(s): unexpected-five-agent");
  });
});

function createAutomationRoot(status) {
  const root = mkdtempSync(join(tmpdir(), "five-agent-automations-"));
  tempRoots.push(root);
  for (const id of automationIds) {
    writeAutomation(root, id, status);
  }
  return root;
}

function writeAutomation(root, id, status) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "automation.toml"),
    [
      "version = 1",
      `id = "${id}"`,
      'kind = "cron"',
      `name = "${id}"`,
      'prompt = "preserve this prompt"',
      `status = "${status}"`,
      'rrule = "FREQ=HOURLY;BYMINUTE=5"',
      'model = "gpt-5.5"',
      'reasoning_effort = "xhigh"',
      'execution_environment = "worktree"',
      'cwds = ["./fixtures/project"]',
      ""
    ].join("\n")
  );
}

function runBulk(root, ...args) {
  return JSON.parse(execFileSync(process.execPath, [script, `--root=${root}`, ...args], { encoding: "utf8" }));
}
