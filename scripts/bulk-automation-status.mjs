import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const APPROVED_AUTOMATION_IDS = [
  "research-five-agent-dev-team-feature-pipeline",
  "build-five-agent-dev-team-backend-core",
  "build-five-agent-dev-team-frontend-ux",
  "build-five-agent-dev-team-quality-debug",
  "build-five-agent-dev-team-security-devops",
  "build-five-agent-dev-team-docs-alignment",
  "build-five-agent-dev-team",
  "maintain-five-agent-dev-team-automation-health",
  "maintain-five-agent-dev-team-ops-janitor"
];

const VALID_STATUSES = new Set(["ACTIVE", "PAUSED"]);
const errors = [];
const apply = process.argv.includes("--apply");
const root = resolve(argValue("--root") || join(homedir(), ".codex", "automations"));
const desiredStatus = normalizeStatus(argValue("--status"), "--status", false);
const expectStatus = normalizeStatus(
  argValue("--expect-status") || (apply ? desiredStatus : null),
  "--expect-status",
  false
);
const ids = parseIds(argValue("--ids"));
const records = [];
let realRoot = null;

if (!desiredStatus && !expectStatus) {
  errors.push("provide --status=ACTIVE|PAUSED or --expect-status=ACTIVE|PAUSED");
}

if (!existsSync(root)) {
  errors.push(`automation root does not exist: ${redactPath(root)}`);
} else {
  try {
    realRoot = realpathSync(root);
  } catch (error) {
    errors.push(`cannot resolve automation root ${redactPath(root)}: ${describeIoError(error)}`);
  }
}

for (const id of ids) {
  records.push(loadAutomation(id));
}

if (errors.length === 0 && desiredStatus && apply) {
  for (const record of records) {
    if (record.changed) {
      writeTomlAtomic(record.path, record.nextToml);
    }
  }
}

const finalRecords = errors.length || !apply || !desiredStatus ? records : ids.map(loadAutomation);
const extraFiveAgentAutomationDirs = findExtraFiveAgentAutomationDirs();
const finalErrors = [...errors];

if (expectStatus) {
  for (const record of finalRecords) {
    if (!record.error && record.currentStatus !== expectStatus) {
      finalErrors.push(`${record.id} status is ${record.currentStatus}; expected ${expectStatus}`);
    }
  }
}

const summary = {
  ok: finalErrors.length === 0,
  apply,
  root: redactPath(root),
  desiredStatus,
  expectStatus,
  targetCount: ids.length,
  changedCount: records.filter((record) => record.changed).length,
  extraFiveAgentAutomationDirs,
  results: finalRecords.map(({ nextToml: _nextToml, toml: _toml, ...record }) => ({
    ...record,
    path: record.path ? redactPath(record.path) : record.path
  })),
  errors: finalErrors
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exit(1);
}

function loadAutomation(id) {
  const path = automationTomlPath(id);
  if (!path) {
    const error = `invalid or unsafe automation path for ${id}`;
    errors.push(error);
    return { id, path: null, error };
  }

  if (!existsSync(path)) {
    const error = `missing automation.toml for ${id}: ${redactPath(path)}`;
    errors.push(error);
    return { id, path, error };
  }

  let toml;
  try {
    toml = readFileSync(path, "utf8");
  } catch (error) {
    const readError = `failed to read automation.toml for ${id} at ${redactPath(path)}: ${describeIoError(error)}`;
    errors.push(readError);
    return { id, path, error: readError };
  }
  const configuredId = readTomlString(toml, "id");
  const currentStatus = readTomlString(toml, "status");
  const kind = readTomlString(toml, "kind");

  if (configuredId !== id) {
    errors.push(`${id} has mismatched id ${configuredId || "<missing>"}`);
  }
  if (kind !== "cron") {
    errors.push(`${id} has unsupported kind ${kind || "<missing>"}`);
  }
  if (!VALID_STATUSES.has(currentStatus)) {
    errors.push(`${id} has invalid status ${currentStatus || "<missing>"}`);
  }

  const nextToml = desiredStatus ? replaceStatus(toml, desiredStatus) : toml;
  return {
    id,
    path,
    currentStatus,
    desiredStatus,
    changed: Boolean(desiredStatus && currentStatus !== desiredStatus),
    toml,
    nextToml,
    error: null
  };
}

