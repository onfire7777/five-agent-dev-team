import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture, run } from "./verify-lib.mjs";

const pr = required("--pr");
const stage = required("--stage");
const status = required("--status");
const notes = argValue("--notes") || "";
const payload = JSON.parse(await capture("gh", ["pr", "view", pr, "--json", "body"]));
const body = payload.body || "";
const marker = "<!-- codex-automation-status:start -->";
const endMarker = "<!-- codex-automation-status:end -->";
const block = buildBlock(body, stage, status, notes);
const nextBody = body.includes(marker)
  ? body.replace(new RegExp(`${marker}[\\s\\S]*?${endMarker}`), block)
  : `${body.trim()}\n\n${block}`.trim();
const dir = mkdtempSync(join(tmpdir(), "five-agent-pr-"));
const file = join(dir, "body.md");

writeFileSync(file, `${nextBody}\n`);
await run("gh", ["pr", "edit", pr, "--body-file", file], { quiet: true });
rmSync(dir, { recursive: true, force: true });
console.log(`updated PR #${pr} automation status`);

function buildBlock(existingBody, stageName, state, stageNotes) {
  const now = new Date().toISOString();
  const stages = [
    "R&D",
    "Backend/Core",
    "Frontend/UX",
    "Quality/Debug",
    "Security/DevOps",
    "Docs/Alignment",
    "Captain",
    "Janitor"
  ];
  const rows = Object.fromEntries(stages.map((name) => [name, { lastRun: "", status: "", notes: "" }]));
  const existing = existingBody.match(new RegExp(`${marker}[\\s\\S]*?${endMarker}`))?.[0] || "";

  for (const line of existing.split(/\r?\n/)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/);
    if (!match) continue;
    const name = match[1].trim();
    if (!rows[name]) continue;
    rows[name] = { lastRun: match[2].trim(), status: match[3].trim(), notes: match[4].trim() };
  }

  const normalizedStage = normalizeStage(stageName);
  rows[normalizedStage] = {
    lastRun: now,
    status: state,
    notes: stageNotes.replace(/\|/g, "/")
  };

  const tableRows = stages
    .map((name) => `| ${name} | ${rows[name].lastRun} | ${rows[name].status} | ${rows[name].notes} |`)
    .join("\n");
  return `${marker}
## Codex Automation Status

| Stage | Last Run | Status | Notes |
|---|---|---|---|
${tableRows}
${endMarker}
`;
}

function normalizeStage(value) {
  const normalized = String(value).toLowerCase().replace(/[_-]/g, " ");
  if (normalized.includes("r&d") || normalized.includes("research")) return "R&D";
  if (normalized.includes("backend")) return "Backend/Core";
  if (normalized.includes("frontend")) return "Frontend/UX";
  if (normalized.includes("quality") || normalized.includes("debug")) return "Quality/Debug";
  if (normalized.includes("security") || normalized.includes("devops")) return "Security/DevOps";
  if (normalized.includes("docs")) return "Docs/Alignment";
  if (normalized.includes("captain")) return "Captain";
  if (normalized.includes("janitor")) return "Janitor";
  return value;
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
