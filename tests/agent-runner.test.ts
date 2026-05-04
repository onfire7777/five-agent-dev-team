import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getAgentDefinition, resolveMcpEnv, runRoleAgent } from "../packages/agents/src";
import { DEFAULT_RELEASE_COMMAND, TargetRepoConfigSchema, type WorkItem } from "../packages/shared/src";

const liveAgentMock = vi.hoisted(() => ({
  models: [] as string[],
  prompts: [] as string[],
  tools: [] as any[][],
  hostedSearchCalls: 0
}));

vi.mock("@openai/agents", () => {
  class Agent {
    model: string;

    constructor(options: { model: string; tools?: any[] }) {
      this.model = options.model;
      liveAgentMock.models.push(options.model);
      liveAgentMock.tools.push(options.tools || []);
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
    }),
    tool: vi.fn((options: any) => ({
      type: "function",
      name: options.name,
      description: options.description,
      parameters: options.parameters,
      strict: options.strict ?? true,
      execute: options.execute
    })),
    toolNamespace: vi.fn((options: any) =>
      options.tools.map((tool: any) => ({
        ...tool,
        namespace: options.name,
        qualifiedName: `${options.name}.${tool.name}`
      }))
    )
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

      expect(result.artifact.capabilityIds).toEqual(
        expect.arrayContaining(["mcp:connected-mcp", "builtin:artifact.write"])
      );
      expect(result.artifact.capabilityIds).not.toContain("mcp:dropped-mcp");
      expect(liveAgentMock.prompts.at(-1)).toContain("mcp:connected-mcp");
      expect(liveAgentMock.prompts.at(-1)).not.toContain("mcp:dropped-mcp");
    } finally {
      vi.mocked(agents.MCPServers.open).mockReset();
      restoreEnv("AGENT_LIVE_MODE", originalLiveMode);
      restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
      restoreEnv("AGENT_MODEL", originalAgentModel);
    }
  });

  it("registers and scopes live runner built-in tools", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-builtins-"));
    const originalLiveMode = process.env.AGENT_LIVE_MODE;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalAgentModel = process.env.AGENT_MODEL;
    const now = new Date().toISOString();
    liveAgentMock.models.length = 0;
    liveAgentMock.prompts.length = 0;
    liveAgentMock.tools.length = 0;
    liveAgentMock.hostedSearchCalls = 0;
    process.env.AGENT_LIVE_MODE = "true";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AGENT_MODEL = "gpt-fallback";
    try {
      await fs.mkdir(path.join(tempDir, ".agent-team", "context"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, ".agent-team", "context", "guide.md"),
        "# Guide\n\nScoped context.",
        "utf8"
      );
      const scopedWorkItem = {
        ...workItem,
        id: "WI-TOOLS",
        projectId: "project-a",
        repo: "owner/repo",
        state: "BACKEND_BUILD" as const
      };
      const emitted: unknown[] = [];
      const result = await runRoleAgent(getAgentDefinition("backend-systems-engineering"), {
        workItem: scopedWorkItem,
        stage: "BACKEND_BUILD",
        previousArtifacts: [],
        targetRepoConfig: liveTargetConfig({ repoPath: tempDir }),
        memories: [
          {
            id: "mem-1",
            scope: "work_item",
            projectId: "project-a",
            repo: "owner/repo",
            workItemId: "WI-TOOLS",
            kind: "decision",
            title: "Use strict tools",
            content: "Built-in tool results must stay scoped.",
            tags: ["tools"],
            confidence: "high",
            importance: 5,
            permanence: "durable",
            source: "test",
            createdAt: now,
            updatedAt: now
          },
          {
            id: "mem-2",
            scope: "work_item",
            projectId: "other-project",
            repo: "owner/repo",
            workItemId: "WI-OTHER",
            kind: "decision",
            title: "Do not leak",
            content: "This memory belongs to another project.",
            tags: [],
            confidence: "high",
            importance: 5,
            permanence: "durable",
            source: "test",
            createdAt: now,
            updatedAt: now
          }
        ],
        emitEvent: async (event) => {
          emitted.push(event);
        }
      });

      expect(result.artifact.capabilityIds).toEqual(
        expect.arrayContaining([
          "builtin:memory.search",
          "builtin:repo.context.read",
          "builtin:artifact.write",
          "builtin:event.emit",
          "builtin:skill.load"
        ])
      );
      const tools = liveAgentMock.tools.at(-1) || [];
      const toolNames = tools.map((tool) => tool.qualifiedName || `${tool.namespace}.${tool.name}`);
      expect(toolNames).toEqual(
        expect.arrayContaining(["memory.search", "repo_context.read", "artifact.write", "event.emit", "skill.load"])
      );

      await expect(findTool(tools, "memory.search").execute({ query: "strict", limit: 5 })).resolves.toMatchObject({
        count: 1,
        records: [expect.objectContaining({ id: "mem-1" })]
      });

      const repoTool = findTool(tools, "repo_context.read");
      await expect(repoTool.execute({ path: "guide.md" })).resolves.toMatchObject({
        path: "guide.md",
        content: expect.stringContaining("Scoped context.")
      });
      await expect(repoTool.execute({ path: "../package.json" })).rejects.toThrow(/escapes/);

      const artifactTool = findTool(tools, "artifact.write");
      await expect(artifactTool.execute({ workItemId: "wrong", title: "Bad", summary: "Bad" })).rejects.toThrow(
        /mismatched workItemId/
      );
      await expect(
        artifactTool.execute({
          title: "Backend built-in tools ready",
          summary: "Built-in tools were validated.",
          status: "passed",
          decisions: ["Use runner-owned tools."],
          risks: [],
          filesChanged: ["packages/agents/src/runner.ts"],
          testsRun: ["agent-runner"],
          releaseReadiness: "unknown",
          nextStage: "INTEGRATION",
          bodyMd: "## Backend built-in tools ready",
          bodyJson: { ok: true }
        })
      ).resolves.toMatchObject({ status: "captured", workItemId: "WI-TOOLS" });

      await expect(
        findTool(tools, "event.emit").execute({ type: "agent.blocked", level: "warn", message: "Need routing." })
      ).resolves.toEqual({ status: "emitted", type: "agent.blocked" });
      expect(emitted).toContainEqual({ type: "agent.blocked", level: "warn", message: "Need routing." });

      const skillTool = findTool(tools, "skill.load");
      await expect(skillTool.execute({ id: "api-contract-design" })).resolves.toMatchObject({
        id: "api-contract-design",
        audience: ["backend-systems-engineering"]
      });
      await expect(skillTool.execute({ id: "react-component-design" })).rejects.toThrow(/not available/);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      restoreEnv("AGENT_LIVE_MODE", originalLiveMode);
      restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
      restoreEnv("AGENT_MODEL", originalAgentModel);
    }
  });

  it("fails closed when repo context is requested without a connected repo", async () => {
    const originalLiveMode = process.env.AGENT_LIVE_MODE;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalAgentModel = process.env.AGENT_MODEL;
    liveAgentMock.models.length = 0;
    liveAgentMock.prompts.length = 0;
    liveAgentMock.tools.length = 0;
    liveAgentMock.hostedSearchCalls = 0;
    process.env.AGENT_LIVE_MODE = "true";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.AGENT_MODEL = "gpt-fallback";
    try {
      await runRoleAgent(getAgentDefinition("backend-systems-engineering"), {
        workItem: { ...workItem, state: "BACKEND_BUILD" },
        stage: "BACKEND_BUILD",
        previousArtifacts: []
      });

      const tools = liveAgentMock.tools.at(-1) || [];
      await expect(findTool(tools, "repo_context.read").execute({ path: "guide.md" })).rejects.toThrow(
        /no connected repository context/
      );
    } finally {
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

  it("loads triggered plugin-contributed skills from merged runtime contributions", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-plugin-skill-"));
    try {
      const skillPath = path.join(tempDir, "skills", "browser-smoke", "SKILL.md");
      await fs.mkdir(path.dirname(skillPath), { recursive: true });
      await fs.writeFile(
        skillPath,
        `---
id: browser-smoke
name: Browser Smoke
audience:
  - backend-systems-engineering
priority: 80
trigger:
  always: true
---
Use the plugin-provided browser smoke procedure when the work item requires UI release evidence.
`,
        "utf8"
      );

      const result = await runRoleAgent(getAgentDefinition("backend-systems-engineering"), {
        workItem: { ...workItem, state: "BACKEND_BUILD" },
        stage: "BACKEND_BUILD",
        previousArtifacts: [],
        targetRepoConfig: liveTargetConfig({
          repoPath: tempDir,
          pluginContributions: {
            capabilities: [],
            mcpServers: [],
            skills: [{ id: "browser-smoke", relativePath: "skills/browser-smoke/SKILL.md" }],
            tools: [{ name: "browser.screenshot", description: "Capture a browser screenshot." }],
            releaseGates: [{ id: "browser-smoke-gate", command: "npm run browser:smoke", required: true }]
          }
        })
      });

      expect(result.artifact.skillIds).toContain("browser-smoke");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

function findTool(tools: any[], qualifiedName: string): any {
  const tool = tools.find(
    (candidate) => (candidate.qualifiedName || `${candidate.namespace}.${candidate.name}`) === qualifiedName
  );
  if (!tool) {
    throw new Error(`Tool ${qualifiedName} was not registered.`);
  }
  return tool;
}

function liveTargetConfig(
  overrides: {
    mcpServers?: unknown[];
    capabilityPacks?: unknown[];
    pluginContributions?: unknown;
    repoPath?: string;
  } = {}
) {
  return TargetRepoConfigSchema.parse({
    repo: {
      owner: "owner",
      name: "repo",
      defaultBranch: "main",
      localPath: overrides.repoPath || process.cwd()
    },
    commands: {
      install: "npm ci",
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      security: "npm audit --audit-level=high",
      release: DEFAULT_RELEASE_COMMAND
    },
    integrations: {
      mcpServers: overrides.mcpServers || [],
      capabilityPacks: overrides.capabilityPacks || [],
      plugins: [],
      ...(overrides.pluginContributions ? { pluginContributions: overrides.pluginContributions } : {})
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
