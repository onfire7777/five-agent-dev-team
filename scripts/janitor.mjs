import { existsSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { capture, run } from "./verify-lib.mjs";

const apply = process.argv.includes("--apply");
const maxAgeHours = Number(argValue("--max-age-hours") || 72);
const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
const worktrees = parseWorktrees(await capture("git", ["worktree", "list", "--porcelain"]));
const results = [];

for (const tree of worktrees) {
  const treePath = tree.path || tree.worktree;
  if (!treePath || tree.bare) continue;
  const normalizedPath = treePath.replaceAll("/", "\\");
  if (!normalizedPath.toLowerCase().includes("\\.codex\\worktrees\\")) continue;

  let status = "";
  let mtime = 0;
  let probeError = null;
  try {
    status = (await capture("git", ["-C", treePath, "status", "--porcelain"])).trim();
    mtime = statSync(treePath).mtimeMs;
  } catch (error) {
    probeError = error instanceof Error ? error.message : String(error);
  }
  const branch = tree.branch ? tree.branch.replace(/^refs\/heads\//, "") : null;
  const openPr = branch ? await hasOpenPr(branch) : false;
  const stale = !probeError && mtime < cutoff;
  const safe = !probeError && !status && !openPr && stale;

  let removed = false;
  let emptyResidueRemoved = false;
  let removeError = null;
  if (safe && apply) {
    try {
      await run("git", ["worktree", "remove", "--force", treePath]);
      removed = !existsSync(treePath);
      emptyResidueRemoved = removeEmptyDir(treePath);
      removeEmptyDir(dirname(treePath));
    } catch (error) {
      removeError = error instanceof Error ? error.message : String(error);
      emptyResidueRemoved = removeEmptyDir(treePath);
      if (emptyResidueRemoved) removeEmptyDir(dirname(treePath));
    }
  }

  results.push({
    path: treePath,
    branch,
    detached: Boolean(tree.detached),
    dirty: Boolean(status),
    readable: !probeError,
    probeError,
    openPr,
    stale,
    safe,
    removed,
    emptyResidueRemoved,
    removeError
  });
}

console.log(JSON.stringify({ apply, maxAgeHours, worktrees: results }, null, 2));

function parseWorktrees(text) {
  const trees = [];
  let current = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (Object.keys(current).length) trees.push(current);
      current = {};
      continue;
    }
    const [key, ...rest] = line.split(" ");
    current[key] = rest.join(" ") || true;
  }
  if (Object.keys(current).length) trees.push(current);
  return trees;
}

async function hasOpenPr(branch) {
  try {
    const output = await capture("gh", ["pr", "list", "--head", branch, "--json", "number"]);
    return JSON.parse(output).length > 0;
  } catch {
    return true;
  }
}

function removeEmptyDir(path) {
  try {
    if (!existsSync(path)) return false;
    if (readdirSync(path, { withFileTypes: true }).length) return false;
    rmdirSync(path);
    return true;
  } catch {
    return false;
  }
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
