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

export const SharedContextSchema = z.object({
  workItemId: z.string().min(1),
  activeGoal: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
  buildContract: z.array(z.string()).default([]),
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
  title: z.string().min(1),
  requestType: z.enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"]).default("feature"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  state: WorkItemStateSchema.default("NEW"),
  githubIssueNumber: z.number().int().positive().optional(),
  githubPrNumber: z.number().int().positive().optional(),
  branchName: z.string().optional(),
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

export const TargetRepoConfigSchema = z.object({
  repo: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    defaultBranch: z.string().min(1),
    localPath: z.string().min(1)
  }),
  commands: RepoCommandSchema,
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
