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

export const DEFAULT_RELEASE_COMMAND =
  'gh release create "$AGENT_RELEASE_TAG" --title "$AGENT_RELEASE_TAG" --generate-notes';

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
      release: DEFAULT_RELEASE_COMMAND
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
          name: "browser-e2e",
          category: "browser",
          description:
            "Playwright MCP for browser UI flows, accessibility snapshots, screenshots, and end-to-end verification.",
          enabled: true,
          transport: "stdio",
          command: "npx",
          args: ["-y", "@playwright/mcp@latest", "--isolated"],
          activation: {
            mode: "on_demand",
            stages: ["FRONTEND_BUILD", "VERIFY"],
            agents: ["frontend-ux-engineering", "quality-security-privacy-release"],
            keywords: ["ui", "browser", "frontend", "accessibility", "screenshot", "e2e", "form", "visual"]
          },
          timeoutSeconds: 45,
          cacheToolsList: true,
          toolAllowlist: [
            "browser_navigate",
            "browser_snapshot",
            "browser_click",
            "browser_type",
            "browser_take_screenshot"
          ],
          notes: [
            "Use isolated browser state and keep exploratory flows small.",
            "Promote useful flows into checked-in Playwright tests."
          ]
        },
        {
          name: "chrome-diagnostics",
          category: "debugging",
          description: "Chrome DevTools MCP for console, network, screenshot, and performance investigation.",
          enabled: true,
          transport: "stdio",
          command: "npx",
          args: ["-y", "chrome-devtools-mcp@latest", "--isolated=true", "--no-usage-statistics", "--slim"],
          activation: {
            mode: "on_demand",
            stages: ["RND", "FRONTEND_BUILD", "VERIFY"],
            agents: ["rnd-architecture-innovation", "frontend-ux-engineering", "quality-security-privacy-release"],
            keywords: ["performance", "console", "network", "trace", "devtools", "renderer", "browser", "debug"]
          },
          timeoutSeconds: 45,
          cacheToolsList: true,
          toolAllowlist: [],
          notes: [
            "Slim mode is the default; load tracing only when performance evidence is needed.",
            "Use for diagnosis, then persist fixes as code, tests, or durable memory."
          ]
        },
        {
          name: "github-mcp",
          category: "github",
          description:
            "Official GitHub MCP server for deep repo, issue, PR, Actions, code security, and release context.",
          enabled: parsed.githubMcpEnabled,
          transport: "stdio",
          command: "github-mcp-server",
          args: parsed.githubWriteEnabled
            ? ["stdio", "--dynamic-toolsets"]
            : ["stdio", "--dynamic-toolsets", "--read-only"],
          env: {
            GH_TOKEN: "${GH_TOKEN}",
            GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
            GITHUB_TOKEN: "${GITHUB_TOKEN}",
            GITHUB_HOST: "${GITHUB_HOST}"
          },
          activation: {
            mode: "on_demand",
            stages: ["INTAKE", "RND", "VERIFY", "RELEASE"],
            agents: [
              "product-delivery-orchestrator",
              "rnd-architecture-innovation",
              "quality-security-privacy-release"
            ],
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
          description:
            "Tavily MCP for current documentation, advisories, package/API changes, and external error research.",
          enabled: parsed.webResearchEnabled,
          transport: "stdio",
          command: "npx",
          args: ["-y", "tavily-mcp@latest"],
          env: {
            TAVILY_API_KEY: "${TAVILY_API_KEY}",
            DEFAULT_PARAMETERS: '{"search_depth":"advanced","max_results":8,"include_raw_content":false}'
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
          name: "repo-context",
          kind: "knowledge",
          enabled: true,
          summary:
            "Load curated project-local context files, latest loop closure memory, architecture decisions, and recurring repo gotchas before each stage.",
          activation: {
            mode: "always",
            stages: [],
            agents: [],
            keywords: []
          },
          contextFiles: [],
          notes: [
            "Keep context project-scoped and avoid cross-repo assumptions.",
            "Permanent memory should capture durable decisions, failures, release facts, and handoffs."
          ]
        },
        {
          name: "mcp-tool-routing",
          kind: "knowledge",
          enabled: true,
          summary:
            "Select MCP tools lazily by stage, agent role, risk, and keywords so agents stay fast while still having deep capabilities.",
          activation: {
            mode: "always",
            stages: [],
            agents: [],
            keywords: []
          },
          contextFiles: [],
          notes: [
            "Prefer local repo evidence first, then GitHub MCP/CLI/SDK, browser diagnostics, web research, and security tools only when needed.",
            "Close MCP sessions after each agent run and convert durable findings into artifacts or memory."
          ]
        },
        {
          name: "frontend-performance",
          kind: "skill",
          enabled: true,
          summary:
            "Use modern React/frontend performance, accessibility, and visual verification patterns for UI work.",
          activation: {
            mode: "on_demand",
            stages: ["FRONTEND_BUILD", "VERIFY"],
            agents: ["frontend-ux-engineering", "quality-security-privacy-release"],
            keywords: ["react", "frontend", "ui", "accessibility", "responsive", "performance", "bundle", "rerender"]
          },
          contextFiles: [],
          notes: ["Avoid UI bloat; prefer compact operator workflows and browser-verified behavior."]
        },
        {
          name: "backend-systems",
          kind: "knowledge",
          enabled: true,
          summary:
            "Use API contracts, data migration checks, observability hooks, job/worker boundaries, and backend tests for system work.",
          activation: {
            mode: "on_demand",
            stages: ["RND", "BACKEND_BUILD", "VERIFY", "RELEASE"],
            agents: ["rnd-architecture-innovation", "backend-systems-engineering", "quality-security-privacy-release"],
            keywords: [
              "api",
              "backend",
              "database",
              "migration",
              "worker",
              "job",
              "cache",
              "auth",
              "observability",
              "integration"
            ]
          },
          contextFiles: [],
          notes: [
            "Prefer target repo commands and checked-in tests over ad hoc verification.",
            "Treat auth, data, integrations, and migrations as release-gated changes."
          ]
        },
        {
          name: "deep-web-research",
          kind: "knowledge",
          enabled: parsed.webResearchEnabled,
          summary:
            "Use OpenAI hosted web search plus configured MCP research tools only when current docs, issue context, vulnerabilities, or external evidence are needed.",
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

export function targetConfigMatchesWorkItem(
  config: TargetRepoConfig,
  workItem: Pick<WorkItem, "projectId" | "repo">
): boolean {
  const configProjectId = projectIdForConfig(config);
  const configRepo = repoKeyForConfig(config);
  return Boolean(
    (workItem.projectId && workItem.projectId === configProjectId) || (workItem.repo && workItem.repo === configRepo)
  );
}
