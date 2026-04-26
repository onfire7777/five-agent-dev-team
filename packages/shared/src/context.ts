import {
  SharedContextSchema,
  type ResearchFinding,
  type MemoryRecord,
  type SharedContext,
  type StageArtifact,
  type TeammateActivity,
  type WorkItem
} from "./schemas";

export function buildSharedContext(workItem: WorkItem, artifacts: StageArtifact[], memories: MemoryRecord[] = []): SharedContext {
  const relevant = artifacts.filter((artifact) => artifact.workItemId === workItem.id);
  const teammateActivity: TeammateActivity[] = relevant.map((artifact) => ({
    agent: artifact.ownerAgent,
    stage: artifact.stage,
    workItemId: artifact.workItemId,
    status: artifact.status,
    summary: artifact.summary,
    updatedAt: artifact.createdAt
  }));

  const researchFindings: ResearchFinding[] = relevant
    .filter((artifact) => artifact.ownerAgent === "rnd-architecture-innovation")
    .map((artifact) => ({
      topic: artifact.title,
      source: `${artifact.ownerAgent}:${artifact.stage}`,
      summary: artifact.summary,
      confidence: artifact.status === "passed" ? "high" : "medium",
      capturedAt: artifact.createdAt
    }));

  return SharedContextSchema.parse({
    workItemId: workItem.id,
    activeGoal: workItem.title,
    acceptanceCriteria: workItem.acceptanceCriteria,
    buildContract: relevant
      .filter((artifact) => artifact.stage === "CONTRACT")
      .flatMap((artifact) => artifact.decisions),
    teammateActivity,
    researchFindings,
    openQuestions: [],
    decisions: [
      ...relevant.flatMap((artifact) => artifact.decisions),
      ...memories.filter((memory) => memory.kind === "decision" || memory.kind === "architecture").map((memory) => memory.content)
    ],
    risks: [
      ...relevant.flatMap((artifact) => artifact.risks),
      ...memories.filter((memory) => memory.kind === "risk" || memory.kind === "failure").map((memory) => memory.content)
    ],
    blockers: relevant.filter((artifact) => artifact.status === "blocked").map((artifact) => artifact.summary),
    updatedAt: new Date().toISOString()
  });
}

export function formatSharedContext(context: SharedContext): string {
  const teammates = context.teammateActivity
    .map((activity) => `${activity.agent} on ${activity.stage}: ${activity.summary}`)
    .join("\n");
  const research = context.researchFindings
    .map((finding) => `${finding.topic} (${finding.confidence}): ${finding.summary}`)
    .join("\n");
  return [
    `Active goal: ${context.activeGoal}`,
    `Acceptance criteria: ${context.acceptanceCriteria.join("; ") || "none"}`,
    `Build contract: ${context.buildContract.join("; ") || "not locked yet"}`,
    `Teammate activity:\n${teammates || "none"}`,
    `Research findings:\n${research || "none"}`,
    `Decisions: ${context.decisions.join("; ") || "none"}`,
    `Risks: ${context.risks.join("; ") || "none"}`,
    `Blockers: ${context.blockers.join("; ") || "none"}`
  ].join("\n\n");
}

export function memoryFromArtifact(artifact: StageArtifact): MemoryRecord[] {
  const now = new Date().toISOString();
  const records: MemoryRecord[] = [];

  for (const [index, decision] of artifact.decisions.entries()) {
    records.push({
      id: `${artifact.workItemId}-${artifact.stage}-decision-${index}`,
      scope: "work_item",
      workItemId: artifact.workItemId,
      agent: artifact.ownerAgent,
      kind: artifact.stage === "RND" || artifact.stage === "CONTRACT" ? "architecture" : "decision",
      title: `${artifact.stage} decision`,
      content: decision,
      tags: [artifact.stage, artifact.ownerAgent],
      confidence: artifact.status === "passed" ? "high" : "medium",
      importance: artifact.stage === "RELEASE" || artifact.stage === "CONTRACT" ? 5 : 3,
      permanence: artifact.stage === "RND" || artifact.stage === "CONTRACT" || artifact.stage === "RELEASE" ? "permanent" : "durable",
      source: `${artifact.ownerAgent}:${artifact.stage}`,
      createdAt: now,
      updatedAt: now
    });
  }

  for (const [index, risk] of artifact.risks.entries()) {
    records.push({
      id: `${artifact.workItemId}-${artifact.stage}-risk-${index}`,
      scope: "work_item",
      workItemId: artifact.workItemId,
      agent: artifact.ownerAgent,
      kind: "risk",
      title: `${artifact.stage} risk`,
      content: risk,
      tags: [artifact.stage, artifact.ownerAgent, "risk"],
      confidence: "medium",
      importance: 4,
      permanence: "durable",
      source: `${artifact.ownerAgent}:${artifact.stage}`,
      createdAt: now,
      updatedAt: now
    });
  }

  return records;
}

export function selectRelevantMemories(memories: MemoryRecord[], workItem: WorkItem, limit = 12): MemoryRecord[] {
  const now = Date.now();
  return memories
    .filter((memory) => !memory.expiresAt || Date.parse(memory.expiresAt) > now)
    .filter((memory) =>
      memory.scope === "global" ||
      memory.workItemId === workItem.id ||
      memory.tags.some((tag) => workItem.title.toLowerCase().includes(tag.toLowerCase()))
    )
    .sort((a, b) => b.importance - a.importance || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}
