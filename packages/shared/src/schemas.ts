import { z } from "zod";

export const WorkItemStateSchema = z.enum([
  "NEW",
  "INTAKE",
  "RND",
  "CONTRACT",
  "FRONTEND_BUILD",
  "BACKEND_BUILD",
  "INTEGRATION",
  "VERIFY",
  "RELEASE",
  "CLOSED",
  "BLOCKED"
]);

export type WorkItemState = z.infer<typeof WorkItemStateSchema>;

export const AgentRoleSchema = z.enum([
  "product-delivery-orchestrator",
  "rnd-architecture-innovation",
  "frontend-ux-engineering",
  "backend-systems-engineering",
  "quality-security-privacy-release"
]);

export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ArtifactStatusSchema = z.enum(["pending", "running", "passed", "failed", "blocked"]);
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

export const StageArtifactSchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  stage: WorkItemStateSchema,
  ownerAgent: AgentRoleSchema,
  status: ArtifactStatusSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  decisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  filesChanged: z.array(z.string()).default([]),
  testsRun: z.array(z.string()).default([]),
  releaseReadiness: z.enum(["unknown", "not_ready", "ready"]).default("unknown"),
  nextStage: WorkItemStateSchema.nullable(),
  createdAt: z.string().datetime()
});

export type StageArtifact = z.infer<typeof StageArtifactSchema>;

export const AgentEventSchema = z.object({
  sequence: z.number().int().nonnegative().default(0),
  workItemId: z.string().min(1).optional(),
  stage: WorkItemStateSchema.optional(),
  ownerAgent: AgentRoleSchema.optional(),
  level: z.enum(["info", "warn", "error"]).default("info"),
  type: z.enum(["workflow_claimed", "stage_started", "stage_completed", "stage_failed", "verification", "release", "scheduler", "system"]),
  message: z.string().min(1),
  createdAt: z.string().datetime()
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const TeammateActivitySchema = z.object({
  agent: AgentRoleSchema,
  stage: WorkItemStateSchema,
  workItemId: z.string(),
  status: ArtifactStatusSchema,
  summary: z.string(),
  updatedAt: z.string().datetime()
});

export type TeammateActivity = z.infer<typeof TeammateActivitySchema>;

export const ResearchFindingSchema = z.object({
  topic: z.string().min(1),
  source: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  capturedAt: z.string().datetime()
});

export type ResearchFinding = z.infer<typeof ResearchFindingSchema>;

export const ToolIntegrationContextSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["electron", "mcp", "skill", "plugin", "knowledge"]),
  enabled: z.boolean(),
  summary: z.string().min(1),
  risks: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([])
});

export type ToolIntegrationContext = z.infer<typeof ToolIntegrationContextSchema>;

export const SharedContextSchema = z.object({
  workItemId: z.string().min(1),
  activeGoal: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
  buildContract: z.array(z.string()).default([]),
  contextNotes: z.array(z.string()).default([]),
  toolIntegrations: z.array(ToolIntegrationContextSchema).default([]),
  teammateActivity: z.array(TeammateActivitySchema).default([]),
  researchFindings: z.array(ResearchFindingSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  updatedAt: z.string().datetime()
});

export type SharedContext = z.infer<typeof SharedContextSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(["global", "repo", "work_item", "agent"]),
  projectId: z.string().min(1).optional(),
  repo: z.string().optional(),
  workItemId: z.string().optional(),
  agent: AgentRoleSchema.optional(),
  kind: z.enum(["decision", "research", "preference", "risk", "failure", "release", "architecture", "handoff"]),
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  importance: z.number().int().min(1).max(5).default(3),
  permanence: z.enum(["ephemeral", "session", "durable", "permanent"]).default("durable"),
  source: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional()
});

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const WorkItemSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  title: z.string().min(1),
  requestType: z.enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"]).default("feature"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  state: WorkItemStateSchema.default("NEW"),
  githubIssueNumber: z.number().int().positive().optional(),
  githubPrNumber: z.number().int().positive().optional(),
  branchName: z.string().optional(),
  dependencies: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema.default("medium"),
  frontendNeeded: z.boolean().default(true),
  backendNeeded: z.boolean().default(true),
  rndNeeded: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type WorkItem = z.infer<typeof WorkItemSchema>;

