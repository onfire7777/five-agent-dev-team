import { describe, expect, it } from "vitest";
import { TargetRepoConfigSchema } from "../packages/shared/src";

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
            command: "docker",
            args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
            activation: {
              mode: "on_demand",
              stages: ["INTAKE", "VERIFY"],
              agents: ["product-delivery-orchestrator"],
              keywords: ["issue", "pr", "github"]
            },
            toolAllowlist: ["get_issue", "list_pull_requests"]
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
    expect(config.integrations.capabilityPacks[0].activation.keywords).toContain("react");
  });
});
