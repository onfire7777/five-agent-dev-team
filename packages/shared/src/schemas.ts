import { z } from "zod";

export const WorkItemStateSchema = z.enum([
  "NEW",
  "INTAKE",
  "RND",
  "PROPOSAL",
  "AWAITING_ACCEPTANCE",
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

export const AgentMessageTypeSchema = z.enum([
  "status_update",
  "handoff",
  "research_finding",
  "architecture_decision",
  "contract_question",
  "contract_answer",
  "build_update",
  "blocker",
  "review_request",
  "verification_result",
  "release_decision",
  "loop_closure"
]);

export type AgentMessageType = z.infer<typeof AgentMessageTypeSchema>;

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

function defaultArtifactId(): string {
  return globalThis.crypto?.randomUUID?.() || `artifact-${Date.now().toString(36)}`;
}

const ABSOLUTE_LOCAL_PATH_REGEX = /^(?:\/|[A-Za-z]:[\\/])/;
const AbsoluteLocalPathSchema = z
  .string()
  .refine((value) => value.length > 0 && ABSOLUTE_LOCAL_PATH_REGEX.test(value), {
    message: "Local path must be an absolute path."
  });

const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  testable: z.boolean()
});

const ArtifactMarkdownSchema = z.string().min(1).max(32_000);
const ArtifactJsonBodySchema = z.record(z.string(), z.unknown()).default({});

export const StageArtifactSchema = z.object({
  artifactId: z.string().min(1).default(defaultArtifactId),
  artifactKind: z
    .enum([
      "WorkItemBrief",
      "RnDPacket",
      "BuildContract",
      "FrontendImplSummary",
      "BackendImplSummary",
      "VerificationReport",
      "ReleasePacket",
      "FinalSummary",
      "LoopStartSnapshot",
      "LoopClosureSummary",
      "StageArtifact"
    ])
    .default("StageArtifact"),
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
  promptHash: z.string().min(1).default("not-recorded"),
  skillIds: z.array(z.string().min(1)).default([]),
  capabilityIds: z.array(z.string().min(1)).default([]),
  bodyMd: ArtifactMarkdownSchema.optional(),
  bodyJson: ArtifactJsonBodySchema,
  createdAt: z.string().datetime()
});

export type StageArtifact = z.infer<typeof StageArtifactSchema>;

export const WorkItemBriefSchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  requestType: z.enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"]),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  businessGoal: z.string().min(1),
  userGoal: z.string().min(1),
  technicalGoal: z.string().min(1),
  scopeIn: z.array(z.string().min(1)),
  scopeOut: z.array(z.string().min(1)),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema),
  affectedAreas: z.array(z.enum(["frontend", "backend", "infra", "docs", "tests"])),
  flags: z.object({
    frontendNeeded: z.boolean(),
    backendNeeded: z.boolean(),
    rndNeeded: z.boolean()
  }),
  riskLevels: z.object({
    securityPrivacy: RiskLevelSchema,
    performance: RiskLevelSchema
  }),
  openQuestions: z.array(z.string().min(1)),
  routingDecision: z.string().min(1)
});
export type WorkItemBrief = z.infer<typeof WorkItemBriefSchema>;

export const RnDPacketSchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  options: z.array(
    z.object({
      title: z.string().min(1),
      summary: z.string().min(1),
      tradeoffs: z.array(z.string()).default([])
    })
  ),
  recommendation: z.string().min(1),
  rejectedAlternatives: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([])
});
export type RnDPacket = z.infer<typeof RnDPacketSchema>;

export const BuildContractSchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  frontendTasks: z.array(z.string()).default([]),
  backendTasks: z.array(z.string()).default([]),
  apiContracts: z.array(z.string()).default([]),
  dataContracts: z.array(z.string()).default([]),
  acceptanceTrace: z.array(z.string()).default([]),
  validationPlan: z.array(z.string()).default([])
});
export type BuildContract = z.infer<typeof BuildContractSchema>;

export const FrontendImplSummarySchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  filesChanged: z.array(z.string()).default([]),
  statesImplemented: z.array(z.string()).default([]),
  accessibilityNotes: z.array(z.string()).default([]),
  testsRun: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([])
});
export type FrontendImplSummary = z.infer<typeof FrontendImplSummarySchema>;

