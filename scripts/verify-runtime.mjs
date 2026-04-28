import { run, verifyComposeSafe } from "./verify-lib.mjs";

await verifyComposeSafe();

if (process.env.FIVE_AGENT_RUNTIME_CONFIG_ONLY === "1") {
  console.log("verify-runtime: config-only PASS");
} else {
  let primaryError;
  let cleanupError;
  try {
    await run("docker", ["compose", "up", "-d", "--build"]);
    await run("node", ["scripts/wait-for-health.mjs"]);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await run("docker", ["compose", "down", "-v"]);
    } catch (error) {
      cleanupError = error;
      if (primaryError) console.warn(`runtime cleanup skipped after primary failure: ${cleanupError.message}`);
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  console.log("verify-runtime: PASS");
}
