import { run, runNpmScript, verifyComposeSafe } from "./verify-lib.mjs";

await run("npm", ["ci"]);
await runNpmScript("check");
await runNpmScript("test:e2e");
await runNpmScript("audit:security");
await run("npm", ["audit", "--audit-level=high"]);
await verifyComposeSafe();
await run("git", ["diff", "--check"]);

console.log("verify-pr-ready: PASS");
