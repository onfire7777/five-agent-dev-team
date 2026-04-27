import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const SECRET_PATTERNS = [
  /\b(GH_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|PASSWORD|SECRET|TOKEN)=\S+/gi,
  /ghp_[A-Za-z0-9_]+/g,
  /github_pat_[A-Za-z0-9_]+/g,
  /sk-[A-Za-z0-9_-]+/g
];

export function redact(value) {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), String(value ?? ""));
}

export function hasFile(path) {
  return existsSync(path);
}

export function hasNpmScript(name) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  return Boolean(pkg.scripts?.[name]);
}

export async function run(command, args = [], options = {}) {
  const quiet = Boolean(options.quiet);
  const label = [command, ...args].join(" ");
  console.log(`> ${label}`);
  const needsShell = process.platform === "win32" && ["npm", "npx"].includes(command);
  const executable = needsShell ? [command, ...args.map(quoteCmdArg)].join(" ") : command;
  const spawnArgs = needsShell ? [] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, spawnArgs, {
      shell: needsShell,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    if (quiet) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      const output = redact(`${stdout}\n${stderr}`).trim().slice(0, 4000);
      reject(new Error(`${label} failed with exit code ${code}${output ? `\n${output}` : ""}`));
    });
  });
}

function quoteCmdArg(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_:@%+=,./\\-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

export async function capture(command, args = []) {
  return run(command, args, { quiet: true });
}

export async function runNpmScript(name) {
  if (!hasNpmScript(name)) {
    console.log(`skip npm run ${name}: script not defined`);
    return;
  }

  await run("npm", ["run", name]);
}

export async function verifyComposeSafe() {
  if (!hasFile("docker-compose.yml")) {
    console.log("skip docker compose config --no-interpolate: no docker-compose.yml");
    return;
  }

  await run("docker", ["compose", "config", "--no-interpolate"], {
    quiet: true
  });
  console.log("docker compose config --no-interpolate: PASS");
}
