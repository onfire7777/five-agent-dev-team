import { statSync } from "node:fs";
import { capture, run } from "./verify-lib.mjs";

const apply = process.argv.includes("--apply");
const maxAgeHours = Number(argValue("--max-age-hours") || 72);
const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
const worktrees = parseWorktrees(await capture("git", ["worktree", "list", "--porcelain"]));
const results = [];

for (const tree of worktrees) {
  if (!tree.path || tree.bare || tree.detached) continue;
  const normalizedPath = tree.path.replaceAll("/", "\\");
  if (!normalizedPath.toLowerCase().includes("\\.codex\\worktrees\\")) continue;

  const status = (await capture("git", ["-C", tree.path, "status", "--porcelain"])).trim();
  const mtime = statSync(tree.path).mtimeMs;
  const openPr = tree.branch ? await hasOpenPr(tree.branch.replace(/^refs\/heads\//, "")) : true;
  const safe = !status && !openPr && mtime < cutoff;

  results.push({ path: tree.path, branch: tree.branch, dirty: Boolean(status), openPr, stale: mtime < cutoff, safe });
  if (safe && apply) {
    await run("git", ["worktree", "remove", tree.path]);
  }
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

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
