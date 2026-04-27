import { run } from "./verify-lib.mjs";

await run("node", ["scripts/verify-pr-ready.mjs"]);

console.log("verify-ci: PASS");
