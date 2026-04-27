import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./verify-lib.mjs";

const roots = ["tests/e2e", "apps/dashboard/tests", "e2e"];
const hasSpec = roots.some((root) => existsSync(root) && containsSpec(root));

if (!hasSpec) {
  console.log("skip playwright: no e2e specs found");
} else {
  await run("npx", ["playwright", "test"]);
}

function containsSpec(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && containsSpec(path)) return true;
    if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(entry.name)) return true;
  }
  return false;
}