export const RepoCommandSchema = z.object({
  install: z.string().min(1),
  lint: z.string().min(1),
  typecheck: z.string().min(1),
  test: z.string().min(1),
  build: z.string().min(1),
  security: z.string().min(1),
  release: z.string().min(1)
});

export const ContextFileReferenceSchema = z.object({
  path: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  maxBytes: z.number().int().positive().max(64_000).default(12_000)
});

export const CapabilityActivationSchema = z.object({
  mode: z.enum(["manual", "on_demand", "always"]).default("on_demand"),
  stages: z.array(WorkItemStateSchema).default([]),
  agents: z.array(AgentRoleSchema).default([]),
  keywords: z.array(z.string().min(2)).default([])
});

export type CapabilityActivation = z.infer<typeof CapabilityActivationSchema>;

const McpServerBaseSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["browser", "debugging", "github", "filesystem", "database", "documentation", "security", "electron", "custom"]).default("custom"),
  description: z.string().optional(),
  enabled: z.boolean().default(false),
  activation: CapabilityActivationSchema.default({
    mode: "on_demand",
    stages: [],
    agents: [],
    keywords: []
  }),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  timeoutSeconds: z.number().int().positive().max(300).default(30),
  cacheToolsList: z.boolean().default(true),
  toolAllowlist: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([])
});

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
  McpServerBaseSchema.extend({
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).default([])
  }),
  McpServerBaseSchema.extend({
    transport: z.literal("streamable_http"),
    url: z.string().url()
  })
]);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const ElectronIntegrationSchema = z.object({
  enabled: z.boolean().default(false),
  preferredAutomation: z.enum(["playwright_test", "electron_mcp", "chrome_devtools_mcp", "custom"]).default("playwright_test"),
  appPath: z.string().optional(),
  launchCommand: z.string().optional(),
  devServerUrl: z.string().url().optional(),
  debugPort: z.number().int().min(1024).max(65_535).optional(),
  testCommand: z.string().optional(),
  artifactsDir: z.string().default(".agent-team/artifacts/electron"),
  requireIsolatedProfile: z.boolean().default(true),
  allowRemoteDebugging: z.boolean().default(false),
  notes: z.array(z.string().min(1)).default([])
});

export type ElectronIntegration = z.infer<typeof ElectronIntegrationSchema>;

export const CapabilityPackSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["skill", "plugin", "knowledge"]),
  enabled: z.boolean().default(true),
  summary: z.string().min(1),
  activation: CapabilityActivationSchema.default({
    mode: "on_demand",
    stages: [],
    agents: [],
    keywords: []
  }),
  contextFiles: z.array(ContextFileReferenceSchema).default([]),
  notes: z.array(z.string().min(1)).default([])
});

export type CapabilityPack = z.infer<typeof CapabilityPackSchema>;

export const ProjectIsolationSchema = z.object({
  requireExplicitRepoConnection: z.boolean().default(true),
  allowCrossProjectMemory: z.boolean().default(false),
  allowGlobalMemory: z.boolean().default(false),
  memoryNamespace: z.string().min(1).optional()
});

export type ProjectIsolation = z.infer<typeof ProjectIsolationSchema>;

export const ModelPolicySchema = z.object({
  primaryCodingModel: z.string().min(1).default("gpt-5.5"),
  researchModel: z.string().min(1).default("gpt-5.5"),
  reviewModel: z.string().min(1).default("gpt-5.5"),
  fallbackModel: z.string().min(1).default("gpt-5.4"),
  useBestAvailable: z.boolean().default(true)
});

export type ModelPolicy = z.infer<typeof ModelPolicySchema>;