export const BackendImplSummarySchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  filesChanged: z.array(z.string()).default([]),
  apiChanges: z.array(z.string()).default([]),
  dataChanges: z.array(z.string()).default([]),
  observabilityNotes: z.array(z.string()).default([]),
  testsRun: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([])
});
export type BackendImplSummary = z.infer<typeof BackendImplSummarySchema>;

export const VerificationReportSchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  acceptanceResults: z
    .array(
      z.object({
        criterionId: z.string().min(1),
        passed: z.boolean(),
        evidence: z.string().min(1)
      })
    )
    .default([]),
  commandsRun: z.array(z.string()).default([]),
  securityFindings: z.array(z.string()).default([]),
  privacyFindings: z.array(z.string()).default([]),
  blockingGate: z.string().optional(),
  recommendation: z.enum(["go", "no_go"])
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

export const ReleasePacketSchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  tag: z.string().min(1),
  releaseNotes: z.string().min(1),
  gates: z
    .array(
      z.object({
        name: z.string().min(1),
        passed: z.boolean(),
        evidence: z.string().min(1)
      })
    )
    .default([]),
  rollback: z.object({
    command: z.string().min(1),
    verification: z.string().min(1)
  }),
  recommendation: z.enum(["go", "no_go"])
});
export type ReleasePacket = z.infer<typeof ReleasePacketSchema>;

export const FinalSummarySchema = z.object({
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  outcome: z.enum(["merged_released", "blocked", "closed_no_release"]),
  summary: z.string().min(1),
  pullRequestUrl: z.string().url().optional(),
  releaseUrl: z.string().url().optional(),
  followUps: z.array(z.string()).default([])
});
export type FinalSummary = z.infer<typeof FinalSummarySchema>;

export const LoopStartSnapshotSchema = z.object({
  loopRunId: z.string().min(1),
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  startRepoSha: z.string().min(1),
  startBranch: z.string().min(1),
  startClean: z.boolean(),
  startSynced: z.boolean(),
  latestCompletedLoop: z.string().optional(),
  createdAt: z.string().datetime()
});
export type LoopStartSnapshot = z.infer<typeof LoopStartSnapshotSchema>;

export const LoopClosureSummarySchema = z.object({
  loopRunId: z.string().min(1),
  workItemId: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  status: z.enum(["closed", "blocked", "failed"]),
  blockingGate: z.string().optional(),
  summary: z.string().min(1),
  endRepoSha: z.string().optional(),
  localRemoteSynced: z.boolean().default(false),
  createdAt: z.string().datetime()
});
export type LoopClosureSummary = z.infer<typeof LoopClosureSummarySchema>;

export const AgentEventSchema = z.object({
  sequence: z.number().int().nonnegative().default(0),
  workItemId: z.string().min(1).optional(),
  stage: WorkItemStateSchema.optional(),
  ownerAgent: AgentRoleSchema.optional(),
  level: z.enum(["info", "warn", "error"]).default("info"),
  type: z.enum([
    "workflow_claimed",
    "stage_started",
    "stage_completed",
    "stage_failed",
    "verification",
    "release",
    "scheduler",
    "system"
  ]),
  message: z.string().min(1),
  createdAt: z.string().datetime()
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const EmergencyControlRequestSchema = z.object({
  scope: z.string().trim().min(1).default("global"),
  reason: z.string().trim().min(1)
});

export type EmergencyControlRequest = z.infer<typeof EmergencyControlRequestSchema>;

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
  requestType: z
    .enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"])
    .default("feature"),
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

export const LoopTriggerSourceSchema = z.enum([
  "user",
  "github_issue",
  "opportunity_engine",
  "failed_ci",
  "scheduled_improvement",
  "manual"
]);

export type LoopTriggerSource = z.infer<typeof LoopTriggerSourceSchema>;

export const LoopRunStatusSchema = z.enum(["running", "awaiting_acceptance", "blocked", "closed", "failed"]);

export type LoopRunStatus = z.infer<typeof LoopRunStatusSchema>;

export const LoopRunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  memoryNamespace: z.string().min(1).optional(),
  workItemId: z.string().min(1),
  triggerSource: LoopTriggerSourceSchema.default("user"),
  status: LoopRunStatusSchema.default("running"),
  currentStage: WorkItemStateSchema.default("NEW"),
  startRepoSha: z.string().min(1).default("unknown"),
  startBranch: z.string().min(1).default("unknown"),
  startClean: z.boolean().default(false),
  startSynced: z.boolean().default(false),
  activeAgents: z.array(AgentRoleSchema).default([]),
  blockingReason: z.string().optional(),
  endRepoSha: z.string().optional(),
  githubPrNumber: z.number().int().positive().optional(),
  githubRunId: z.string().min(1).optional(),
  releaseTag: z.string().min(1).optional(),
  releaseState: z.string().optional(),
  closureSummary: z.string().optional(),
  nextRecommendedLoop: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  closedAt: z.string().datetime().optional()
});

