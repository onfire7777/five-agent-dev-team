export interface GitHubMcpStdioConfig {
  name: string;
  category: "github";
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface GitHubMcpConfigInput {
  name?: string;
  command?: string;
  readOnly?: boolean;
  tokenEnv?: string;
  extraArgs?: string[];
}

export function buildGitHubMcpStdioConfig(input: GitHubMcpConfigInput = {}): GitHubMcpStdioConfig {
  const tokenEnv = input.tokenEnv || "GITHUB_PERSONAL_ACCESS_TOKEN";
  return {
    name: input.name || "github-mcp",
    category: "github",
    transport: "stdio",
    command: input.command || "github-mcp-server",
    args: ["stdio", ...(input.readOnly === false ? [] : ["--read-only"]), ...(input.extraArgs || [])],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: `\${${tokenEnv}}`,
      GITHUB_TOKEN: `\${${tokenEnv}}`
    }
  };
}
