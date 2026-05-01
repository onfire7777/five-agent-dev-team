import { describe, expect, it } from "vitest";
import fs from "node:fs";
import YAML from "yaml";
import {
  DEFAULT_RELEASE_COMMAND,
  EmergencyControlRequestSchema,
  ProjectConnectionInputSchema,
  ProjectConnectionSchema,
  TargetRepoConfigSchema,
  targetRepoConfigFromProjectConnection
} from "../packages/shared/src";

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
    release: DEFAULT_RELEASE_COMMAND
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

  it("uses a release command compatible with generated release tags", () => {
    const connection = ProjectConnectionSchema.parse({
      id: "acme-app",
      projectId: "acme-app",
      name: "Acme App",
      repo: "acme/app",
      repoOwner: "acme",
      repoName: "app",
      localPath: "C:/repo/app",
      defaultBranch: "main",
      memoryNamespace: "acme-app",
      contextDir: ".agent-team/context",
      githubMcpEnabled: true,
      githubWriteEnabled: false,
      webResearchEnabled: true,
      active: true,
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z"
    });

    const config = targetRepoConfigFromProjectConnection(connection);

    expect(config.commands.release).toBe(DEFAULT_RELEASE_COMMAND);
    expect(config.commands.release).not.toContain("--verify-tag");
    expect(config.commands.release).not.toContain("--notes-file");
  });

  it("shares the emergency control contract across controller and dashboard", () => {
    expect(EmergencyControlRequestSchema.parse({ reason: "Operator stop" })).toEqual({
      scope: "global",
      reason: "Operator stop"
    });
    expect(() => EmergencyControlRequestSchema.parse({ scope: "global", reason: " " })).toThrow();
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

  it("requires absolute local paths for project connections", () => {
    expect(() =>
      ProjectConnectionInputSchema.parse({
        repoOwner: "acme",
        repoName: "app",
        localPath: "repo/app"
      })
    ).toThrow(/absolute path/i);

    expect(() =>
      ProjectConnectionInputSchema.parse({
        repoOwner: "acme",
        repoName: "app",
        localPath: "./repo/app"
      })
    ).toThrow(/absolute path/i);

    expect(
      ProjectConnectionInputSchema.parse({
        repoOwner: "acme",
        repoName: "app",
        localPath: "/var/repo/app"
      }).localPath
    ).toBe("/var/repo/app");

    expect(
      ProjectConnectionInputSchema.parse({
        repoOwner: "acme",
        repoName: "app",
        localPath: "C:\\repo\\app"
      }).localPath
    ).toBe("C:\\repo\\app");
  });

  it("requires absolute local paths in repo config", () => {
    expect(() =>
      TargetRepoConfigSchema.parse({
        ...minimalConfig,
        repo: {
          ...minimalConfig.repo,
          localPath: "repo/app"
        }
      })
    ).toThrow(/absolute path/i);
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
            name: "github-mcp",
            category: "github",
            enabled: true,
            transport: "stdio",
            command: "github-mcp-server",
            args: ["stdio", "--dynamic-toolsets", "--read-only"],
            env: {
              GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
              GITHUB_HOST: "${GITHUB_HOST}"
            },
            activation: {
              mode: "on_demand",
              stages: ["INTAKE", "VERIFY"],
              agents: ["product-delivery-orchestrator"],
              keywords: ["issue", "pr", "github"]
            },
            toolAllowlist: []
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
    expect(config.integrations.mcpServers[0]).toMatchObject({
      transport: "stdio",
      command: "github-mcp-server",
      args: ["stdio", "--dynamic-toolsets", "--read-only"]
    });
    expect(config.integrations.mcpServers[1].category).toBe("web_search");
    expect(config.integrations.mcpServers[1].activation.keywords).toContain("latest");
    expect(config.integrations.mcpServers[1].timeoutSeconds).toBe(60);
    expect(config.integrations.capabilityPacks[0].activation.keywords).toContain("react");
  });

  it("generates official GitHub MCP server config for connected projects", () => {
    const connection = ProjectConnectionSchema.parse({
      id: "acme-app",
      projectId: "acme-app",
      name: "Acme App",
      repo: "acme/app",
      repoOwner: "acme",
      repoName: "app",
      localPath: "C:/repo/app",
      defaultBranch: "main",
      memoryNamespace: "acme-app",
      contextDir: ".agent-team/context",
      githubMcpEnabled: true,
      githubWriteEnabled: false,
      webResearchEnabled: true,
      active: true,
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z"
    });
    const config = targetRepoConfigFromProjectConnection(connection);
    const githubServer = config.integrations.mcpServers.find((server) => server.category === "github");

    expect(githubServer).toMatchObject({
      command: "github-mcp-server",
      args: ["stdio", "--dynamic-toolsets", "--read-only"],
      toolAllowlist: []
    });
    expect(githubServer?.env).toMatchObject({
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
      GITHUB_HOST: "${GITHUB_HOST}"
    });
  });

  it("keeps the checked-in example config copy-paste valid", () => {
    const raw = fs.readFileSync("agent-team.config.example.yaml", "utf8");
    const config = TargetRepoConfigSchema.parse(YAML.parse(raw));

    expect(config.context.files).toEqual([]);
    expect(config.integrations.mcpServers.some((server) => server.name === "github-mcp" && server.enabled)).toBe(true);
  });
});
