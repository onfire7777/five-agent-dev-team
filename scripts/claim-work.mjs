import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const controlPath = join(homedir(), ".codex", "state", "five-agent-dev-team-control.json");
const control = existsSync(controlPath) ? JSON.parse(readFileSync(controlPath, "utf8")) : { claims: [] };
control.claims ||= [];

const releaseId = argValue("--release");
if (releaseId) {
  control.claims = control.claims.filter((claim) => claim.id !== releaseId);
  save();
  console.log(JSON.stringify({ released: releaseId }, null, 2));
  process.exit(0);
}

const stage = required("--stage");
const holder = argValue("--holder") || `build-five-agent-dev-team-${stage}`;
const branch = required("--branch");
const pr = Number(argValue("--pr") || 0) || null;
const fileGlobs = required("--files")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const reason = required("--reason");
const ttlMinutes = Number(argValue("--ttl-minutes") || 50);
const now = new Date();
const expiresAt = new Date(now.getTime() + ttlMinutes * 60000);

for (const claim of control.claims) {
  const active = Date.parse(claim.expiresAt) > Date.now();
  if (!active) {
    throw new Error(`expired claim ${claim.id} must be reviewed before new mutation`);
  }
  if (claim.holder !== holder && overlaps(fileGlobs, claim.fileGlobs || [])) {
    throw new Error(`claim overlap with ${claim.id} held by ${claim.holder}`);
  }
}

const id = `claim-${now.toISOString().replace(/[:.]/g, "-")}-${stage}`;
const claim = {
  id,
  holder,
  stage,
  branch,
  pr,
  fileGlobs,
  startedAt: now.toISOString(),
  expiresAt: expiresAt.toISOString(),
  reason
};

control.claims.push(claim);
save();
console.log(JSON.stringify(claim, null, 2));

function save() {
  writeFileSync(controlPath, `${JSON.stringify(control, null, 2)}\n`);
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

function overlaps(left, right) {
  return left.some((a) =>
    right.some(
      (b) =>
        globPrefix(a) === globPrefix(b) ||
        globPrefix(a).startsWith(globPrefix(b)) ||
        globPrefix(b).startsWith(globPrefix(a))
    )
  );
}

function globPrefix(glob) {
  return String(glob)
    .replace(/\*\*.*$/, "")
    .replace(/\*.*$/, "");
}
