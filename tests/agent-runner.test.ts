import { describe, expect, it } from "vitest";
import { getAgentDefinition, resolveMcpEnv, runRoleAgent } from "../packages/agents/src";
import type { WorkItem } from "../packages/shared/src";

const workItem: WorkItem = {
  id: "WI-2000",
  title: "Build autonomous release controller",
  requestType: "feature",
  priority: "high",
  state: "RND",
  dependencies: [],
  acceptanceCriteria: ["Release only after all gates pass"],
  riskLevel: "high",
  frontendNeeded: true,
  backendNeeded: true,
  rndNeeded: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

describe("agent runner", () => {
  it("creates deterministic artifacts without live OpenAI mode", async () => {
    const result = await runRoleAgent(getAgentDefinition("rnd-architecture-innovation"), {
      workItem,
      stage: "RND",
      previousArtifacts: []
    });

    expect(result.live).toBe(false);
    expect(result.artifact.ownerAgent).toBe("rnd-architecture-innovation");
    expect(result.artifact.nextStage).toBe("CONTRACT");
  });

  it("interpolates MCP environment placeholders from process env", () => {
    process.env.TEST_GITHUB_TOKEN = "token-value";
    expect(resolveMcpEnv({
      GITHUB_PERSONAL_ACCESS_TOKEN: "${TEST_GITHUB_TOKEN}",
      STATIC_VALUE: "literal"
    })).toEqual({
      GITHUB_PERSONAL_ACCESS_TOKEN: "token-value",
      STATIC_VALUE: "literal"
    });
    delete process.env.TEST_GITHUB_TOKEN;
  });
});
