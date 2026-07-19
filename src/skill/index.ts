/**
 * Skill System — self-improvement through skill extraction (GenericAgent pattern).
 *
 * After completing a task, the agent can:
 *   1. Extract the task pattern as a reusable "skill"
 *   2. Store skills for future use
 *   3. Match new tasks to known skills and apply them
 *
 * File location: `${MINI_AGENT_DATA_DIR}/skills/skills.json` (override with
 * `MINI_AGENT_DATA_DIR` env var).
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Example task that this skill handles */
  exampleTask: string;
  /** Steps to execute this skill */
  steps: string[];
  /** Tags for matching */
  tags: string[];
  /** How many times this skill has been used */
  useCount: number;
  createdAt: number;
  lastUsedAt?: number;
  /** When this skill's content (description/steps/tags) was last updated */
  lastUpdatedAt?: number;
}

const __pkgdir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(__pkgdir, "..", "..", ".mini-agent");
const DATA_ROOT = process.env.MINI_AGENT_DATA_DIR
  ? resolve(process.env.MINI_AGENT_DATA_DIR)
  : DEFAULT_DATA_DIR;
const SKILL_DIR = resolve(DATA_ROOT, "skills");
const SKILL_FILE = resolve(SKILL_DIR, "skills.json");

function ensureDir(): void {
  if (!existsSync(SKILL_DIR)) mkdirSync(SKILL_DIR, { recursive: true });
}

function loadAll(): Skill[] {
  ensureDir();
  if (!existsSync(SKILL_FILE)) return [];
  try {
    return JSON.parse(readFileSync(SKILL_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveAll(skills: Skill[]): void {
  ensureDir();
  const tmp = `${SKILL_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(skills, null, 2), "utf8");
  renameSync(tmp, SKILL_FILE);
}

/** Extract a skill from a completed task */
export function extractSkill(
  name: string,
  description: string,
  exampleTask: string,
  steps: string[],
  tags: string[]
): Skill {
  const skills = loadAll();
  const existingIdx = skills.findIndex((s) => s.name === name);
  const now = Date.now();

  if (existingIdx >= 0) {
    const existing = skills[existingIdx];
    // Compare: if the existing record has a newer lastUpdatedAt (e.g. a
    // concurrent process updated it after our loadAll), keep it.
    // Otherwise overwrite with the new content but preserve useCount.
    if (existing.lastUpdatedAt && existing.lastUpdatedAt > now) {
      // Existing is newer — only refresh lastUpdatedAt to mark a re-touch
      existing.lastUpdatedAt = now;
      saveAll(skills);
      console.error(`[Skill] Refreshed: "${name}" (kept newer version)`);
      return existing;
    }
    // Current call is newer (or no lastUpdatedAt yet) — overwrite content
    skills[existingIdx] = {
      id: existing.id,
      name,
      description,
      exampleTask,
      steps,
      tags,
      useCount: existing.useCount,
      createdAt: existing.createdAt,
      lastUsedAt: existing.lastUsedAt,
      lastUpdatedAt: now,
    };
    saveAll(skills);
    console.error(`[Skill] Updated: "${name}" (${tags.join(", ")})`);
    return skills[existingIdx];
  }

  // New skill — insert
  const skill: Skill = {
    id: `skill_${now}`,
    name,
    description,
    exampleTask,
    steps,
    tags,
    useCount: 0,
    createdAt: now,
    lastUpdatedAt: now,
  };
  skills.push(skill);
  saveAll(skills);
  console.error(`[Skill] Extracted: "${name}" (${tags.join(", ")})`);
  return skill;
}

/** Find skills matching a task */
export function matchSkill(task: string): Skill | null {
  const skills = loadAll();
  const lower = task.toLowerCase();

  // Score each skill by tag overlap
  const scored = skills
    .map((s) => {
      const tagScore = s.tags.filter((t) => lower.includes(t)).length * 10;
      const wordScore = s.steps.filter((step) => lower.includes(step.slice(0, 20))).length * 5;
      return { skill: s, score: tagScore + wordScore };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0].skill : null;
}

/** Record a skill use */
export function useSkill(skillId: string): void {
  const skills = loadAll();
  const skill = skills.find((s) => s.id === skillId);
  if (skill) {
    skill.useCount++;
    skill.lastUsedAt = Date.now();
    saveAll(skills);
  }
}

/** List all skills */
export function listSkills(): Skill[] {
  return loadAll().sort((a, b) => b.useCount - a.useCount);
}

/** Get skill stats */
export function getSkillStats(): { total: number; totalUses: number } {
  const skills = loadAll();
  return {
    total: skills.length,
    totalUses: skills.reduce((sum, s) => sum + s.useCount, 0),
  };
}
