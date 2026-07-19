/**
 * Advanced internal tools — workflow orchestration, deep research,
 * persistent memory, and skill extraction.
 *
 * These are intentionally registered ONLY with the ToolManager (never
 * via FastMCP.addTool). External clients can reach them exclusively
 * through `run_agent`, which routes through the ReAct loop and the
 * single embedded entrypoint.
 *
 * Each tool returns a plain `ToolDefinition` that the registry merges
 * into the agent's prompt and tool dispatcher.
 */

import type { ToolDefinition } from "./types.js";

import { runWorkflow, deepResearch } from "../workflow/index.js";
import {
  remember as rememberEntry,
  recall as recallEntries,
  searchMemories,
  getMemoryStats,
} from "../memory/index.js";
import {
  extractSkill as extractSkillEntry,
  matchSkill as matchSkillEntry,
  listSkills as listSkillEntries,
  getSkillStats,
  useSkill as useSkillEntry,
} from "../skill/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function ok<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function jsonOrText(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

// Workflow / deep research must NEVER recursively call run_agent — the
// Agent invoking run_workflow must not see run_workflow itself or its
// friends in its tool list. Pass a tightened allowlist at the Agent call
// site; all internal modules already have ToolManager handles.

// ─── run_workflow ──────────────────────────────────────────────────────────

export const runWorkflowTool: ToolDefinition = {
  name: "run_workflow",
  description:
    "Run a directed-acyclic-graph workflow. Each step is an agent task; steps with dependsOn " +
    "see predecessor results injected into their task string. Returns step-level success/duration.",
  inputSchema: {
    type: "object",
    properties: {
      steps: {
        type: "string",
        description:
          "JSON-encoded array of workflow steps: [{id, task, dependsOn?, label?, timeout?}]",
      },
    },
    required: ["steps"],
  },
  handler: async (args) => {
    const raw = args.steps as unknown;
    if (typeof raw !== "string") {
      return jsonOrText("Error: steps must be a JSON string", true);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return jsonOrText(`Error: steps JSON parse failed: ${(err as Error).message}`, true);
    }
    if (!Array.isArray(parsed)) {
      return jsonOrText("Error: steps must be a JSON array", true);
    }
    try {
      const result = await runWorkflow(parsed as Parameters<typeof runWorkflow>[0], {
        // Exclude self and other orchestration tools from nested Agent calls.
        toolAllowlist: ["calculator", "text_stats", "text_transform", "unit_convert", "datetime_info", "random_gen"],
      });
      return ok({
        success: result.success,
        totalDurationMs: result.totalDurationMs,
        steps: result.steps,
      });
    } catch (err) {
      return jsonOrText(`Error: ${(err as Error).message}`, true);
    }
  },
};

// ─── deep_research ─────────────────────────────────────────────────────────

export const deepResearchTool: ToolDefinition = {
  name: "deep_research",
  description:
    "Run a 3-stage deep research pipeline: decompose → search per sub-question → synthesize report. " +
    "Each stage uses the embedded agent, AnySearch, and LLM. Returns sub-questions, findings, and " +
    "Markdown report.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The research question to investigate",
      },
    },
    required: ["question"],
  },
  handler: async (args) => {
    const question = args.question as unknown;
    if (typeof question !== "string" || question.trim().length === 0) {
      return jsonOrText("Error: question must be a non-empty string", true);
    }
    try {
      const result = await deepResearch(question, {
        toolAllowlist: [
          "calculator",
          "text_stats",
          "text_transform",
          "unit_convert",
          "datetime_info",
          "random_gen",
          "anysearch_search",
          "anysearch_batch_search",
          "anysearch_extract",
          "anysearch_get_sub_domains",
        ],
      });
      return ok({
        success: true,
        question: result.question,
        subQuestions: result.subQuestions,
        totalSteps: result.totalSteps,
        durationMs: result.durationMs,
        report: result.report,
      });
    } catch (err) {
      return jsonOrText(`Error: ${(err as Error).message}`, true);
    }
  },
};

// ─── Memory ────────────────────────────────────────────────────────────────

export const rememberTool: ToolDefinition = {
  name: "remember",
  description: "Store a memory (fact / preference / task / conversation) with tags for later recall.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["fact", "preference", "task", "skill", "conversation"] },
      content: { type: "string" },
      tags: { type: "string", description: "Comma-separated tag list" },
    },
    required: ["type", "content"],
  },
  handler: async (args) => {
    const t = args.type as "fact" | "preference" | "task" | "skill" | "conversation";
    const content = args.content as string;
    const tagsStr = (args.tags as string | undefined) ?? "";
    const tags = tagsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (typeof content !== "string" || content.length === 0) {
      return jsonOrText("Error: content is required", true);
    }
    rememberEntry(t, content, tags);
    return ok({ remembered: true, type: t, tags });
  },
};

