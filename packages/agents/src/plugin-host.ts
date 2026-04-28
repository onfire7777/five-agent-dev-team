import childProcess from "node:child_process";
import util from "node:util";
import {
  AgentTeamPluginSchema,
  type AgentTeamPlugin,
  type PluginContribution,
  type TargetRepoConfig
} from "../../shared/src";

const execFile = util.promisify(childProcess.execFile);

export type LoadedPlugin = {
  plugin: AgentTeamPlugin;
  contribution: PluginContribution;
};

export async function initializePlugins(config: TargetRepoConfig): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  try {
    for (const candidate of config.integrations.plugins) {
      const plugin = AgentTeamPluginSchema.parse(candidate);
      if (!plugin.enabled) continue;
      if (!plugin.allowlisted) {
        throw new Error(`Plugin ${plugin.name} is enabled but not allowlisted for this project.`);
      }
      if (plugin.projectId && plugin.projectId !== (config.project.id || config.project.isolation.memoryNamespace)) {
        throw new Error(`Plugin ${plugin.name} is scoped to another project.`);
      }
      if (plugin.repo && plugin.repo !== `${config.repo.owner}/${config.repo.name}`) {
        throw new Error(`Plugin ${plugin.name} is scoped to another repo.`);
      }
      assertNoUnsupportedContributions(plugin);
      loaded.push({ plugin, contribution: plugin.contributions });
      if (plugin.initCommand) await runLifecycleCommand(plugin.initCommand, config.repo.localPath);
    }
  } catch (error) {
    await disposePlugins(loaded, config.repo.localPath).catch(() => undefined);
    throw error;
  }
  return loaded;
}

export async function disposePlugins(plugins: LoadedPlugin[], cwd: string): Promise<void> {
  const results = await Promise.allSettled(
    plugins.map(async ({ plugin }) => {
      if (plugin.disposeCommand) await runLifecycleCommand(plugin.disposeCommand, cwd);
    })
  );
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `Failed to dispose ${failures.length} plugin(s).`
    );
  }
}

export function mergePluginContributions(config: TargetRepoConfig, plugins: LoadedPlugin[]): TargetRepoConfig {
  if (!plugins.length) return config;
  for (const loaded of plugins) {
    assertNoUnsupportedContributions(loaded.plugin);
  }
  return {
    ...config,
    integrations: {
      ...config.integrations,
      capabilityPacks: [
        ...config.integrations.capabilityPacks,
        ...plugins.flatMap((loaded) => loaded.contribution.capabilities)
      ],
      mcpServers: [...config.integrations.mcpServers, ...plugins.flatMap((loaded) => loaded.contribution.mcpServers)],
      plugins: config.integrations.plugins
    }
  };
}

function assertNoUnsupportedContributions(plugin: AgentTeamPlugin): void {
  const unsupported = [
    plugin.contributions.skills.length ? "skills" : null,
    plugin.contributions.tools.length ? "tools" : null,
    plugin.contributions.releaseGates.length ? "releaseGates" : null
  ].filter((value): value is string => Boolean(value));
  if (unsupported.length) {
    throw new Error(`Plugin ${plugin.name} declares unsupported contributions: ${unsupported.join(", ")}.`);
  }
}

async function runLifecycleCommand(command: string, cwd: string): Promise<void> {
  const [file, ...args] = parseLifecycleCommand(command);
  if (!file) return;
  await execFile(file, args, {
    cwd,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
}

export function parseLifecycleCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let tokenStarted = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote === "'") {
      tokenStarted = true;
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === '"') {
      tokenStarted = true;
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === "\\") {
        const next = command[index + 1];
        if (next === '"' || next === "\\") {
          current += next;
          index += 1;
        } else {
          current += char;
        }
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      tokenStarted = true;
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    tokenStarted = true;
    current += char;
  }

  if (quote) throw new Error("Unterminated quoted lifecycle command.");
  if (tokenStarted) args.push(current);
  return args;
}
