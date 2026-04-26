import { describe, expect, it } from "vitest";
import { ProjectConnectionInputSchema, TargetRepoConfigSchema } from "../packages/shared/src";

const minimalConfig = {
  repo: {
    owner: "acme",
    name: "app",
    defaultBranch: "main",
    localPath: "C:/repo/app"
  },
  commands: {
    install: "npm ci",
    lint: "npm run lint",
    typecheck: "npm run typecheck",
    test: "npm test",
    build: "npm run build",
    security: "npm audit --audit-level=high",
    release: "gh workflow run release.yml --ref main"
  },
  release: {
    mode: "autonomous",
    githubActionsRequired: true,
    requireLocalRemoteSync: true,
    requireCleanWorktree: true
  }
};

describe("target repo config schema", () => {
  it("keeps Electron, MCP, and capability packs disabled by default", () => {
    const config = TargetRepoConfigSchema.parse(minimalConfig);

    expect(config.integrations.electron.enabled).toBe(false);
    expect(config.integrations.mcpServers).toEqual([]);
    expect(config.integrations.capabilityPacks).toEqual([]);
    expect(config.project.isolation.requireExplicitRepoConnection).toBe(true);
    expect(config.models.primaryCodingModel).toBe("gpt-5.5");
  });

  it("keeps project connection defaults explicit and repo scoped", () => {
    const connection = ProjectConnectionInputSchema.parse({
      repoOwner: "acme",
      repoName: "app",
      localPath: "C:/repo/app"
    });

    expect(connection.defaultBranch).toBe("main");
    expect(connection.webResearchEnabled).toBe(true);
    expect(connection.githubMcpEnabled).toBe(true);
    expect(connection.githubWriteEnabled).toBe(false);
    expect(connection.active).toBe(true);
    expect(connection.localPath).toBe("C:/repo/app");
  });

  it("parses lazy MCP and capability activation rules", () => {
    const config = TargetRepoConfigSchema.parse({
      ...minimalConfig,
      integrations: {
        electron: {
          enabled: false
        },
        mcpServers: [
          {
            name: "github-read",
            category: "github",
            enabled: true,
            transport: "stdio",
            command: "node",
            args: ["scripts/github-cli-mcp.mjs"],
            activation: {
              mode: "on_demand",
              stages: ["INTAKE", "VERIFY"],
              agents: ["product-delivery-orchestrator"],
              keywords: ["issue", "pr", "github"]
            },
            toolAllowlist: ["github_repo_status", "github_issue_list", "github_pr_list"]
          },
          {
            name: "deep-web-research",
            category: "web_search",
            enabled: false,
            transport: "stdio",
            command: "npx",
            args: ["-y", "web-research-mcp@latest"],
            activation: {
              mode: "on_demand",
              stages: ["RND", "VERIFY"],
              agents: ["rnd-architecture-innovation"],
              keywords: ["research", "latest", "source"]
            },
            timeoutSeconds: 60,
            notes: ["Use only when local repo context is insufficient."]
          }
        ],
        capabilityPacks: [
          {
            name: "React performance",
            kind: "skill",
            summary: "Use React performance best practices for UI work.",
            activation: {
              mode: "on_demand",
              stages: ["FRONTEND_BUILD"],
              agents: ["frontend-ux-engineering"],
              keywords: ["react", "rerender"]
            }
          }
        ]
      }
    });

    expect(config.integrations.mcpServers[0].activation.stages).toContain("VERIFY");
    expect(config.integrations.mcpServers[0].category).toBe("github");
    expect(config.integrations.mcpServers[0]).toMatchObject({ transport: "stdio", command: "node" });
    expect(config.integrations.mcpServers[1].category).toBe("web_search");
    expect(config.integrations.mcpServers[1].activation.keywords).toContain("latest");
    expect(config.integrations.mcpServers[1].timeoutSeconds).toBe(60);
    expect(config.integrations.capabilityPacks[0].activation.keywords).toContain("react");
  });
});
