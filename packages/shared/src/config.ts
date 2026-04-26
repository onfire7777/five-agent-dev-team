import fs from "node:fs";
import YAML from "yaml";
import { TargetRepoConfigSchema, type TargetRepoConfig } from "./schemas";

export function loadTargetRepoConfig(path = "agent-team.config.yaml"): TargetRepoConfig {
  const raw = fs.readFileSync(path, "utf8");
  return TargetRepoConfigSchema.parse(YAML.parse(raw));
}

