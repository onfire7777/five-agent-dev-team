import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getAgentDefinition, resolveMcpEnv, runRoleAgent } from "../packages/agents/src";
import { TargetRepoConfigSchema, type WorkItem } from "../packages/shared/src";

const liveAgentMock = vi.hoisted(() => ({
  models: [] as string[],
  prompts: [] as string[],
  hostedSearchCalls: 0
}));

vi.mock("@openai/agents", () => {
  class Agent {
    model: string;

    constructor(options: { model: string }) {
      this.model = options.model;
      liveAgentMock.models.push(options.model);
    }
  }

  return {
    Agent,
    run: vi.fn(async (agent: Agent, prompt: string) => {
      liveAgentMock.prompts.push(prompt);
      if (agent.model === "gpt-primary") throw new Error("primary failed");
      return {
        finalOutput: JSON.stringify({
          status: "passed",
          title: "Fallback completed",
          summary: "Fallback model completed the stage.",
          decisions: ["Used fallback model."],
          risks: [],
          filesChanged: [],
          testsRun: [],
          releaseReadiness: "unknown",
          nextStage: "CONTRACT"
        })
      };
    }),
    MCPServers: {
      open: vi.fn()
    },
    MCPServerStdio: class {
      name: string;

      constructor(options: { name: string }) {
        this.name = options.name;
      }
    },
    MCPServerStreamableHttp: class {
      name: string;

      constructor(options: { name: string }) {
        this.name = options.name;
      }
    },
    webSearchTool: vi.fn(() => {
      liveAgentMock.hostedSearchCalls += 1;
      return {};
    })
  };
});

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
    expect(
      resolveMcpEnv({
        GITHUB_PERSONAL_ACCESS_TOKEN: "${TEST_GITHUB_TOKEN}",
        STATIC_VALUE: "literal"
      })
    ).toEqual({
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
      expect(
        resolveMcpEnv({
          GH_TOKEN: "${GH_TOKEN}",
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
          GITHUB_TOKEN: "${GITHUB_TOKEN}"
        })
      ).toEqual({
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

  it("recomputes prompt metadata when live mode falls back to another model", async () => {
    const originalLiveMode = process.env.AGENT_LIVE_MODE;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalAgentModel = process.env.AGENT_MODEL;
    liveAgentMock.models.length = 0;
    liveAgentMock.prompts.length = 0;
    liveAgentMock.hostedSearchCalls = 0;
    process.env.AGENT_LIVE_MODE = "true";
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.AGENT_MODEL;
    try {
      const result = await runRoleAgent(getAgentDefinition("frontend-ux-engineering"), {
        workItem,
        stage: "FRONTEND_BUILD",
        previousArtifacts: [],
        targetRepoConfig: liveTargetConfig()
      });

      expect(liveAgentMock.models).toEqual(["gpt-primary", "gpt-fallback"]);
      expect(liveAgentMock.prompts[0]).toContain("gpt-primary selected for this run.");
      expect(liveAgentMock.prompts[1]).toContain("gpt-fallback selected for this run.");
      expect(result.live).toBe(true);
      expect(result.artifact.promptHash).toBe(
        crypto.createHash("sha256").update(liveAgentMock.prompts[1]).digest("hex")
      );
    } finally {
      restoreEnv("AGENT_LIVE_MODE", originalLiveMode);
      restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
      restoreEnv("AGENT_MODEL", originalAgentModel);
    }
  });

  it("does not mount hosted search just because a web search MCP server is active", async () => {
    const originalLiveMode = process.env.AGENT_LIVE_MODE;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalAgentModel = process.env.AGENT_MODEL;
    liveAgentMock.models.length = 0;
    liveAgentMock.prompts.length = 0;
    liveAgentMock.hostedSearchCalls = 0;
    process.env.AGENT_LIVE_MODE = "true";
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.AGENT_MODEL;
    try {
      await runRoleAgent(getAgentDefinition("frontend-ux-engineering"), {
        workItem,
        stage: "FRONTEND_BUILD",
        previousArtifacts: [],
        targetRepoConfig: liveTargetConfig({
          mcpServers: [
            {
              name: "web-search-mcp",
              category: "web_search",
              enabled: true,
              transport: "stdio",
              command: "web-search",
              args: [],
              activation: { mode: "always", stages: [], agents: [], keywords: [] },
              env: {},
              timeoutSeconds: 30,
              cacheToolsList: true,
              toolAllowlist: [],
              notes: []
            }
          ]
        })
      });

      expect(liveAgentMock.hostedSearchCalls).toBe(0);
    } finally {
      restoreEnv("AGENT_LIVE_MODE", originalLiveMode);
      restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
      restoreEnv("AGENT_MODEL", originalAgentModel);
    }
  });

  it("advertises only connected MCP capabilities in live artifacts", async () => {
    const originalLiveMode = process.env.AGENT_LIVE_MODE;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalAgentModel = process.env.AGENT_MODEL;
    const agents = await import("@openai/agents");
    liveAgentMock.models.length = 0;
    liveAgentMock.prompts.length = 0;
    liveAgentMock.hostedSearchCalls = 0;
    process.env.AGENT_LIVE_MODE = "true";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AGENT_MODEL = "gpt-fallback";
    try {
      vi.mocked(agents.MCPServers.open).mockImplementationOnce(
        async (servers: any[]) =>
          ({
            active: [servers[0]],
            close: vi.fn()
          }) as any
      );

      const result = await runRoleAgent(getAgentDefinition("frontend-ux-engineering"), {
        workItem,
        stage: "FRONTEND_BUILD",
        previousArtifacts: [],
        targetRepoConfig: liveTargetConfig({
          mcpServers: [mcpServerConfig("connected-mcp"), mcpServerConfig("dropped-mcp")]
        })
      });

      expect(result.artifact.capabilityIds).toEqual(["mcp:connected-mcp"]);
      expect(liveAgentMock.prompts.at(-1)).toContain("mcp:connected-mcp");
      expect(liveAgentMock.prompts.at(-1)).not.toContain("mcp:dropped-mcp");
    } finally {
      vi.mocked(agents.MCPServers.open).mockReset();
      restoreEnv("AGENT_LIVE_MODE", originalLiveMode);
      restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
      restoreEnv("AGENT_MODEL", originalAgentModel);
    }
  });

  it("preserves successful agent results when MCP close fails", async () => {
    const originalLiveMode = process.env.AGENT_LIVE_MODE;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalAgentModel = process.env.AGENT_MODEL;
    const agents = await import("@openai/agents");
    const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => true as any);
    process.env.AGENT_LIVE_MODE = "true";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AGENT_MODEL = "gpt-fallback";
    try {
      vi.mocked(agents.MCPServers.open).mockImplementationOnce(
        async (servers: any[]) =>
          ({
            active: [servers[0]],
            close: vi.fn(async () => {
              throw new Error("close failed");
            })
          }) as any
      );

      const result = await runRoleAgent(getAgentDefinition("frontend-ux-engineering"), {
        workItem,
        stage: "FRONTEND_BUILD",
        previousArtifacts: [],
        targetRepoConfig: liveTargetConfig({
          mcpServers: [mcpServerConfig("unstable-close-mcp")]
        })
      });

      expect(result.live).toBe(true);
      expect(result.artifact.status).toBe("passed");
      expect(warningSpy).toHaveBeenCalledWith(
        "MCP session close failed; preserving completed agent result.",
        expect.objectContaining({ code: "AGENT_MCP_CLOSE_FAILED" })
      );
    } finally {
      warningSpy.mockRestore();
      vi.mocked(agents.MCPServers.open).mockReset();
      restoreEnv("AGENT_LIVE_MODE", originalLiveMode);
      restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
      restoreEnv("AGENT_MODEL", originalAgentModel);
    }
  });

  it("does not claim verification checks on template artifacts", async () => {
    const result = await runRoleAgent(getAgentDefinition("quality-security-privacy-release"), {
      workItem: { ...workItem, state: "VERIFY" },
      stage: "VERIFY",
      previousArtifacts: []
    });

    expect(result.live).toBe(false);
    expect(result.artifact.testsRun).toEqual([]);
    expect(result.artifact.releaseReadiness).toBe("unknown");
  });
});

function liveTargetConfig(overrides: { mcpServers?: unknown[]; capabilityPacks?: unknown[] } = {}) {
  return TargetRepoConfigSchema.parse({
    repo: {
      owner: "owner",
      name: "repo",
      defaultBranch: "main",
      localPath: process.cwd()
    },
    commands: {
      install: "npm ci",
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      security: "npm audit --audit-level=high",
      release: 'gh release create "$AGENT_RELEASE_TAG" --notes-file release/notes.md --verify-tag'
    },
    integrations: {
      mcpServers: overrides.mcpServers || [],
      capabilityPacks: overrides.capabilityPacks || [],
      plugins: []
    },
    models: {
      primaryCodingModel: "gpt-primary",
      researchModel: "gpt-research",
      reviewModel: "gpt-review",
      fallbackModel: "gpt-fallback",
      useBestAvailable: true
    },
    release: {
      mode: "autonomous"
    }
  });
}

function mcpServerConfig(name: string) {
  return {
    name,
    category: "github",
    enabled: true,
    transport: "stdio",
    command: name,
    args: [],
    activation: { mode: "always", stages: [], agents: [], keywords: [] },
    env: {},
    timeoutSeconds: 30,
    cacheToolsList: true,
    toolAllowlist: [],
    notes: []
  };
}
