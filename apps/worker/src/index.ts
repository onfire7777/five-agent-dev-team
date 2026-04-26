import "dotenv/config";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

async function main() {
  const address = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || "default",
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || "agent-team",
    workflowsPath: require.resolve("./workflows"),
    activities
  });

  console.log(`AI Dev Team worker listening on Temporal task queue ${process.env.TEMPORAL_TASK_QUEUE || "agent-team"}`);
  await worker.run();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
