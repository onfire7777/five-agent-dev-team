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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("agent runner", () => {
  it("creates deterministic artifacts without live OpenAI mode", async () => {
    const result = await runRoleAgent(getAgentDefinition("rnd-architecture-innovation"), {
      workItem,
      stage: "RND",
      previousArtifacts: []
    });

    expect(result.live).toBe(false);
    expect(result.artifact.ownerAgent).toBe("rnd-architecture-innovation");
    expect(result.artifact.nextStage).toBe("PROPOSAL");
  });

  it("keeps proposal artifacts behind the acceptance gate before build", async () => {
    const result = await runRoleAgent(getAgentDefinition("rnd-architecture-innovation"), {
      workItem: { ...workItem, state: "PROPOSAL" },
      stage: "PROPOSAL",
      proposalStage: true,
      previousArtifacts: []
    });

    expect(result.artifact.stage).toBe("PROPOSAL");
    expect(result.artifact.status).toBe("passed");
    expect(result.artifact.nextStage).toBe("AWAITING_ACCEPTANCE");
    expect(result.artifact.filesChanged).toEqual([]);
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

  it("maps GitHub CLI tokens into the official GitHub MCP token when needed", () => {
    const originalGhToken = process.env.GH_TOKEN;
    const originalGithubToken = process.env.GITHUB_TOKEN;
    const originalPersonalToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    process.env.GH_TOKEN = "gh-token-value";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    try {
      expect(resolveMcpEnv({
        GH_TOKEN: "${GH_TOKEN}",
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
        GITHUB_TOKEN: "${GITHUB_TOKEN}"
      })).toEqual({
        GH_TOKEN: "gh-token-value",
        GITHUB_PERSONAL_ACCESS_TOKEN: "gh-token-value",
        GITHUB_TOKEN: "gh-token-value"
      });
    } finally {
      restoreEnv("GH_TOKEN", originalGhToken);
      restoreEnv("GITHUB_TOKEN", originalGithubToken);
      restoreEnv("GITHUB_PERSONAL_ACCESS_TOKEN", originalPersonalToken);
    }
  });
});
