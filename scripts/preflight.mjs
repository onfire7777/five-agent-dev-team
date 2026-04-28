import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canRunWhenControlPaused } from "./preflight-policy.mjs";
import { capture, run } from "./verify-lib.mjs";

const stage = argValue("--stage") || "unknown";
const allowLock = process.argv.includes("--allow-lock");
const allowBehind = process.argv.includes("--allow-behind");
const controlPath = join(homedir(), ".codex", "state", "five-agent-dev-team-control.json");
const control = existsSync(controlPath) ? JSON.parse(readFileSync(controlPath, "utf8")) : {};
const stateRoot = join(homedir(), ".codex");

if (control.paused && !canRunWhenControlPaused(stage)) {
  throw new Error(`preflight refused for ${stage}: paused: ${control.pauseReason || "no reason"}`);
}

if (control.integrationLock && !allowLock) {
  throw new Error(`preflight refused for ${stage}: integration lock is active`);
}

const expiredClaims = (control.claims || []).filter((claim) => Date.parse(claim.expiresAt) <= Date.now());
if (expiredClaims.length) {
  throw new Error(
    `preflight refused for ${stage}: ${expiredClaims.length} expired claim(s) require Captain/Janitor review`
  );
}

verifySpecHashes(control.specHashes || {});

const status = (await capture("git", ["status", "--porcelain"])).trim();
if (status) {
  throw new Error(`preflight refused for ${stage}: working tree is dirty`);
}

await run("git", ["fetch", "--all", "--prune"], { quiet: true });
const sync = (await capture("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"])).trim();
const [ahead, behind] = sync.split(/\s+/).map(Number);

if (behind > 0 && !allowBehind) {
  throw new Error(`preflight refused for ${stage}: branch is behind origin/main by ${behind} commit(s)`);
}

console.log(
  JSON.stringify(
    { stage, paused: Boolean(control.paused), lock: null, activeClaims: (control.claims || []).length, ahead, behind },
    null,
    2
  )
);

function verifySpecHashes(expected) {
  const files = {
    buildSpec: join(stateRoot, "specs", "five-agent-dev-team.md"),
    automationGuide: join(stateRoot, "specs", "five-agent-dev-team-automation-team.md"),
    swarmState: join(stateRoot, "state", "five-agent-dev-team-swarm.md"),
    queue: join(stateRoot, "state", "five-agent-dev-team-queue.json")
  };

  for (const [key, file] of Object.entries(files)) {
    if (!expected[key] || !existsSync(file)) continue;
    const actual = `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
    if (actual !== expected[key]) {
      throw new Error(
        `preflight refused for ${stage}: ${key} hash drift; run node scripts/spec-hash.mjs --write after intentional state/spec updates`
      );
    }
  }
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
