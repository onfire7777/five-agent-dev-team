const urls = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const targets = urls.length ? urls : ["http://127.0.0.1:4310/health", "http://127.0.0.1:5173"];
const timeoutMs = Number(process.env.FIVE_AGENT_HEALTH_TIMEOUT_MS || 120000);
const deadline = Date.now() + timeoutMs;

for (const url of targets) {
  await waitForUrl(url);
  console.log(`health: ${url} PASS`);
}

async function waitForUrl(url) {
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}
