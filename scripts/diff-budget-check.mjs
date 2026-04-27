import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { capture } from "./verify-lib.mjs";

const controlPath = join(homedir(), ".codex", "state", "five-agent-dev-team-control.json");
const control = JSON.parse(readFileSync(controlPath, "utf8"));
const budget = control.diffBudget || {};
const maxFiles = Number(argValue("--max-files") || budget.maxFiles || 12);
const maxNetLines = Number(argValue("--max-net-lines") || budget.maxNetLines || 800);

const stat = await capture("git", ["diff", "--numstat", "HEAD"]);
const untracked = (await capture("git", ["ls-files", "--others", "--exclude-standard"]))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const rows = stat.trim() ? stat.trim().split(/\r?\n/) : [];
const changedFiles = new Set(rows.map((row) => row.split(/\s+/).slice(2).join(" ")).filter(Boolean));
for (const file of untracked) changedFiles.add(file);
const files = changedFiles.size;
let netLines = 0;

for (const row of rows) {
  const [added, deleted] = row.split(/\s+/);
  netLines += numberOrZero(added) + numberOrZero(deleted);
}

for (const file of untracked) {
  netLines += countFileLines(file);
}

if (files > maxFiles || netLines > maxNetLines) {
  throw new Error(`diff budget exceeded: files ${files}/${maxFiles}, net lines ${netLines}/${maxNetLines}`);
}

console.log(JSON.stringify({ files, maxFiles, netLines, maxNetLines, pass: true }, null, 2));

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countFileLines(file) {
  if (!existsSync(file) || statSync(file).isDirectory()) return 0;
  try {
    return readFileSync(file, "utf8").split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
