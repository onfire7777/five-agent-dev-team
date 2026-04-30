import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const shell = findShell();
const testWithShell = shell ? it : it.skip;

describe("target repo pre-push hook", () => {
  testWithShell(
    "scans the pushed commit range instead of staged files",
    () => {
      const syntheticSecret = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
      const root = join(tmpdir(), `pre-push-hook-${process.pid}-${Date.now()}`);
      const repo = join(root, "repo");
      const bin = join(root, "bin");
      const argsFile = join(root, "gitleaks-args.txt");
      const hook = join(process.cwd(), "templates", "target-repo", ".agent-team", "hooks", "pre-push");
      mkdirSync(repo, { recursive: true });
      mkdirSync(bin, { recursive: true });

      try {
        writeFileSync(
          join(bin, "gitleaks"),
          `#!/usr/bin/env sh
printf '%s\\n' "$@" > "$GITLEAKS_ARGS_FILE"
[ "$1" = "git" ] || exit 2
previous=
log_opts=
for arg in "$@"; do
  if [ "$previous" = "--log-opts" ]; then
    log_opts="$arg"
    break
  fi
  previous="$arg"
done
[ -n "$log_opts" ] || exit 2
if git log -p "$log_opts" | grep -q "$SYNTHETIC_SECRET"; then
  exit 1
fi
exit 0
`,
          "utf8"
        );
        chmodSync(join(bin, "gitleaks"), 0o755);

        execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
        execFileSync("git", ["config", "user.email", "codex@example.com"], { cwd: repo, stdio: "ignore" });
        execFileSync("git", ["config", "user.name", "Codex"], { cwd: repo, stdio: "ignore" });
        writeFileSync(join(repo, "README.md"), "base\n", "utf8");
        execFileSync("git", ["add", "README.md"], { cwd: repo, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "base"], { cwd: repo, stdio: "ignore" });
        const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

        writeFileSync(join(repo, "secret.txt"), `${syntheticSecret}\n`, "utf8");
        execFileSync("git", ["add", "secret.txt"], { cwd: repo, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "add synthetic secret"], { cwd: repo, stdio: "ignore" });
        const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
        const env = shellEnv(bin, argsFile, syntheticSecret);

        expect(() =>
          execFileSync(shell!, [hook], {
            cwd: repo,
            input: `refs/heads/main ${headSha} refs/heads/main ${baseSha}\n`,
            env,
            stdio: ["pipe", "pipe", "pipe"]
          })
        ).toThrow();

        const args = readFileSync(argsFile, "utf8");
        expect(args).toContain("git");
        expect(args).toContain("--log-opts");
        expect(args).toContain(`${baseSha}..${headSha}`);
        expect(args).toContain("--redact");
        expect(args).not.toContain("--staged");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000
  );
});

function findShell(): string | null {
  if (process.platform !== "win32") return "sh";
  const candidates = ["C:\\Program Files\\Git\\usr\\bin\\sh.exe", "C:\\Program Files (x86)\\Git\\usr\\bin\\sh.exe"];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function shellPath(value: string): string {
  if (process.platform !== "win32") return value;
  return value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
}

function shellEnv(bin: string, argsFile: string, syntheticSecret: string): NodeJS.ProcessEnv {
  const existingPath = process.env.PATH || process.env.Path || "";
  const nextPath =
    process.platform === "win32"
      ? `${shellPath(bin)}:/usr/bin:/bin:${existingPath}`
      : `${shellPath(bin)}:${existingPath}`;
  return {
    ...process.env,
    GITLEAKS_ARGS_FILE: shellPath(argsFile),
    SYNTHETIC_SECRET: syntheticSecret,
    PATH: nextPath,
    Path: nextPath
  };
}
