const PAUSE_BYPASS_STAGES = new Set(["research", "meta-health", "janitor"]);
const STAGE_ALIASES = new Map([
  ["0", "research"],
  ["r&d", "research"],
  ["rnd", "research"],
  ["feature-pipeline", "research"],
  ["7", "meta-health"],
  ["meta", "meta-health"],
  ["automation-health", "meta-health"],
  ["8", "janitor"],
  ["ops-janitor", "janitor"]
]);

export function canRunWhenControlPaused(stage) {
  return PAUSE_BYPASS_STAGES.has(canonicalStage(stage));
}

function canonicalStage(stage) {
  const normalized = normalizeStage(stage);
  return STAGE_ALIASES.get(normalized) || normalized;
}

function normalizeStage(stage) {
  return String(stage ?? "")
    .trim()
    .toLowerCase();
}
