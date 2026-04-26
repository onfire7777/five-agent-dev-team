import fs from "node:fs";
import YAML from "yaml";
import {
  ProjectConnectionSchema,
  TargetRepoConfigSchema,
  type ProjectConnection,
  type TargetRepoConfig,
  type WorkItem
} from "./schemas";
import { projectIdForConfig, repoKeyForConfig } from "./context";

export function loadTargetRepoConfig(path = "agent-team.config.yaml"): TargetRepoConfig {
  const raw = fs.readFileSync(path, "utf8");
  return TargetRepoConfigSchema.parse(YAML.parse(raw));
}

export function targetRepoConfigFromProjectConnection(project: ProjectConnection): TargetRepoConfig {
  const parsed = ProjectConnectionSchema.parse(project);
  return TargetRepoConfigSchema.parse({
    project: {
      id: parsed.projectId,
      name: parsed.name,
      isolation: {
        requireExplicitRepoConnection: true,
        allowCrossProjectMemory: false,
        allowGlobalMemory: false,
        memoryNamespace: parsed.memoryNamespace
      }
    },
    repo: {
      owner: parsed.repoOwner,
      name: parsed.repoName,
      defaultBranch: parsed.defaultBranch,
      localPath: parsed.localPath
    },
    commands: {
      install: "npm ci",
      lint: "npm run lint --if-present",
      typecheck: "npm run typecheck --if-present",
      test: "npm test --if-present",
      build: "npm run build --if-present",
      security: "npm audit --audit-level=high",
      release: `gh workflow run release.yml --ref ${parsed.defaultBranch}`
    },
    context: {
      includeDefaultContextDir: true,
      defaultContextDir: parsed.contextDir,
      maxFiles: 8,
      maxBytesPerFile: 12_000,
      files: []
    },
    integrations: {
      electron: {
        enabled: false,
        preferredAutomation: "playwright_test",
        artifactsDir: ".agent-team/artifacts/electron",
        requireIsolatedProfile: true,
        allowRemoteDebugging: false,
        notes: []
      },
      mcpServers: [
        {
          name: "github-mcp",
          category: "github",
          description: "Official GitHub MCP server for deep repo, issue, PR, Actions, code security, and release context.",
          enabled: parsed.githubMcpEnabled,
          transport: "stdio",
          command: "github-mcp-server",
          args: parsed.githubWriteEnabled ? ["stdio", "--dynamic-toolsets"] : ["stdio", "--dynamic-toolsets", "--read-only"],
          env: {
            GH_TOKEN: "${GH_TOKEN}",
            GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
            GITHUB_TOKEN: "${GITHUB_TOKEN}",
            GITHUB_HOST: "${GITHUB_HOST}"
          },
          activation: {
            mode: "on_demand",
            stages: ["INTAKE", "RND", "VERIFY", "RELEASE"],
            agents: ["product-delivery-orchestrator", "rnd-architecture-innovation", "quality-security-privacy-release"],
            keywords: ["github", "issue", "pr", "pull request", "actions", "checks", "release", "ci", "review"]
          },
          timeoutSeconds: 45,
          cacheToolsList: true,
          toolAllowlist: [],
          notes: [
            "Uses GitHub's official MCP server with dynamic tool discovery so documented toolsets are available on demand without loading the full catalog by default.",
            "Read-only mode is the default; set githubWriteEnabled for a connected project only when GitHub MCP writes are explicitly required by policy.",
            "GitHub CLI remains first-class for deterministic local branch, PR, workflow, release, and sync gates."
          ]
        },
        {
          name: "deep-web-research",
          category: "web_search",
          description: "Tavily MCP for current documentation, advisories, package/API changes, and external error research.",
          enabled: parsed.webResearchEnabled,
          transport: "stdio",
          command: "npx",
          args: ["-y", "tavily-mcp@latest"],
          env: {
            TAVILY_API_KEY: "${TAVILY_API_KEY}",
            DEFAULT_PARAMETERS: "{\"search_depth\":\"advanced\",\"max_results\":8,\"include_raw_content\":false}"
          },
          activation: {
            mode: "on_demand",
            stages: ["RND", "VERIFY", "RELEASE"],
            agents: ["rnd-architecture-innovation", "quality-security-privacy-release"],
            keywords: [
              "latest",
              "current",
              "docs",
              "documentation",
              "research",
              "advisory",
              "cve",
              "vulnerability",
              "dependency",
              "package",
              "api",
              "breaking",
              "deprecation",
              "compatibility",
              "error",
              "regression"
            ]
          },
          timeoutSeconds: 45,
          cacheToolsList: true,
          toolAllowlist: ["tavily-search", "tavily-extract"],
          notes: [
            "Use only for current external facts and cite or summarize durable findings in artifacts or memory.",
            "Prefer official docs, security advisories, and source repositories for technical claims."
          ]
        }
      ],
      capabilityPacks: [
        {
          name: "deep-web-research",
          kind: "knowledge",
          enabled: parsed.webResearchEnabled,
          summary: "Use OpenAI hosted web search plus configured MCP research tools only when current docs, issue context, vulnerabilities, or external evidence are needed.",
          activation: {
            mode: "on_demand",
            stages: ["RND", "VERIFY", "RELEASE"],
            agents: ["rnd-architecture-innovation", "quality-security-privacy-release"],
            keywords: ["research", "latest", "docs", "dependency", "vulnerability", "security", "bug", "github", "web"]
          },
          contextFiles: [],
          notes: [
            "Keep web research scoped to this project and convert useful findings into artifacts or memory.",
            "Prefer official sources for package/framework behavior and security-sensitive claims."
          ]
        },
        {
          name: "secure-release",
          kind: "knowledge",
          enabled: true,
          summary: "Apply secure release, secret scanning, dependency review, rollback, and local/remote sync gates.",
          activation: {
            mode: "always",
            stages: [],
            agents: [],
            keywords: []
          },
          contextFiles: [],
          notes: ["Release safety is a hard invariant."]
        }
      ]
    },
    release: {
      mode: "autonomous",
      githubActionsRequired: true,
      requireLocalRemoteSync: true,
      requireCleanWorktree: true,
      emergencyStopFile: ".agent-team/emergency-stop"
    }
  });
}

export function targetConfigMatchesWorkItem(config: TargetRepoConfig, workItem: Pick<WorkItem, "projectId" | "repo">): boolean {
  const configProjectId = projectIdForConfig(config);
  const configRepo = repoKeyForConfig(config);
  return Boolean(
    (workItem.projectId && workItem.projectId === configProjectId) ||
    (workItem.repo && workItem.repo === configRepo)
  );
}
