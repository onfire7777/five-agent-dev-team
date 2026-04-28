import { capture, requireBranch, run } from "./verify-lib.mjs";

await requireBranch("main");

const status = (await capture("git", ["status", "--porcelain"])).trim();
if (status) {
  throw new Error("verify-captain refused: local main is dirty");
}

await run("git", ["fetch", "--prune", "origin"], { quiet: true });

const sync = (await capture("git", ["rev-list", "--left-right", "--count", "origin/main...HEAD"])).trim();
const [behind, ahead] = sync.split(/\s+/).map(Number);

if (behind !== 0 || ahead !== 0) {
  throw new Error(`verify-captain refused: origin/main...HEAD is ${behind}/${ahead}`);
}

await run("node", ["scripts/verify-pr-ready.mjs"]);

if (process.env.FIVE_AGENT_SKIP_RUNTIME_SMOKE === "1") {
  console.log("skip runtime smoke: FIVE_AGENT_SKIP_RUNTIME_SMOKE=1");
} else {
  await run("node", ["scripts/verify-runtime.mjs"]);
}

console.log("verify-captain: PASS");