export type LoopRun = z.infer<typeof LoopRunSchema>;

export const AgentMessageSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  workItemId: z.string().min(1),
  loopRunId: z.string().min(1),
  fromAgent: AgentRoleSchema,
  toAgent: AgentRoleSchema.optional(),
  type: AgentMessageTypeSchema,
  summary: z.string().min(1),
  details: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  requiresResponse: z.boolean().default(false),
  createdAt: z.string().datetime()
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const TeamContextSnapshotSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    repo: z.string().min(1),
    workItemId: z.string().min(1),
    loopRunId: z.string().min(1),
    currentStage: WorkItemStateSchema.default("NEW"),
    summary: z.string().min(1),
    activeGoal: z.string().min(1),
    latestLoopSummary: z.string().optional(),
    activeDirection: z.array(z.string()).default([]),
    activeAgents: z.array(AgentRoleSchema).default([]),
    teammateActivity: z.array(TeammateActivitySchema).default([]),
    decisions: z.array(z.string()).default([]),
    blockers: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
    recentMessages: z.array(AgentMessageSchema).default([]),
    updatedAt: z.string().datetime()
  })
  .superRefine((snapshot, ctx) => {
    snapshot.recentMessages.forEach((message, index) => {
      if (message.projectId !== snapshot.projectId) {
        ctx.addIssue({
          code: "custom",
          path: ["recentMessages", index, "projectId"],
          message: "Team context snapshots cannot include messages from another project."
        });
      }
      if (message.repo !== snapshot.repo) {
        ctx.addIssue({
          code: "custom",
          path: ["recentMessages", index, "repo"],
          message: "Team context snapshots cannot include messages from another repo."
        });
      }
      if (message.workItemId !== snapshot.workItemId) {
        ctx.addIssue({
          code: "custom",
          path: ["recentMessages", index, "workItemId"],
          message: "Team context snapshots cannot include messages from another work item."
        });
      }
      if (message.loopRunId !== snapshot.loopRunId) {
        ctx.addIssue({
          code: "custom",
          path: ["recentMessages", index, "loopRunId"],
          message: "Team context snapshots cannot include messages from another loop run."
        });
      }
    });
  });

export type TeamContextSnapshot = z.infer<typeof TeamContextSnapshotSchema>;

export const AgentHeartbeatSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  loopRunId: z.string().min(1).optional(),
  workItemId: z.string().min(1).optional(),
  agent: AgentRoleSchema,
  status: z.enum(["idle", "working", "blocked", "complete"]).default("idle"),
  currentStage: WorkItemStateSchema.optional(),
  currentTask: z.string().min(1).default("available for project-scoped work"),
  lastMessageId: z.string().min(1).optional(),
  updatedAt: z.string().datetime()
});

export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;

export const AgentTaskLeaseSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  loopRunId: z.string().min(1),
  workItemId: z.string().min(1),
  agent: AgentRoleSchema,
  stage: WorkItemStateSchema,
  task: z.string().min(1),
  purpose: z
    .enum(["coordination", "research", "proposal", "build", "verification", "release", "opportunity_scan"])
    .default("coordination"),
  status: z.enum(["active", "released", "expired"]).default("active"),
  leasedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});

