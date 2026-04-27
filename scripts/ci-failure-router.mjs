import { readFileSync } from "node:fs";

const input = argValue("--text") || (argValue("--file") ? readFileSync(argValue("--file"), "utf8") : readStdin());
const lower = input.toLowerCase();
const route = classify(lower);

console.log(JSON.stringify(route, null, 2));

function classify(text) {
  if (/gitleaks|secret.scan|pull-requests: read|permission|403|docker|compose|npm audit|vulnerab/.test(text)) {
    return result("security-devops", "ci-security-devops", "Security/DevOps should inspect workflow permissions, Docker, Gitleaks, or audit policy.");
  }
  if (/controller|schema|store|worker|temporal|api route|zod/.test(text)) {
    return result("backend-core", "backend-contract", "Backend/Core should inspect controller, worker, schema, store, or Temporal behavior.");
  }
  if (/dashboard|css|viewport|playwright|browser|vite|react/.test(text)) {
    return result("frontend-ux", "frontend-browser", "Frontend/UX should inspect dashboard or browser behavior.");
  }
  if (/vitest|assert|expected|flaky|timeout|test failed|coverage/.test(text)) {
    return result("quality-debug", "test-regression", "Quality/Debug should reproduce and isolate the failing test.");
  }
  if (/docs|readme|acceptance matrix|runbook/.test(text)) {
    return result("docs-alignment", "docs-acceptance", "Docs/Alignment should reconcile documentation with verified behavior.");
  }
  if (/merge conflict|stale|behind|diverged|protected branch/.test(text)) {
    return result("captain", "integration-state", "Captain should handle merge or branch-state routing.");
  }
  return result("quality-debug", "unclassified", "Quality/Debug should classify the failure before mutation.");
}

function result(ownerStage, blocker, recommendedAction) {
  return {
    blocker,
    ownerStage,
    source: argValue("--source") || "local-input",
    repeatCount: Number(argValue("--repeat-count") || 1),
    recommendedAction,
  };
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
