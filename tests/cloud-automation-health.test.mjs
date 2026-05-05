import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function workflow(name) {
  return readFileSync(join(root, ".github", "workflows", name), "utf8");
}

describe("cloud automation health policy", () => {
  it("keeps scheduled research behind the global health stop", () => {
    const research = workflow("codex-cloud-research.yml");

    expect(research).toContain("global stop issue #");
    expect(research).toContain('labels.includes("agent:blocked")');
    expect(research).toContain('labels.includes("blocker:global-stop")');
    expect(research).toContain("Pause pipeline on Codex provider failure");
  });

  it("turns Codex provider failures into global stops before lane retry routing", () => {
    const build = workflow("codex-cloud-build-pipeline.yml");

    expect(build).toContain("Pause pipeline on Codex provider failure");
    expect(build).toContain("steps.provider_failure_pause.outputs.handled != 'true'");
    expect(build).toContain('core.setOutput("handled", "true")');
    expect(build).toContain('const labels = ["agent:blocked", "blocker:global-stop"]');
  });

  it("prevents Meta Health from requeuing lane stops while a global stop is active", () => {
    const meta = workflow("codex-cloud-meta-health.yml");

    expect(meta).toContain('const healthTitle = "[Codex Health] Cloud control-plane finding"');
    expect(meta).toContain("!blockers.length");
    expect(meta).toContain("!healthIssues.length");
    expect(meta).toContain("Retryable blocked lane-stop issues");
  });
});
