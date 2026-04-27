import { run, runNpmScript, verifyComposeSafe } from "./verify-lib.mjs";

await run("npm", ["ci", "--include=dev"]);
await verifyComposeSafe();
await runNpmScript("check");
await runNpmScript("test:e2e");
await run("npm", ["audit", "--audit-level=high"]);
await runNpmScript("audit:security");
await run("git", ["diff", "--check"]);

console.log("verify-ci: PASS");
