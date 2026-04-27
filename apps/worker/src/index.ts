import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

async function connectToTemporal(address: string): Promise<NativeConnection> {
  const maxAttempts = Number(process.env.TEMPORAL_CONNECT_ATTEMPTS || 30);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await NativeConnection.connect({ address });
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delayMs = Math.min(1000 * attempt, 10_000);
      console.warn(`Temporal is not ready at ${address}; retrying in ${delayMs}ms (${attempt}/${maxAttempts}).`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Temporal connection failed after ${maxAttempts} attempts.`);
}

async function main() {
  const address = process.env.TEMPORAL_ADDRESS || "127.0.0.1:7233";
  const connection = await connectToTemporal(address);
  const readyFile = process.env.WORKER_READY_FILE || "/tmp/agent-team-worker-ready";
  let readyTimer: NodeJS.Timeout | null = null;
  const markReady = async () => {
    await fs.mkdir(path.dirname(readyFile), { recursive: true });
    await fs.writeFile(readyFile, new Date().toISOString());
  };
  const cleanupReadyFile = async () => {
    if (readyTimer) clearInterval(readyTimer);
    await fs.rm(readyFile, { force: true }).catch(() => undefined);
  };

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || "default",
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || "agent-team",
    workflowsPath: require.resolve("./workflows"),
    activities
  });

  console.log(`AI Dev Team worker listening on Temporal task queue ${process.env.TEMPORAL_TASK_QUEUE || "agent-team"}`);
  await markReady();
  readyTimer = setInterval(() => {
    markReady().catch((error) =>
      console.warn(`Worker readiness heartbeat failed: ${error instanceof Error ? error.message : String(error)}`)
    );
  }, 5000);
  process.once("SIGINT", () => {
    cleanupReadyFile().finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    cleanupReadyFile().finally(() => process.exit(143));
  });

  try {
    await worker.run();
  } finally {
    await cleanupReadyFile();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
