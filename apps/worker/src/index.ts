import "dotenv/config";
import fs from "node:fs/promises";
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
  const address = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const connection = await connectToTemporal(address);
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || "default",
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || "agent-team",
    workflowsPath: require.resolve("./workflows"),
    activities
  });

  console.log(`AI Dev Team worker listening on Temporal task queue ${process.env.TEMPORAL_TASK_QUEUE || "agent-team"}`);
  await fs.writeFile(process.env.WORKER_READY_FILE || "/tmp/agent-team-worker-ready", new Date().toISOString());
  await worker.run();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
