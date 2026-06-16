import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(homedir(), ".codex");
const stateDir = join(root, "state");
const files = {
  buildSpec: join(root, "specs", "five-agent-dev-team.md"),
  automationGuide: join(root, "specs", "five-agent-dev-team-automation-team.md"),
  swarmState: join(stateDir, "five-agent-dev-team-swarm.md"),
  queue: join(stateDir, "five-agent-dev-team-queue.json")
};

const hashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, hashIfPresent(file)]));

if (process.argv.includes("--write")) {
  const controlPath = join(stateDir, "five-agent-dev-team-control.json");
  const control = readJsonIfPresent(controlPath);
  control.specHashes = hashes;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(controlPath, `${JSON.stringify(control, null, 2)}\n`);
}

console.log(JSON.stringify(hashes, null, 2));

function sha256(file) {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

function hashIfPresent(file) {
  try {
    return sha256(file);
  } catch {
    return null;
  }
}

function readJsonIfPresent(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