export const recallTool: ToolDefinition = {
  name: "recall",
  description: "Recall memories matching any of the supplied tags. Returns up to `limit` records.",
  inputSchema: {
    type: "object",
    properties: {
      tags: { type: "string", description: "Comma-separated tag list" },
      limit: { type: "integer", description: "Maximum records to return (default 5)" },
    },
    required: ["tags"],
  },
  handler: async (args) => {
    const tagsStr = args.tags as string;
    const limit = typeof args.limit === "number" ? args.limit : 5;
    const tags = tagsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const memories = recallEntries(tags, limit);
    return ok({ count: memories.length, memories });
  },
};

export const searchMemoriesTool: ToolDefinition = {
  name: "search_memories",
  description: "Search stored memories by keyword (case-insensitive substring on content).",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string" },
      limit: { type: "integer" },
    },
    required: ["keyword"],
  },
  handler: async (args) => {
    const kw = args.keyword as string;
    const limit = typeof args.limit === "number" ? args.limit : 5;
    const memories = searchMemories(kw, limit);
    return ok({ count: memories.length, memories });
  },
};

export const memoryStatsTool: ToolDefinition = {
  name: "memory_stats",
  description: "Get aggregate memory statistics (total count, breakdown by type).",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: async () => ok(getMemoryStats()),
};

// ─── Skill ─────────────────────────────────────────────────────────────────

export const extractSkillTool: ToolDefinition = {
  name: "extract_skill",
  description:
    "Extract a reusable skill from a previous task. Future tasks that match skill tags/steps will " +
    "auto-apply this skill as a hint in their prompt.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      exampleTask: { type: "string" },
      steps: { type: "string", description: "JSON array of step description strings" },
      tags: { type: "string", description: "Comma-separated tag list" },
    },
    required: ["name", "description", "exampleTask", "steps", "tags"],
  },
  handler: async (args) => {
    const name = args.name as string;
    const description = args.description as string;
    const exampleTask = args.exampleTask as string;
    const stepsStr = args.steps as string;
    const tagsStr = args.tags as string;
    let steps: unknown;
    try {
      steps = JSON.parse(stepsStr);
    } catch (err) {
      return jsonOrText(`Error: steps JSON parse failed: ${(err as Error).message}`, true);
    }
    if (!Array.isArray(steps) || !steps.every((s) => typeof s === "string")) {
      return jsonOrText("Error: steps must be a JSON array of strings", true);
    }
    const tags = tagsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const skill = extractSkillEntry(name, description, exampleTask, steps as string[], tags);
    return ok({ id: skill.id, name: skill.name, tags: skill.tags });
  },
};

export const matchSkillTool: ToolDefinition = {
  name: "match_skill",
  description: "Find the best matching skill for a given task (returns `null` if none).",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string" },
    },
    required: ["task"],
  },
  handler: async (args) => {
    const skill = matchSkillEntry(args.task as string);
    return ok({ matched: skill });
  },
};

export const useSkillTool: ToolDefinition = {
  name: "use_skill",
  description: "Bump a skill's useCount + lastUsedAt. Use after a task successfully applies a skill.",
  inputSchema: {
    type: "object",
    properties: {
      skillId: { type: "string" },
    },
    required: ["skillId"],
  },
  handler: async (args) => {
    useSkillEntry(args.skillId as string);
    return ok({ used: true });
  },
};

export const listSkillsTool: ToolDefinition = {
  name: "list_skills",
  description: "List all stored skills sorted by use count, plus aggregate stats.",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: async () => ok({ stats: getSkillStats(), skills: listSkillEntries() }),
};

// ─── Bundle helpers ────────────────────────────────────────────────────────

export interface InternalToolFilter {
  /** When true, include orchestration tools (run_workflow / deep_research). Default true at top-level, false inside them. */
  includeOrchestration?: boolean;
}

/** All definitions for LLM tool-listing — used by the ReAct agent. */
export function getInternalModuleDefinitions(filter: InternalToolFilter = {}): ToolDefinition[] {
  const includeOrchestration = filter.includeOrchestration !== false;
  const tools: ToolDefinition[] = [
    rememberTool,
    recallTool,
    searchMemoriesTool,
    memoryStatsTool,
    extractSkillTool,
    matchSkillTool,
    useSkillTool,
    listSkillsTool,
  ];
  if (includeOrchestration) {
    tools.push(runWorkflowTool, deepResearchTool);
  }
  return tools;
}
