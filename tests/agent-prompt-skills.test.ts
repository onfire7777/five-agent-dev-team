import { describe, expect, it } from "vitest";
import { assembleCanonicalPrompt, getAgentDefinition, loadTriggeredSkills, runRoleAgent } from "../packages/agents/src";
import type { WorkItem } from "../packages/shared/src";

const liveEnvKeys = ["AGENT_LIVE_MODE", "AGENT_EXECUTION_MODE", "AGENT_MODEL", "OPENAI_API_KEY"] as const;

const workItem: WorkItem = {
  id: "WI-3000",
  projectId: "project-a",
  repo: "owner/repo",
  title: "Add scoped dashboard release status",
  requestType: "feature",
  priority: "medium",
  state: "FRONTEND_BUILD",
  dependencies: [],
  acceptanceCriteria: ["Dashboard has no sample data", "Mobile has no horizontal scroll"],
  riskLevel: "medium",
  frontendNeeded: true,
  backendNeeded: true,
  rndNeeded: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

describe("agent prompt and skills", () => {
  it("assembles the canonical seven prompt blocks in order", () => {
    const result = assembleCanonicalPrompt({
      definition: getAgentDefinition("frontend-ux-engineering"),
      workItem,
      stage: "FRONTEND_BUILD",
      selectedModel: "gpt-5.5",
      previousArtifacts: [],
      memories: [],
      skills: [],
      capabilityIds: [],
      teamMessages: [
        {
          stage: "BACKEND_BUILD",
          ownerAgent: "backend-systems-engineering",
          message: "API contract is ready for frontend consumption."
        }
      ]
    });

    const blocks = [...result.prompt.matchAll(/<<< BLOCK: ([a-z_]+) >>>/g)].map((match) => match[1]);
    expect(blocks).toEqual(["identity", "nonnegotiables", "context", "skills", "tools", "task", "output_contract"]);
    expect(result.prompt).toContain("API contract is ready for frontend consumption.");
    expect(result.prompt).not.toContain("accompanying Markdown");
    expect(result.prompt).not.toContain("Markdown body: required");
    expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("loads shared and role skills by audience, stage, and keyword", async () => {
    const result = await loadTriggeredSkills({
      workItem,
      stage: "FRONTEND_BUILD",
      agent: "frontend-ux-engineering"
    });

    const ids = result.skills.map((skill) => skill.id);
    expect(ids).toContain("prompt-injection-defense");
    expect(ids).toContain("memory-discipline");
    expect(ids).toContain("handoff-discipline");
    expect(ids).toContain("react-component-design");
    expect(ids).toContain("accessibility-wcag");
    expect(ids).not.toContain("api-contract-design");
  });

  it("records prompt, skill, and capability provenance on artifacts", async () => {
    const originalEnv = snapshotEnv(liveEnvKeys);
    clearEnv(liveEnvKeys);
    try {
      const result = await runRoleAgent(getAgentDefinition("frontend-ux-engineering"), {
        workItem,
        stage: "FRONTEND_BUILD",
        previousArtifacts: []
      });

      expect(result.live).toBe(false);
      expect(result.artifact.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.artifact.skillIds).toContain("react-component-design");
      expect(result.artifact.skillIds).toContain("handoff-discipline");
      expect(result.artifact.capabilityIds).toEqual([]);
    } finally {
      restoreEnv(originalEnv);
    }
  });
});

function snapshotEnv(keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys: readonly string[]): void {
  for (const key of keys) delete process.env[key];
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
