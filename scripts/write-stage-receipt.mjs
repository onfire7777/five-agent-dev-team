import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { capture } from "./verify-lib.mjs";

const STAGES = new Map([
  ["0", { id: "research", order: 0 }],
  ["r&d", { id: "research", order: 0 }],
  ["rnd", { id: "research", order: 0 }],
  ["research", { id: "research", order: 0 }],
  ["feature-pipeline", { id: "research", order: 0 }],
  ["1", { id: "backend-core", order: 1 }],
  ["backend", { id: "backend-core", order: 1 }],
  ["backend-core", { id: "backend-core", order: 1 }],
  ["2", { id: "frontend-ux", order: 2 }],
  ["frontend", { id: "frontend-ux", order: 2 }],
  ["frontend-ux", { id: "frontend-ux", order: 2 }],
  ["3", { id: "quality-debug", order: 3 }],
  ["quality", { id: "quality-debug", order: 3 }],
  ["quality-debug", { id: "quality-debug", order: 3 }],
  ["4", { id: "security-devops", order: 4 }],
  ["security", { id: "security-devops", order: 4 }],
  ["security-devops", { id: "security-devops", order: 4 }],
  ["5", { id: "docs-alignment", order: 5 }],
  ["docs", { id: "docs-alignment", order: 5 }],
  ["docs-alignment", { id: "docs-alignment", order: 5 }],
  ["6", { id: "captain", order: 6 }],
  ["captain", { id: "captain", order: 6 }],
  ["meta", { id: "meta-health", order: 7 }],
  ["meta-health", { id: "meta-health", order: 7 }],
  ["automation-health", { id: "meta-health", order: 7 }],
  ["janitor", { id: "janitor", order: 8 }],
  ["ops-janitor", { id: "janitor", order: 8 }],
]);

const MODES = new Set(["no-op", "mutated", "blocked", "verified", "routed", "merged", "cleanup"]);
const now = new Date();
const cycleId = argValue("--cycle") || now.toISOString().slice(0, 13);
const stageInput = required("--stage");
const stageInfo = canonicalStage(stageInput);
const mode = argValue("--mode") || "no-op";

if (!MODES.has(mode)) {
  throw new Error(`invalid --mode ${mode}; expected one of ${[...MODES].join(", ")}`);
}

const stateDir = join(homedir(), ".codex", "state");
const runDir = join(stateDir, "runs", cycleId);
mkdirSync(runDir, { recursive: true });

const receipt = {
  schemaVersion: 1,
  project: {
    name: "five-agent-dev-team",
    localRepo: "C:\\Users\\burni\\Desktop\\five-agent-dev-team",
    githubRepo: "onfire7777/five-agent-dev-team",
  },
  cycleId,
  stage: stageInfo.id,
  stageOrder: stageInfo.order,
  mode,
  claimId: argValue("--claim") || null,
  baseSha: await maybeGit(["rev-parse", "origin/main"]),
  headSha: await maybeGit(["rev-parse", "HEAD"]),
  branch: argValue("--branch") || await maybeGit(["branch", "--show-current"]),
  pr: numericArg("--pr"),
  filesTouched: uniqueListArg("--files"),
  checksRun: uniqueListArg("--checks"),
  checksPassed: boolArg("--passed"),
  blockers: uniqueListArg("--blockers"),
  handoff: argValue("--handoff") || "",
  writtenAt: now.toISOString(),
};

const receiptPath = join(runDir, `${stageInfo.id}.json`);
const tempPath = `${receiptPath}.${process.pid}.tmp`;
writeFileSync(tempPath, `${JSON.stringify(receipt, null, 2)}\n`);
renameSync(tempPath, receiptPath);

const ledgerPath = join(stateDir, "five-agent-dev-team-ledger.ndjson");
appendFileSync(ledgerPath, `${JSON.stringify(receipt)}\n`);

console.log(JSON.stringify({ receipt: receiptPath, mode, stage: stageInfo.id }, null, 2));

async function maybeGit(args) {
  try {
    return (await capture("git", args)).trim() || null;
  } catch {
    return null;
  }
}

function canonicalStage(value) {
  const key = value.trim().toLowerCase();
  const stage = STAGES.get(key);
  if (!stage) {
    throw new Error(`invalid --stage ${value}; use one of research, backend-core, frontend-ux, quality-debug, security-devops, docs-alignment, captain, meta-health, janitor`);
  }
  return stage;
}

function required(name) {
  const value = argValue(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function uniqueListArg(name) {
  const value = argValue(name);
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function numericArg(name) {
  const value = argValue(name);
  return value ? Number(value) : null;
}

function boolArg(name) {
  const value = argValue(name);
  if (value === undefined) return null;
  return /^(1|true|yes|pass|passed)$/i.test(value);
}