function automationTomlPath(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return null;
  const targetDir = resolve(root, id);
  const normalizedRoot = normalizePath(root);
  const normalizedTargetDir = normalizePath(targetDir);
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  if (!normalizedTargetDir.startsWith(rootPrefix)) return null;
  if (!realRoot || !existsSync(targetDir)) return join(targetDir, "automation.toml");

  let realTargetDir;
  try {
    realTargetDir = realpathSync(targetDir);
  } catch (error) {
    errors.push(`cannot resolve automation directory for ${id}: ${describeIoError(error)}`);
    return null;
  }

  const normalizedRealRoot = normalizePath(realRoot);
  const normalizedRealTargetDir = normalizePath(realTargetDir);
  const realRootPrefix = normalizedRealRoot.endsWith(sep) ? normalizedRealRoot : `${normalizedRealRoot}${sep}`;
  if (normalizedRealTargetDir !== normalizedTargetDir) {
    errors.push(`${id} resolves through an unsupported symlink`);
    return null;
  }
  if (!normalizedRealTargetDir.startsWith(realRootPrefix)) {
    errors.push(`${id} resolves outside the automation root`);
    return null;
  }

  return join(targetDir, "automation.toml");
}

function readTomlString(toml, key) {
  const match = toml.match(new RegExp(`^${key}\\s*=\\s*"((?:\\\\.|[^"])*)"`, "m"));
  return match?.[1] ?? null;
}

function replaceStatus(toml, status) {
  if (!/^status\s*=\s*"(?:\\.|[^"]*)"/m.test(toml)) {
    errors.push("cannot update automation without a status line");
    return toml;
  }
  return toml.replace(/^status\s*=\s*"(?:\\.|[^"]*)"/m, `status = "${status}"`);
}

function writeTomlAtomic(path, content) {
  const tempPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, content);
    try {
      renameSync(tempPath, path);
    } catch (renameError) {
      let cleanup = "";
      try {
        unlinkSync(tempPath);
      } catch (unlinkError) {
        cleanup = `; temp cleanup failed: ${describeIoError(unlinkError)}`;
      }
      errors.push(
        `failed to rename ${redactPath(tempPath)} to ${redactPath(path)}: ${describeIoError(renameError)}${cleanup}`
      );
    }
  } catch (error) {
    errors.push(`failed to write ${redactPath(tempPath)} for ${redactPath(path)}: ${describeIoError(error)}`);
  }
}

function redactPath(path) {
  const normalizedRoot = root.replaceAll("\\", "/");
  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath === normalizedRoot) return "<automation-root>";
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return `<automation-root>/${normalizedPath.slice(normalizedRoot.length + 1)}`;
  }

  const normalizedHome = homedir().replaceAll("\\", "/");
  if (normalizedPath === normalizedHome) return "<home>";
  if (normalizedPath.startsWith(`${normalizedHome}/`)) {
    return `<home>/${normalizedPath.slice(normalizedHome.length + 1)}`;
  }

  return "<redacted-path>";
}

function parseIds(value) {
  if (!value) return APPROVED_AUTOMATION_IDS;
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = parsed.filter((id) => !APPROVED_AUTOMATION_IDS.includes(id));
  if (unknown.length) {
    errors.push(`unknown automation id(s): ${unknown.join(", ")}`);
  }
  return [...new Set(parsed)];
}

function normalizeStatus(value, name, required) {
  if (!value) {
    if (required) errors.push(`missing ${name}`);
    return null;
  }
  const status = value.trim().toUpperCase();
  if (!VALID_STATUSES.has(status)) {
    errors.push(`${name} must be ACTIVE or PAUSED`);
    return null;
  }
  return status;
}

function findExtraFiveAgentAutomationDirs() {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name.includes("five-agent-dev-team"))
      .filter((name) => !APPROVED_AUTOMATION_IDS.includes(name))
      .sort();
  } catch (error) {
    errors.push(`failed to list automation root ${redactPath(root)}: ${describeIoError(error)}`);
    return [];
  }
}

function normalizePath(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function describeIoError(error) {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }
  return error instanceof Error ? error.name : "io_error";
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
