import type { ProjectCapabilityStatus, ProjectTeamStatus, StageArtifact, WorkItem } from "./schemas";

const now = () => new Date().toISOString();

const sampleCapabilities: ProjectCapabilityStatus[] = [
  {
    id: "github-cli",
    label: "GitHub CLI",
    kind: "github_cli",
    enabled: true,
    status: "ready",
    summary: "gh is available for branch, PR, workflow, release, and sync operations.",
    details: ["Deterministic local/release path"],
    projectScoped: true
  },
  {
    id: "github-mcp",
    label: "GitHub MCP",
    kind: "github_mcp",
    enabled: true,
    status: "ready",
    summary: "Official GitHub MCP server is available with dynamic toolsets.",
    details: ["stdio", "dynamic tool discovery", "read-only by default"],
    projectScoped: true
  },
  {
    id: "github-sdk",
    label: "GitHub SDK",
    kind: "github_sdk",
    enabled: true,
    status: "ready",
    summary: "Octokit can read repository metadata for controller coordination.",
    details: ["@octokit/rest"],
    projectScoped: true
  }
];

const sampleProjectTeams: ProjectTeamStatus[] = [
  {
    projectId: "sample-project",
    repo: "sample/repo",
    name: "sample/repo",
    active: true,
    status: "ready",
    agentsOnline: 5,
    agentsTotal: 5,
    queueDepth: 1,
    activeWorkItems: 3,
    maxParallelAgentRuns: 5,
    maxConcurrentWorkflows: 1,
    maxConcurrentRepoWrites: 1,
    memoryNamespace: "sample-project",
    capabilities: sampleCapabilities
  }
];

export function createSampleWorkItems(): WorkItem[] {
  return [
    {
      id: "WI-1289",
      projectId: "sample-project",
      repo: "sample/repo",
      title: "Add retry for API rate limit",
      requestType: "bug",
      priority: "high",
      state: "INTAKE",
      dependencies: [],
      acceptanceCriteria: ["Retries use exponential backoff", "No duplicate writes"],
      riskLevel: "medium",
      frontendNeeded: false,
      backendNeeded: true,
      rndNeeded: false,
      createdAt: now(),
      updatedAt: now()
    },
    {
      id: "WI-1290",
      projectId: "sample-project",
      repo: "sample/repo",
      title: "Implement user preferences",
      requestType: "feature",
      priority: "medium",
      state: "FRONTEND_BUILD",
      dependencies: [],
      acceptanceCriteria: ["Preferences persist", "Settings screen is accessible"],
      riskLevel: "medium",
      frontendNeeded: true,
      backendNeeded: true,
      rndNeeded: true,
      createdAt: now(),
      updatedAt: now()
    },
    {
      id: "WI-1291",
      projectId: "sample-project",
      repo: "sample/repo",
      title: "Payment flow e2e verification",
      requestType: "security",
      priority: "urgent",
      state: "VERIFY",
      dependencies: ["WI-1290"],
      acceptanceCriteria: ["Checkout succeeds", "Authorization is enforced"],
      riskLevel: "high",
      frontendNeeded: true,
      backendNeeded: true,
      rndNeeded: false,
      createdAt: now(),
      updatedAt: now()
    }
  ];
}

