create table if not exists work_items (
  id text primary key,
  payload jsonb not null,
  state text not null,
  state_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table work_items add column if not exists state_changed_at timestamptz not null default now();

create table if not exists stage_artifacts (
  id bigserial primary key,
  work_item_id text not null,
  artifact_key text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table stage_artifacts add column if not exists artifact_key text;

create unique index if not exists stage_artifacts_artifact_key_idx
  on stage_artifacts (artifact_key)
  where artifact_key is not null;

create table if not exists agent_events (
  sequence bigserial primary key,
  work_item_id text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists memory_records (
  id text primary key,
  payload jsonb not null,
  key text,
  scope text not null,
  work_item_id text,
  importance integer not null,
  superseded_by text,
  updated_at timestamptz not null default now()
);

alter table memory_records add column if not exists key text;
alter table memory_records add column if not exists superseded_by text;

create unique index if not exists memory_records_live_key_idx
  on memory_records (
    scope,
    key,
    coalesce(payload->>'projectId', ''),
    coalesce(payload->>'repo', ''),
    coalesce(work_item_id, ''),
    coalesce(payload->>'agent', '')
  )
  where key is not null and superseded_by is null;

create table if not exists workflow_claims (
  work_item_id text primary key,
  claimed_at timestamptz not null default now()
);

create table if not exists project_connections (
  id text primary key,
  payload jsonb not null,
  active boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists controller_flags (
  key text primary key,
  value jsonb not null
);

create table if not exists team_bus_messages (
  id text primary key,
  project_id text not null,
  repo text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists loop_runs (
  id text primary key,
  project_id text not null,
  repo text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists project_directions (
  project_id text not null,
  repo text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, repo)
);

create table if not exists opportunities (
  id text primary key,
  project_id text not null,
  repo text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists opportunity_scan_runs (
  id text primary key,
  project_id text not null,
  repo text not null,
  payload jsonb not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists opportunity_scan_runs_project_repo_recency_idx
  on opportunity_scan_runs (project_id, repo, (coalesce(completed_at, started_at)) desc);

create table if not exists proposals (
  id text primary key,
  project_id text not null,
  repo text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
