import { execSync } from "node:child_process";

const allowedModerate = new Set([
  "@temporalio/activity",
  "@temporalio/client",
  "@temporalio/nexus",
  "@temporalio/worker",
  "uuid"
]);

let report;
try {
  execSync("npm audit --omit=dev --json", { stdio: ["ignore", "pipe", "pipe"] });
  console.log("npm production dependency audit passed.");
  process.exit(0);
} catch (error) {
  const stdout = error?.stdout?.toString() || "";
  if (!stdout.trim()) {
    process.stderr.write(error?.stderr?.toString() || "npm audit failed without JSON output.\n");
    process.exit(1);
  }
  report = JSON.parse(stdout);
}

const vulnerabilities = Object.values(report.vulnerabilities || {});
const unexpected = vulnerabilities.filter((vulnerability) => {
  if (vulnerability.severity === "high" || vulnerability.severity === "critical") return true;
  if (vulnerability.severity === "moderate") return !allowedModerate.has(vulnerability.name);
  return false;
});

if (unexpected.length) {
  console.error("Unexpected production dependency vulnerabilities:");
  for (const vulnerability of unexpected) {
    console.error(`- ${vulnerability.name}: ${vulnerability.severity}`);
  }
  process.exit(1);
}

console.warn("Only the documented Temporal/uuid moderate advisory is present.");