export function createSampleArtifacts(): StageArtifact[] {
  return [
    {
      artifactId: "sample-artifact-rnd-WI-1290",
      artifactKind: "RnDPacket",
      workItemId: "WI-1290",
      projectId: "sample-project",
      repo: "sample/repo",
      stage: "RND",
      ownerAgent: "rnd-architecture-innovation",
      status: "passed",
      title: "Architecture decision",
      summary: "Use a narrow preferences API with optimistic client updates.",
      decisions: ["Keep preferences behind existing auth middleware"],
      risks: ["Migration must preserve existing defaults"],
      filesChanged: [],
      testsRun: [],
      releaseReadiness: "unknown",
      nextStage: "CONTRACT",
      promptHash: "sample-prompt-rnd",
      skillIds: ["adr-authoring"],
      capabilityIds: [],
      bodyJson: {
        workItemId: "WI-1290",
        projectId: "sample-project",
        recommendation: "Use a narrow preferences API with optimistic client updates."
      },
      createdAt: now()
    },
    {
      artifactId: "sample-artifact-verify-WI-1291",
      artifactKind: "VerificationReport",
      workItemId: "WI-1291",
      projectId: "sample-project",
      repo: "sample/repo",
      stage: "VERIFY",
      ownerAgent: "quality-security-privacy-release",
      status: "running",
      title: "Release verification",
      summary: "Running checkout regression, authorization checks, and release readiness review.",
      decisions: [],
      risks: ["Payment behavior is high risk and requires every automated gate"],
      filesChanged: [],
      testsRun: ["npm test", "npm run security"],
      releaseReadiness: "not_ready",
      nextStage: "RELEASE",
      promptHash: "sample-prompt-verify",
      skillIds: ["verification-plan"],
      capabilityIds: [],
      bodyJson: {
        workItemId: "WI-1291",
        projectId: "sample-project",
        recommendation: "no_go"
      },
      createdAt: now()
    }
  ];
}

export function createSampleStatus() {
  return {
    system: {
      name: "AI Dev Team Controller",
      operational: true,
      emergencyStop: false,
      queueDepth: 7,
      agentsOnline: 5,
      agentsTotal: 5,
      githubSync: "synced",
      systemLoad: 32,
      executionMode: "ChatGPT Pro assisted",
      emergencyReason: "",
      scheduler: {
        continuous: true,
        pollIntervalSeconds: 15,
        maxConcurrentWorkflows: 3,
        maxConcurrentAgentRuns: 5,
        maxConcurrentRepoWrites: 1,
        completeLoopBeforeNextWorkItem: true,
        parallelDiscovery: true,
        parallelFrontendBackend: true,
        parallelVerificationPlanning: true
      }
    },
    projectTeams: sampleProjectTeams,
    pipeline: {
      NEW: 1,
      INTAKE: 3,
      RND: 2,
      PROPOSAL: 1,
      AWAITING_ACCEPTANCE: 0,
      CONTRACT: 1,
      FRONTEND_BUILD: 2,
      BACKEND_BUILD: 2,
      INTEGRATION: 1,
      VERIFY: 2,
      RELEASE: 1,
      CLOSED: 8,
      BLOCKED: 1
    },
    workItems: createSampleWorkItems(),
    artifacts: createSampleArtifacts(),
    releaseReadiness: {
      status: "ready",
      target: "v0.1.0",
      checks: [
        ["Tests", "98.7%"],
        ["Security Scan", "Passed"],
        ["Privacy Review", "Passed"],
        ["GitHub Actions", "Passed"],
        ["Local/Remote Sync", "0 / 0"]
      ]
    },
    logs: [
      ["10:23:45", "INFO", "quality-release", "Test suite completed: 412 passed, 0 failed", "WI-1291"],
      ["10:23:12", "INFO", "frontend", "Preferences UI branch pushed", "WI-1290"],
      ["10:22:31", "WARN", "quality-release", "High-risk release requires every gate", "WI-1291"],
      ["10:21:58", "INFO", "backend", "API contract implemented", "WI-1290"],
      ["10:21:09", "ERROR", "release", "Deployment blocked until rollback plan is verified", "WI-1291"]
    ],
    sharedContext: {
      activeThreads: [
        ["Product", "WI-1289", "Clarifying retry acceptance criteria"],
        ["R&D", "WI-1290", "Comparing preferences API contract options"],
        ["Frontend", "WI-1290", "Implementing accessible settings states"],
        ["Backend", "WI-1290", "Adding preference persistence endpoint"],
        ["Quality", "WI-1291", "Verifying rollback plan for high-risk release"]
      ],
      research: [
        "R&D packet captured build-vs-buy notes and API contract risks.",
        "Quality mapped high-risk payment release gates before implementation completed."
      ]
    }
  };
}
