import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { AgentRole, TargetRepoConfig, WorkItem, WorkItemState } from "../../shared/src";

export interface SkillActivationInput {
  workItem: WorkItem;
  stage: WorkItemState;
  agent: AgentRole;
  targetRepoConfig?: TargetRepoConfig;
}

export interface LoadedSkill {
  id: string;
  name: string;
  audience: AgentRole[];
  priority: number;
  body: string;
  sourcePath: string;
}

export interface SkillLoadResult {
  skills: LoadedSkill[];
  droppedSkillIds: string[];
}

type SkillFrontmatter = {
  id?: string;
  name?: string;
  audience?: AgentRole[];
  priority?: number;
  trigger?: {
    always?: boolean;
    stages?: WorkItemState[];
    keywords?: string[];
  };
};

const SKILL_TEXT_BUDGET = 16_384;
const MAX_SKILL_BODY_BYTES = 4_096;

export async function loadTriggeredSkills(input: SkillActivationInput): Promise<SkillLoadResult> {
  const root = path.resolve(process.cwd(), "packages/agents/skills");
  const files = await findSkillFiles(root);
  const candidates = (await Promise.all(files.map(readSkillFile))).filter(
    (skill): skill is LoadedSkill & { trigger?: SkillFrontmatter["trigger"] } => Boolean(skill)
  );

  const active = candidates
    .filter((skill) => skill.audience.includes(input.agent))
    .filter((skill) => shouldActivateSkill(skill.trigger, input))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  const skills: LoadedSkill[] = [];
  const droppedSkillIds: string[] = [];
  let used = 0;
  for (const skill of active) {
    const size = Buffer.byteLength(skill.body, "utf8");
    if (used + size > SKILL_TEXT_BUDGET) {
      droppedSkillIds.push(skill.id);
      continue;
    }
    used += size;
    skills.push(stripTrigger(skill));
  }
  return { skills, droppedSkillIds };
}

async function findSkillFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) return findSkillFiles(fullPath);
        return entry.isFile() && entry.name === "SKILL.md" ? [fullPath] : [];
      })
    );
    return nested.flat();
  } catch {
    return [];
  }
}

async function readSkillFile(
  filePath: string
): Promise<(LoadedSkill & { trigger?: SkillFrontmatter["trigger"] }) | null> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = parseSkill(raw, filePath);
  if (!parsed) return null;
  const bodyBytes = Buffer.byteLength(parsed.body, "utf8");
  if (bodyBytes > MAX_SKILL_BODY_BYTES) {
    throw new Error(`Skill ${parsed.id} body exceeds 4 KB: ${filePath}`);
  }
  return parsed;
}

function parseSkill(raw: string, filePath: string): (LoadedSkill & { trigger?: SkillFrontmatter["trigger"] }) | null {
  if (!raw.startsWith("---")) {
    throw new Error(`Skill is missing YAML frontmatter: ${filePath}`);
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error(`Skill frontmatter is not closed: ${filePath}`);
  }
  const frontmatter = YAML.parse(raw.slice(3, end).trim()) as SkillFrontmatter | null;
  if (!frontmatter?.id || !frontmatter.name || !frontmatter.audience?.length) {
    throw new Error(`Skill frontmatter must declare id, name, and audience: ${filePath}`);
  }
  return {
    id: frontmatter.id,
    name: frontmatter.name,
    audience: frontmatter.audience,
    priority: frontmatter.priority ?? 50,
    trigger: frontmatter.trigger,
    body: raw.slice(end + "\n---".length).trim(),
    sourcePath: filePath
  };
}

function shouldActivateSkill(trigger: SkillFrontmatter["trigger"], input: SkillActivationInput): boolean {
  if (!trigger) return false;
  if (trigger.always) return true;
  if (trigger.stages?.includes(input.stage)) return true;
  const haystack = [
    input.stage,
    input.workItem.title,
    input.workItem.requestType,
    input.workItem.priority,
    input.workItem.riskLevel,
    ...(input.workItem.acceptanceCriteria || [])
  ]
    .join("\n")
    .toLowerCase();
  return Boolean(trigger.keywords?.some((keyword) => haystack.includes(keyword.toLowerCase())));
}

function stripTrigger(skill: LoadedSkill & { trigger?: SkillFrontmatter["trigger"] }): LoadedSkill {
  const { trigger: _trigger, ...loaded } = skill;
  return loaded;
}
