import pg from "pg";
import {
  createSampleArtifacts,
  createSampleStatus,
  createSampleWorkItems,
  StageArtifactSchema,
  MemoryRecordSchema,
  memoryFromArtifact,
  WorkItemSchema,
  type MemoryRecord,
  type StageArtifact,
  type WorkItem,
  type WorkItemState
} from "../../../packages/shared/src";

export interface ControllerStore {
  init(): Promise<void>;
  getStatus(): Promise<ReturnType<typeof createSampleStatus>>;
  listWorkItems(): Promise<WorkItem[]>;
  createWorkItem(input: Pick<WorkItem, "title" | "priority" | "requestType" | "acceptanceCriteria" | "riskLevel" | "frontendNeeded" | "backendNeeded" | "rndNeeded">): Promise<WorkItem>;
  updateWorkItemState(id: string, state: WorkItemState): Promise<void>;
  addArtifact(artifact: StageArtifact): Promise<void>;
  listMemories(workItemId?: string): Promise<MemoryRecord[]>;
  addMemories(memories: MemoryRecord[]): Promise<void>;
  setEmergencyStop(active: boolean, reason?: string): Promise<void>;
}

export class MemoryStore implements ControllerStore {
  private workItems = createSampleWorkItems();
  private artifacts = createSampleArtifacts();
  private memories: MemoryRecord[] = [];
  private emergencyStop = false;
  private emergencyReason = "";

  async init(): Promise<void> {
    return;
  }

  async getStatus() {
    const status = createSampleStatus();
    return {
      ...status,
      system: {
        ...status.system,
        operational: !this.emergencyStop,
        emergencyStop: this.emergencyStop,
        emergencyReason: this.emergencyReason,
        queueDepth: this.workItems.filter((item) => item.state !== "CLOSED").length
      },
      workItems: this.workItems,
      artifacts: this.artifacts
    };
  }

  async listWorkItems(): Promise<WorkItem[]> {
    return this.workItems;
  }

  async createWorkItem(input: Pick<WorkItem, "title" | "priority" | "requestType" | "acceptanceCriteria" | "riskLevel" | "frontendNeeded" | "backendNeeded" | "rndNeeded">): Promise<WorkItem> {
    const createdAt = new Date().toISOString();
    const workItem = WorkItemSchema.parse({
      id: `WI-${Math.floor(1000 + Math.random() * 9000)}`,
      state: "NEW",
      createdAt,
      updatedAt: createdAt,
      ...input
    });
    this.workItems.unshift(workItem);
    return workItem;
  }

  async updateWorkItemState(id: string, state: WorkItemState): Promise<void> {
    this.workItems = this.workItems.map((item) =>
      item.id === id ? { ...item, state, updatedAt: new Date().toISOString() } : item
    );
  }

  async addArtifact(artifact: StageArtifact): Promise<void> {
    this.artifacts.unshift(StageArtifactSchema.parse(artifact));
    await this.addMemories(memoryFromArtifact(artifact));
  }

  async listMemories(workItemId?: string): Promise<MemoryRecord[]> {
    if (!workItemId) return this.memories;
    return this.memories.filter((memory) => memory.workItemId === workItemId || memory.scope === "global");
  }

  async addMemories(memories: MemoryRecord[]): Promise<void> {
    const parsed = memories.map((memory) => MemoryRecordSchema.parse(memory));
    const byId = new Map(this.memories.map((memory) => [memory.id, memory]));
    for (const memory of parsed) {
      byId.set(memory.id, memory);
    }
    this.memories = [...byId.values()];
  }

  async setEmergencyStop(active: boolean, reason = ""): Promise<void> {
    this.emergencyStop = active;
    this.emergencyReason = active ? reason : "";
  }
}

export class PostgresStore extends MemoryStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    super();
    this.pool = new pg.Pool({ connectionString });
  }

  override async init(): Promise<void> {
    await this.pool.query(`
      create table if not exists work_items (
        id text primary key,
        payload jsonb not null,
        state text not null,
        updated_at timestamptz not null default now()
      );
      create table if not exists stage_artifacts (
        id bigserial primary key,
        work_item_id text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create table if not exists memory_records (
        id text primary key,
        payload jsonb not null,
        scope text not null,
        work_item_id text,
        importance integer not null,
        updated_at timestamptz not null default now()
      );
      create table if not exists controller_flags (
        key text primary key,
        value jsonb not null
      );
    `);
  }

  override async listWorkItems(): Promise<WorkItem[]> {
    const result = await this.pool.query("select payload from work_items order by updated_at desc");
    if (result.rows.length === 0) return super.listWorkItems();
    return result.rows.map((row) => WorkItemSchema.parse(row.payload));
  }

  override async createWorkItem(input: Pick<WorkItem, "title" | "priority" | "requestType" | "acceptanceCriteria" | "riskLevel" | "frontendNeeded" | "backendNeeded" | "rndNeeded">): Promise<WorkItem> {
    const workItem = await super.createWorkItem(input);
    await this.pool.query(
      "insert into work_items (id, payload, state) values ($1, $2, $3)",
      [workItem.id, workItem, workItem.state]
    );
    return workItem;
  }

  override async updateWorkItemState(id: string, state: WorkItemState): Promise<void> {
    await this.pool.query(
      "update work_items set state = $2, payload = jsonb_set(payload, '{state}', to_jsonb($2::text), true), updated_at = now() where id = $1",
      [id, state]
    );
    await super.updateWorkItemState(id, state);
  }

  override async addArtifact(artifact: StageArtifact): Promise<void> {
    await this.pool.query(
      "insert into stage_artifacts (work_item_id, payload) values ($1, $2)",
      [artifact.workItemId, artifact]
    );
    await super.addArtifact(artifact);
  }

  override async listMemories(workItemId?: string): Promise<MemoryRecord[]> {
    const result = workItemId
      ? await this.pool.query(
        "select payload from memory_records where work_item_id = $1 or scope = 'global' order by importance desc, updated_at desc",
        [workItemId]
      )
      : await this.pool.query("select payload from memory_records order by importance desc, updated_at desc");
    const stored = result.rows.map((row) => MemoryRecordSchema.parse(row.payload));
    return stored.length ? stored : super.listMemories(workItemId);
  }

  override async addMemories(memories: MemoryRecord[]): Promise<void> {
    for (const memory of memories.map((item) => MemoryRecordSchema.parse(item))) {
      await this.pool.query(
        `insert into memory_records (id, payload, scope, work_item_id, importance)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set payload = excluded.payload, scope = excluded.scope, work_item_id = excluded.work_item_id, importance = excluded.importance, updated_at = now()`,
        [memory.id, memory, memory.scope, memory.workItemId || null, memory.importance]
      );
    }
    await super.addMemories(memories);
  }

  override async setEmergencyStop(active: boolean, reason = ""): Promise<void> {
    await this.pool.query(
      "insert into controller_flags (key, value) values ('emergency_stop', $1) on conflict (key) do update set value = excluded.value",
      [{ active, reason, updatedAt: new Date().toISOString() }]
    );
    await super.setEmergencyStop(active, reason);
  }
}

export function createStore(): ControllerStore {
  if (process.env.DATABASE_URL) {
    return new PostgresStore(process.env.DATABASE_URL);
  }
  return new MemoryStore();
}
