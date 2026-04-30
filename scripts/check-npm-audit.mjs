import { execSync } from "node:child_process";

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
const unexpected = vulnerabilities.filter((vulnerability) =>
  ["moderate", "high", "critical"].includes(vulnerability.severity)
);

if (unexpected.length) {
  console.error("Production dependency vulnerabilities found:");
  for (const vulnerability of unexpected) {
    console.error(`- ${vulnerability.name}: ${vulnerability.severity}`);
  }
  process.exit(1);
}
