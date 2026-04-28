const PAUSE_BYPASS_STAGES = new Set(["meta-health"]);

export function canRunWhenControlPaused(stage) {
  return PAUSE_BYPASS_STAGES.has(normalizeStage(stage));
}

function normalizeStage(stage) {
  return String(stage || "")
    .trim()
    .toLowerCase();
}