export type AgentTaskLease = z.infer<typeof AgentTaskLeaseSchema>;

export const ProjectDirectionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  scope: z.enum(["next_loop", "standing"]).default("next_loop"),
  content: z.string().min(1),
  createdBy: z.enum(["human", "agent", "policy"]).default("human"),
  active: z.boolean().default(true),
  consumedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ProjectDirection = z.infer<typeof ProjectDirectionSchema>;

export const OpportunitySourceSchema = z.enum([
  "user_prompt",
  "github_issue",
  "failed_ci",
  "dependabot",
  "security_alert",
  "todo",
  "test_gap",
  "failed_loop",
  "recent_bug",
  "performance_signal",
  "documentation_gap",
  "repo_memory",
  "human_direction",
  "rnd_finding"
]);

export type OpportunitySource = z.infer<typeof OpportunitySourceSchema>;

export const OpportunityCandidateSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  source: OpportunitySourceSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  duplicateKey: z.string().min(1),
  score: z.number().min(0).max(100),
  impact: z.number().int().min(1).max(5).default(3),
  confidence: z.number().int().min(1).max(5).default(3),
  urgency: z.number().int().min(1).max(5).default(3),
  implementationSize: z.number().int().min(1).max(5).default(3),
  riskLevel: RiskLevelSchema.default("medium"),
  suggestedRequestType: z
    .enum(["feature", "bug", "performance", "security", "privacy", "refactor", "research"])
    .default("refactor"),
  status: z.enum(["suggested", "promoted", "dismissed", "duplicate"]).default("suggested"),
  workItemId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type OpportunityCandidate = z.infer<typeof OpportunityCandidateSchema>;

export const ProposalArtifactSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  workItemId: z.string().min(1),
  loopRunId: z.string().min(1).optional(),
  version: z.number().int().positive().default(1),
  status: z
    .enum(["draft", "awaiting_acceptance", "accepted", "revision_requested", "rejected", "auto_accepted"])
    .default("draft"),
  problem: z.string().min(1),
  researchSummary: z.string().min(1),
  recommendedApproach: z.string().min(1),
  rejectedAlternatives: z.array(z.string()).default([]),
  taskBreakdown: z.array(z.string()).default([]),
  buildContract: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  affectedFiles: z.array(z.string()).default([]),
  acceptanceTrace: z.array(z.string()).default([]),
  validationPlan: z.array(z.string()).default([]),
  rollbackNote: z.string().default("Rollback through the existing release gate and Git history if verification fails."),
  risks: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema.default("medium"),
  requiredTools: z.array(z.string()).default([]),
  autoAcceptEligible: z.boolean().default(false),
  requiresHumanAcceptance: z.boolean().default(false),
  policyReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ProposalArtifact = z.infer<typeof ProposalArtifactSchema>;

export const AcceptanceDecisionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  workItemId: z.string().min(1),
  proposalId: z.string().min(1),
  proposalVersion: z.number().int().positive().default(1),
  decision: z.enum(["accept", "edit_accept", "request_changes", "reject", "auto_accept"]),
  actor: z.enum(["human", "policy"]).default("human"),
  feedback: z.string().optional(),
  editedProposal: ProposalArtifactSchema.optional(),
  policyReason: z.string().optional(),
  createdAt: z.string().datetime()
});

export type AcceptanceDecision = z.infer<typeof AcceptanceDecisionSchema>;

export const OpportunityScanRunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repo: z.string().min(1),
  status: z.enum(["running", "complete", "failed"]).default("complete"),
  sources: z.array(OpportunitySourceSchema).default([]),
  repoSha: z.string().min(1).optional(),
  memoryVersion: z.string().min(1).optional(),
  candidatesCreated: z.number().int().nonnegative().default(0),
  summary: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional()
});

export type OpportunityScanRun = z.infer<typeof OpportunityScanRunSchema>;

export const ProjectConnectionInputSchema = z.object({
  projectId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  defaultBranch: z.string().min(1).default("main"),
  localPath: AbsoluteLocalPathSchema,
  githubUrl: z.string().url().optional(),
  webResearchEnabled: z.boolean().default(true),
  githubMcpEnabled: z.boolean().default(true),
  githubWriteEnabled: z.boolean().default(false),
  active: z.boolean().default(true)
});

