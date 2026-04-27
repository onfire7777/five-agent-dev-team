import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const CANONICAL_STAGES = new Set([
  "research",
  "backend-core",
  "frontend-ux",
  "quality-debug",
  "security-devops",
  "docs-alignment",
  "captain",
  "meta-health",
  "janitor",
]);
const MODES = new Set(["no-op", "mutated", "blocked", "verified", "routed", "merged", "cleanup"]);
const V1_REQUIRED_KEYS = [
  "schemaVersion",
  "project",
  "cycleId",
  "stage",
  "stageOrder",
  "mode",
  "claimId",
  "baseSha",
  "headSha",
  "branch",
  "pr",
  "filesTouched",
  "checksRun",
  "checksPassed",
  "blockers",
  "handoff",
  "writtenAt",
];
const strict = process.argv.includes("--strict");
const verbose = process.argv.includes("--verbose");
const legacyWarnings = process.argv.includes("--legacy-warnings");
const stateDir = join(homedir(), ".codex", "state");
const runsDir = join(stateDir, "runs");
const ledgerPath = join(stateDir, "five-agent-dev-team-ledger.ndjson");

const errors = [];
const warnings = [];
const legacyRecords = new Set();
const receiptSummaries = [];

validateLedger();
validateRunReceipts();

const summary = {
  ok: errors.length === 0 && (!strict || warnings.length === 0),
  strict,
  verbose,
  errorCount: errors.length,
  warningCount: warnings.length,
  legacyRecordCount: legacyRecords.size,
  legacyRecordSamples: [...legacyRecords].slice(0, 12),
  errors: verbose ? errors : errors.slice(0, 20),
  errorsTruncated: !verbose && errors.length > 20,
  warnings: verbose ? warnings : warnings.slice(0, 20),
  warningsTruncated: !verbose && warnings.length > 20,
  receiptCount: receiptSummaries.length,
  latestReceipts: receiptSummaries
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 12)
    .map(({ mtimeMs, ...receipt }) => receipt),
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exit(1);
}

function validateLedger() {
  if (!existsSync(ledgerPath)) {
    errors.push(`missing ledger: ${ledgerPath}`);
    return;
  }

  const lines = readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean);
  const exactKeys = new Map();

  for (const [index, line] of lines.entries()) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      errors.push(`ledger line ${index + 1} is not valid JSON: ${error.message}`);
      continue;
    }

    validateReceiptShape(entry, `ledger line ${index + 1}`, { warnLegacy: true });
    const key = stableLedgerKey(entry);
    exactKeys.set(key, (exactKeys.get(key) || 0) + 1);
  }

  const exactDuplicates = [...exactKeys.entries()].filter(([, count]) => count > 1);
  if (exactDuplicates.length) {
    warnings.push(`${exactDuplicates.length} exact duplicate ledger record(s) detected`);
  }
}

function validateRunReceipts() {
  if (!existsSync(runsDir)) {
    errors.push(`missing runs directory: ${runsDir}`);
    return;
  }

  for (const cycle of readdirSync(runsDir, { withFileTypes: true })) {
    if (!cycle.isDirectory()) continue;
    const cycleDir = join(runsDir, cycle.name);
    const seenStages = new Set();

    for (const file of readdirSync(cycleDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const path = join(cycleDir, file.name);
      let receipt;
      try {
        receipt = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        errors.push(`receipt ${path} is not valid JSON: ${error.message}`);
        continue;
      }

      const context = `receipt ${path}`;
      validateReceiptShape(receipt, context, { warnLegacy: true });
      const expectedName = `${receipt.stage}.json`;
      if (CANONICAL_STAGES.has(receipt.stage) && file.name !== expectedName) {
        warnings.push(`${context} has canonical stage ${receipt.stage} but filename is ${file.name}; expected ${expectedName}`);
      }
      if (seenStages.has(receipt.stage)) {
        warnings.push(`${cycleDir} contains more than one receipt for stage ${receipt.stage}`);
      }
      seenStages.add(receipt.stage);

      receiptSummaries.push({
        cycleId: receipt.cycleId,
        stage: receipt.stage,
        mode: receipt.mode,
        checksPassed: receipt.checksPassed,
        writtenAt: receipt.writtenAt,
        path,
        mtimeMs: statSync(path).mtimeMs,
      });
    }
  }
}

function validateReceiptShape(receipt, context, { warnLegacy }) {
  const legacy = receipt.schemaVersion === undefined;
  const requiredKeys = legacy
    ? ["cycleId", "stage"]
    : V1_REQUIRED_KEYS;

  for (const key of requiredKeys) {
    if (!(key in receipt)) errors.push(`${context} missing ${key}`);
  }

  if (legacy && warnLegacy) {
    legacyRecords.add(context);
    for (const key of ["mode", "checksRun", "handoff", "writtenAt"]) {
      if (!(key in receipt) && legacyWarnings) warnings.push(`${context} legacy record missing ${key}`);
    }
  }

  if (receipt.project?.name && receipt.project.name !== "five-agent-dev-team") {
    errors.push(`${context} has wrong project name: ${receipt.project.name}`);
  }

  if (!CANONICAL_STAGES.has(receipt.stage)) {
    const message = `${context} uses legacy or invalid stage name: ${receipt.stage}`;
    if (!legacy) {
      errors.push(message);
    } else if (!legacyWarnings) {
      legacyRecords.add(context);
    } else if (warnLegacy) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  }

  if (receipt.mode && !MODES.has(receipt.mode)) {
    errors.push(`${context} has invalid mode: ${receipt.mode}`);
  }

  for (const key of ["filesTouched", "checksRun", "blockers"]) {
    if (key in receipt && !Array.isArray(receipt[key])) {
      errors.push(`${context} ${key} must be an array`);
    }
  }

  if (receipt.schemaVersion === undefined && warnLegacy && legacyWarnings) {
    warnings.push(`${context} is legacy format without schemaVersion`);
  }
}

function stableLedgerKey(entry) {
  return JSON.stringify({
    cycleId: entry.cycleId,
    stage: entry.stage,
    mode: entry.mode,
    filesTouched: entry.filesTouched,
    checksRun: entry.checksRun,
    checksPassed: entry.checksPassed,
    blockers: entry.blockers,
    handoff: entry.handoff,
    writtenAt: entry.writtenAt,
  });
}
