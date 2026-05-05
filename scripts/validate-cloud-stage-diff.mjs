import { readFileSync } from "node:fs";
import { capture } from "./verify-lib.mjs";

const stage = requiredArg("--stage");
const targetPath = argValue("--target");
const budget = targetPath ? budgetFromTarget(targetPath) : {};
const maxFiles = Number(argValue("--max-files") || budget.maxFiles || 12);
const maxNetLines = Number(argValue("--max-net-lines") || budget.maxNetLines || 800);

const changedFiles = await listChangedFiles();
const netLines = await countNetLines(changedFiles);
const outOfScope = changedFiles.filter((file) => !isAllowed(stage, file));

const result = {
  stage,
  files: changedFiles.length,
  maxFiles,
  netLines,
  maxNetLines,
  outOfScope,
  pass: outOfScope.length === 0 && changedFiles.length <= maxFiles && netLines <= maxNetLines
};

console.log(JSON.stringify(result, null, 2));

if (!result.pass) {
  const reasons = [];
  if (outOfScope.length) reasons.push(`out-of-scope files: ${outOfScope.join(", ")}`);
  if (changedFiles.length > maxFiles) reasons.push(`files ${changedFiles.length}/${maxFiles}`);
  if (netLines > maxNetLines) reasons.push(`net lines ${netLines}/${maxNetLines}`);
  throw new Error(`cloud stage diff rejected for ${stage}: ${reasons.join("; ")}`);
}

async function listChangedFiles() {
  const tracked = await capture("git", ["diff", "--name-only", "--diff-filter=ACMRT", "HEAD"]);
  const untracked = await capture("git", ["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...lines(tracked), ...lines(untracked)])].sort();
}

async function countNetLines(files) {
  if (!files.length) return 0;
  const numstat = await capture("git", ["diff", "--numstat", "HEAD"]);
  const trackedFiles = new Set(lines(await capture("git", ["ls-files"])));
  let count = 0;
  for (const row of lines(numstat)) {
    const [added, deleted] = row.split(/\s+/);
    count += numberOrZero(added) + numberOrZero(deleted);
  }
  for (const file of files) {
    if (trackedFiles.has(file)) continue;
    count += countFileLines(file);
  }
  return count;
}

function countFileLines(file) {
  try {
    return readFileSync(file, "utf8").split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

function isAllowed(activeStage, file) {
  const normalized = file.replaceAll("\\", "/");
  const allowed = {
    backend: [
      "apps/controller/",
      "apps/worker/",
      "packages/shared/",
      "packages/github/",
      "packages/agents/src/",
      "tests/"
    ],
    frontend: ["apps/dashboard/", "tests/e2e/"],
    quality: ["tests/", "playwright.config.ts"],
    security: [
      ".github/",
      "Dockerfile",
      "docker-compose.yml",
      ".env.example",
      "package.json",
      "package-lock.json",
      "scripts/security",
      "scripts/check",
      "scripts/validate-",
      "scripts/verify-",
      "scripts/ci-",
      "scripts/diff-budget-check.mjs",
      "scripts/recover-workflow.ts",
      "release/"
    ],
    docs: ["README.md", "docs/", "release/notes.md", "packages/agents/skills/"]
  };
  return (allowed[activeStage] || []).some((entry) =>
    entry.endsWith("/") ? normalized.startsWith(entry) : normalized === entry || normalized.startsWith(entry)
  );
}

function budgetFromTarget(path) {
  try {
    const target = JSON.parse(readFileSync(path, "utf8"));
    const body = target.body || "";
    const files = body.match(/Diff budget:\s*max\s*(\d+)\s*files/i)?.[1];
    const linesMatch = body.match(/Diff budget:.*max\s*(\d+)\s*net lines/i)?.[1];
    return {
      maxFiles: files ? Number(files) : undefined,
      maxNetLines: linesMatch ? Number(linesMatch) : undefined
    };
  } catch {
    return {};
  }
}

function lines(value) {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requiredArg(name) {
  const value = argValue(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
