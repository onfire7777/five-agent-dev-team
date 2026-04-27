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
      if (plugin.initCommand) await runLifecycleCommand(plugin.initCommand, config.repo.localPath);
      loaded.push({ plugin, contribution: plugin.contributions });
    }
  } catch (error) {
    await disposePlugins(loaded, config.repo.localPath);
    throw error;
  }
  return loaded;
}

export async function disposePlugins(plugins: LoadedPlugin[], cwd: string): Promise<void> {
  await Promise.all(
    plugins.map(async ({ plugin }) => {
      if (plugin.disposeCommand) await runLifecycleCommand(plugin.disposeCommand, cwd);
    })
  );
}

export function mergePluginContributions(config: TargetRepoConfig, plugins: LoadedPlugin[]): TargetRepoConfig {
  if (!plugins.length) return config;
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

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === '"') {
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
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) throw new Error("Unterminated quoted lifecycle command.");
  if (current) args.push(current);
  return args;
}