export type ProjectConnectionInput = z.input<typeof ProjectConnectionInputSchema>;

export const ProjectCapabilityStatusSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z
    .enum([
      "github_cli",
      "github_mcp",
      "github_sdk",
      "repo",
      "memory",
      "mcp",
      "research",
      "security",
      "scheduler",
      "custom"
    ])
    .default("custom"),
  enabled: z.boolean().default(true),
  status: z.enum(["ready", "available", "needs_auth", "missing", "disabled", "error"]).default("available"),
  summary: z.string().min(1),
  details: z.array(z.string().min(1)).default([]),
  projectScoped: z.boolean().default(true)
});

export type ProjectCapabilityStatus = z.infer<typeof ProjectCapabilityStatusSchema>;

export const ProjectConnectionSchema = ProjectConnectionInputSchema.extend({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  repo: z.string().min(1),
  memoryNamespace: z.string().min(1),
  contextDir: z.string().default(".agent-team/context"),
  status: z
    .enum([
      "connected",
      "inactive",
      "missing_local_path",
      "not_git_repo",
      "remote_mismatch",
      "needs_github_auth",
      "config_written"
    ])
    .default("connected"),
  remoteUrl: z.string().optional(),
  ghAvailable: z.boolean().default(false),
  ghAuthed: z.boolean().default(false),
  githubCliVersion: z.string().optional(),
  githubMcpAvailable: z.boolean().default(false),
  githubMcpAuthenticated: z.boolean().default(false),
  githubMcpVersion: z.string().optional(),
  githubSdkConnected: z.boolean().default(false),
  githubSdkVersion: z.string().optional(),
  githubConnected: z.boolean().default(false),
  remoteMatches: z.boolean().default(false),
  defaultBranchVerified: z.boolean().default(false),
  capabilities: z.array(ProjectCapabilityStatusSchema).default([]),
  validationErrors: z.array(z.string()).default([]),
  lastValidatedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ProjectConnection = z.infer<typeof ProjectConnectionSchema>;

export const ProjectTeamStatusSchema = z.object({
  projectId: z.string().min(1),
  repo: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean(),
  status: z.enum(["ready", "attention", "inactive"]),
  agentsOnline: z.number().int().nonnegative(),
  agentsTotal: z.number().int().nonnegative(),
  queueDepth: z.number().int().nonnegative(),
  activeWorkItems: z.number().int().nonnegative(),
  maxParallelAgentRuns: z.number().int().positive(),
  maxConcurrentWorkflows: z.number().int().positive(),
  maxConcurrentRepoWrites: z.number().int().positive(),
  memoryNamespace: z.string().min(1),
  capabilities: z.array(ProjectCapabilityStatusSchema).default([])
});

export type ProjectTeamStatus = z.infer<typeof ProjectTeamStatusSchema>;

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
  category: z
    .enum([
      "browser",
      "debugging",
      "github",
      "filesystem",
      "database",
      "documentation",
      "security",
      "electron",
      "web_search",
      "custom"
    ])
    .default("custom"),
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
  preferredAutomation: z
    .enum(["playwright_test", "electron_mcp", "chrome_devtools_mcp", "custom"])
    .default("playwright_test"),
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

export const PluginContributionSchema = z.object({
  capabilities: z.array(CapabilityPackSchema).default([]),
  mcpServers: z.array(McpServerConfigSchema).default([]),
  skills: z
    .array(
      z.object({
        id: z.string().min(1),
        relativePath: z.string().min(1)
      })
    )
    .default([]),
  tools: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1)
      })
    )
    .default([]),
  releaseGates: z
    .array(
      z.object({
        id: z.string().min(1),
        command: z.string().min(1),
        required: z.boolean().default(true)
      })
    )
    .default([])
});

export type PluginContribution = z.infer<typeof PluginContributionSchema>;

