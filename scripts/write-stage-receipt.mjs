import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { capture } from "./verify-lib.mjs";

const now = new Date();
const cycleId = argValue("--cycle") || now.toISOString().slice(0, 13);
const stage = required("--stage");
const mode = argValue("--mode") || "no-op";
const stateDir = join(homedir(), ".codex", "state");
const runDir = join(stateDir, "runs", cycleId);
mkdirSync(runDir, { recursive: true });

const receipt = {
  cycleId,
  stage,
  mode,
  claimId: argValue("--claim") || null,
  baseSha: await maybeGit(["rev-parse", "origin/main"]),
  headSha: await maybeGit(["rev-parse", "HEAD"]),
  branch: argValue("--branch") || await maybeGit(["branch", "--show-current"]),
  pr: numericArg("--pr"),
  filesTouched: listArg("--files"),
  checksRun: listArg("--checks"),
  checksPassed: boolArg("--passed"),
  blockers: listArg("--blockers"),
  handoff: argValue("--handoff") || "",
  writtenAt: now.toISOString(),
};

const path = join(runDir, `${stage}.json`);
writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
appendFileSync(join(stateDir, "five-agent-dev-team-ledger.ndjson"), `${JSON.stringify(receipt)}\n`);
console.log(JSON.stringify({ receipt: path, mode, stage }, null, 2));

async function maybeGit(args) {
  try {
    return (await capture("git", args)).trim() || null;
  } catch {
    return null;
  }
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

function listArg(name) {
  const value = argValue(name);
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
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
