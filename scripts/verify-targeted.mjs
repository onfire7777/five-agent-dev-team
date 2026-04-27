import { run, runNpmScript } from "./verify-lib.mjs";

await runNpmScript("typecheck");
await runNpmScript("lint");
await run("git", ["diff", "--check"]);

console.log("verify-targeted: PASS");