export const AgentTeamPluginSchema = z.object({
  name: z.string().min(1),
  packageName: z.string().min(1),
  enabled: z.boolean().default(false),
  allowlisted: z.boolean().default(false),
  projectId: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  initCommand: z.string().min(1).optional(),
  disposeCommand: z.string().min(1).optional(),
  contributions: PluginContributionSchema.default({
    capabilities: [],
    mcpServers: [],
    skills: [],
    tools: [],
    releaseGates: []
  })
});

export type AgentTeamPlugin = z.infer<typeof AgentTeamPluginSchema>;

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
  project: z
    .object({
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      isolation: ProjectIsolationSchema.default({
        requireExplicitRepoConnection: true,
        allowCrossProjectMemory: false,
        allowGlobalMemory: false
      })
    })
    .default({
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
    localPath: AbsoluteLocalPathSchema
  }),
  commands: RepoCommandSchema,
  context: z
    .object({
      includeDefaultContextDir: z.boolean().default(true),
      defaultContextDir: z.string().default(".agent-team/context"),
      maxFiles: z.number().int().positive().max(20).default(8),
      maxBytesPerFile: z.number().int().positive().max(64_000).default(12_000),
      files: z.array(ContextFileReferenceSchema).default([])
    })
    .default({
      includeDefaultContextDir: true,
      defaultContextDir: ".agent-team/context",
      maxFiles: 8,
      maxBytesPerFile: 12_000,
      files: []
    }),
  integrations: z
    .object({
      electron: ElectronIntegrationSchema.default({
        enabled: false,
        preferredAutomation: "playwright_test",
        artifactsDir: ".agent-team/artifacts/electron",
        requireIsolatedProfile: true,
        allowRemoteDebugging: false,
        notes: []
      }),
      mcpServers: z.array(McpServerConfigSchema).default([]),
      capabilityPacks: z.array(CapabilityPackSchema).default([]),
      plugins: z.array(AgentTeamPluginSchema).default([])
    })
    .default({
      electron: {
        enabled: false,
        preferredAutomation: "playwright_test",
        artifactsDir: ".agent-team/artifacts/electron",
        requireIsolatedProfile: true,
        allowRemoteDebugging: false,
        notes: []
      },
      mcpServers: [],
      capabilityPacks: [],
      plugins: []
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
    allowedRisk: z
      .object({
        low: z.enum(["autonomous", "autonomous_with_all_gates", "manual"]).default("autonomous"),
        medium: z.enum(["autonomous", "autonomous_with_all_gates", "manual"]).default("autonomous_with_all_gates"),
        high: z.enum(["autonomous", "autonomous_with_all_gates", "manual"]).default("autonomous_with_all_gates")
      })
      .default({
        low: "autonomous",
        medium: "autonomous_with_all_gates",
        high: "autonomous_with_all_gates"
      }),
    emergencyStopFile: z.string().default(".agent-team/emergency-stop")
  }),
  scheduler: z
    .object({
      mode: z.enum(["chatgpt_pro_assisted", "api_live", "dry_run"]).default("chatgpt_pro_assisted"),
      continuous: z.boolean().default(true),
      pollIntervalSeconds: z.number().int().positive().default(15),
      maxConcurrentWorkflows: z.number().int().positive().default(3),
      maxConcurrentAgentRuns: z.number().int().positive().default(5),
      maxConcurrentRepoWrites: z.number().int().positive().default(1),
      completeLoopBeforeNextWorkItem: z.boolean().default(true),
      cooldownSecondsAfterFailure: z.number().int().positive().default(300),
      preferCodexForCodingWork: z.boolean().default(true),
      requireEventTrigger: z.boolean().default(true),
      parallelDiscovery: z.boolean().default(true),
      parallelFrontendBackend: z.boolean().default(true),
      parallelVerificationPlanning: z.boolean().default(true),
      allowParallelWorkItemsWhenDisjoint: z.boolean().default(true)
    })
    .default({
      mode: "chatgpt_pro_assisted",
      continuous: true,
      pollIntervalSeconds: 15,
      maxConcurrentWorkflows: 3,
      maxConcurrentAgentRuns: 5,
      maxConcurrentRepoWrites: 1,
      completeLoopBeforeNextWorkItem: true,
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
