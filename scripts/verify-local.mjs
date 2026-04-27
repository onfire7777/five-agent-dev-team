import { run, runNpmScript } from "./verify-lib.mjs";

await run("npm", ["ci"]);
await runNpmScript("check");
await runNpmScript("audit:security");
await run("git", ["diff", "--check"]);

console.log("verify-local: PASS");