export const TargetRepoConfigSchema = z.object({
  project: z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    isolation: ProjectIsolationSchema.default({
      requireExplicitRepoConnection: true,
      allowCrossProjectMemory: false,
      allowGlobalMemory: false
    })
  }).default({
    isolation: {
      requireExplicitRepoConnection: true,
      allowCrossProjectMemory: false,
      allowGlobalMemory: false
    }
  }),
  repo: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    defaultBranch: z.string().min(1),
    localPath: z.string().min(1)
  }),
  commands: RepoCommandSchema,
  context: z.object({
    includeDefaultContextDir: z.boolean().default(true),
    defaultContextDir: z.string().default(".agent-team/context"),
    maxFiles: z.number().int().positive().max(20).default(8),
    maxBytesPerFile: z.number().int().positive().max(64_000).default(12_000),
    files: z.array(ContextFileReferenceSchema).default([])
  }).default({
    includeDefaultContextDir: true,
    defaultContextDir: ".agent-team/context",
    maxFiles: 8,
    maxBytesPerFile: 12_000,
    files: []
  }),
  integrations: z.object({
    electron: ElectronIntegrationSchema.default({
      enabled: false,
      preferredAutomation: "playwright_test",
      artifactsDir: ".agent-team/artifacts/electron",
      requireIsolatedProfile: true,
      allowRemoteDebugging: false,
      notes: []
    }),
    mcpServers: z.array(McpServerConfigSchema).default([]),
    capabilityPacks: z.array(CapabilityPackSchema).default([])
  }).default({
    electron: {
      enabled: false,
      preferredAutomation: "playwright_test",
      artifactsDir: ".agent-team/artifacts/electron",
      requireIsolatedProfile: true,
      allowRemoteDebugging: false,
      notes: []
    },
    mcpServers: [],
    capabilityPacks: []
  }),
  models: ModelPolicySchema.default({
    primaryCodingModel: "gpt-5.5",
    researchModel: "gpt-5.5",
    reviewModel: "gpt-5.5",
    fallbackModel: "gpt-5.4",
    useBestAvailable: true
  }),
  release: z.object({
    mode: z.literal("autonomous"),
    githubActionsRequired: z.boolean().default(true),
    requireLocalRemoteSync: z.boolean().default(true),
    requireCleanWorktree: z.boolean().default(true),
    allowedRisk: z.object({
      low: z.enum(["autonomous", "autonomous_with_all_gates", "manual"]).default("autonomous"),
      medium: z.enum(["autonomous", "autonomous_with_all_gates", "manual"]).default("autonomous_with_all_gates"),
      high: z.enum(["autonomous", "autonomous_with_all_gates", "manual"]).default("autonomous_with_all_gates")
    }).default({
      low: "autonomous",
      medium: "autonomous_with_all_gates",
      high: "autonomous_with_all_gates"
    }),
    emergencyStopFile: z.string().default(".agent-team/emergency-stop")
  }),
  scheduler: z.object({
    mode: z.enum(["chatgpt_pro_assisted", "api_live", "dry_run"]).default("chatgpt_pro_assisted"),
    continuous: z.boolean().default(true),
    pollIntervalSeconds: z.number().int().positive().default(60),
    maxConcurrentWorkflows: z.number().int().positive().default(3),
    maxConcurrentAgentRuns: z.number().int().positive().default(5),
    maxConcurrentRepoWrites: z.number().int().positive().default(1),
    cooldownSecondsAfterFailure: z.number().int().positive().default(300),
    preferCodexForCodingWork: z.boolean().default(true),
    requireEventTrigger: z.boolean().default(true),
    parallelDiscovery: z.boolean().default(true),
    parallelFrontendBackend: z.boolean().default(true),
    parallelVerificationPlanning: z.boolean().default(true),
    allowParallelWorkItemsWhenDisjoint: z.boolean().default(true)
  }).default({
    mode: "chatgpt_pro_assisted",
    continuous: true,
    pollIntervalSeconds: 60,
    maxConcurrentWorkflows: 3,
    maxConcurrentAgentRuns: 5,
    maxConcurrentRepoWrites: 1,
    cooldownSecondsAfterFailure: 300,
    preferCodexForCodingWork: true,
    requireEventTrigger: true,
    parallelDiscovery: true,
    parallelFrontendBackend: true,
    parallelVerificationPlanning: true,
    allowParallelWorkItemsWhenDisjoint: true
  })
});

export type TargetRepoConfig = z.infer<typeof TargetRepoConfigSchema>;

export const VerificationSignalSchema = z.object({
  localChecksPassed: z.boolean(),
  githubActionsPassed: z.boolean(),
  cleanWorktree: z.boolean(),
  localRemoteSynced: z.boolean(),
  secretScanPassed: z.boolean(),
  rollbackPlanPresent: z.boolean(),
  releaseProofPresent: z.boolean().default(false),
  emergencyStopActive: z.boolean(),
  riskLevel: RiskLevelSchema
});

export type VerificationSignal = z.infer<typeof VerificationSignalSchema>;

export const ReleaseDecisionSchema = z.object({
  allowed: z.boolean(),
  recommendation: z.enum(["go", "no_go"]),
  reasons: z.array(z.string()),
  requiredFixes: z.array(z.string())
});

export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;
