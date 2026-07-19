/**
 * ReAct Agent — Reasoning + Acting loop.
 *
 * Hooks system (Yao pattern):
 *   - CreateHook: runs before each LLM call, can modify messages
 *   - NextHook: runs after each LLM call, can validate output
 */

import { allTools, buildToolList } from "../tools/registry.js";
import type { ToolDefinition as MCPToolDef } from "../tools/types.js";
import {
  callLLM,
  getLLMConfig,
  getLLMMode,
  type LLMMessage,
  type ToolCall,
  type ToolDefinition as LLMToolDef,
} from "./llm.js";
import { matchSkill, useSkill } from "../skill/index.js";
import { toolManager } from "../tools/manager.js";

// ─── Hooks System ──────────────────────────────────────────────────────────
export interface HookContext {
  task: string;
  step: number;
  maxSteps: number;
}

export type CreateHook = (ctx: HookContext, messages: LLMMessage[]) => Promise<LLMMessage[] | null>;
export type NextHook = (
  ctx: HookContext,
  response: { content: string | null; toolCalls?: ToolCall[] }
) => Promise<"continue" | "stop" | null>;

let createHooks: CreateHook[] = [];
let nextHooks: NextHook[] = [];

/** Register a CreateHook (runs before each LLM call) */
export function addCreateHook(hook: CreateHook): void {
  createHooks.push(hook);
}

/** Register a NextHook (runs after each LLM call) */
export function addNextHook(hook: NextHook): void {
  nextHooks.push(hook);
}

/** Clear all hooks */
export function clearHooks(): void {
  createHooks = [];
  nextHooks = [];
}

export interface AgentStep {
  thought: string;
  action?: string;
  actionInput?: Record<string, unknown>;
  observation?: string;
  finalAnswer?: string;
}

export interface AgentResult {
  success: boolean;
  answer: string;
  steps: AgentStep[];
  totalSteps: number;
  llmPowered: boolean;
  /** How the LLM was accessed: "sampling" (MCP client) or "http" (direct API) */
  llmMode?: "sampling" | "http";
}

/** Max steps per agent run (env AGENT_MAX_TURNS, default 5) */
const MAX_STEPS = (() => {
  const val = process.env.AGENT_MAX_TURNS;
  if (val) {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n > 0 && n <= 50) return n;
  }
  return 5;
})();

/**
 * Convert MCP tool definitions to OpenAI function calling format.
 */
function toOpenAITools(tools: MCPToolDef[]): LLMToolDef[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as unknown as Record<string, unknown>,
    },
  }));
}

/**
 * Run the ReAct loop with an LLM, using native function calling when available.
 *
 * Flow:
 *   1. Call LLM with messages + tool definitions
 *   2a. LLM returns tool_calls → execute tool (via ToolManager) → add result as tool role → repeat
 *   2b. LLM returns text → check for Final Answer, or continue loop
 *   3. Max 5 steps, then force final answer
 */
async function runLLMAgent(
  task: string,
  mode: "sampling" | "http",
  onStep?: (step: AgentStep) => void | Promise<void>,
  options?: { toolAllowlist?: string[] }
): Promise<AgentResult> {
  const steps: AgentStep[] = [];

  // Discover all tools including AnySearch for the LLM
  let availableTools = await buildToolList();
  if (options?.toolAllowlist) {
    const set = new Set(options.toolAllowlist);
    availableTools = availableTools.filter((t) => set.has(t.name));
  }
  const openaiTools = toOpenAITools(availableTools);
  const toolNames = openaiTools.map((t) => t.function.name).join(", ");

  const systemPrompt = `You are a helpful agent that solves tasks by using tools.
You have access to these tools: ${toolNames}.

Use function calling to invoke tools. The tool result will be returned to you automatically.

When you have enough information to answer the original task, respond with:

Final Answer: <your complete answer to the task>

Rules:
- Use exactly one tool at a time.
- If a task doesn't need any tool, directly give the Final Answer with complete content.
- Maximum ${MAX_STEPS} tool calls allowed.`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Task: ${task}` },
  ];

  // Auto-apply matched skill (self-improvement)
  const matchedSkill = matchSkill(task);
  if (matchedSkill) {
    console.error(`[Skill] Auto-applied: "${matchedSkill.name}" (used ${matchedSkill.useCount + 1}x)`);
    messages.push({
      role: "user",
      content: `Hint: A similar task was handled before. Approach: ${matchedSkill.steps.join(", ")}`,
    });
    useSkill(matchedSkill.id);
  }

  for (let i = 0; i < MAX_STEPS; i++) {
    // ── CreateHook: before LLM call ──
    const ctx: HookContext = { task, step: i, maxSteps: MAX_STEPS };
    for (const hook of createHooks) {
      const modified = await hook(ctx, messages);
      if (modified === null) {
        throw new Error("LLM call cancelled by CreateHook");
      }
      // If hook returned modified messages, use them
      if (modified) {
        messages.length = 0;
        messages.push(...modified);
      }
    }

    const llmResponse = await callLLM(messages, openaiTools, "auto");

    if (llmResponse.error) {
      throw new Error(llmResponse.errorMessage || "LLM call failed");
    }

    // ── NextHook: after LLM call ──
    for (const hook of nextHooks) {
      const decision = await hook(ctx, {
        content: llmResponse.content,
        toolCalls: llmResponse.toolCalls,
      });
      if (decision === "stop")
        return {
          success: true,
          answer: llmResponse.content || "Task stopped by NextHook.",
          steps,
          totalSteps: steps.length,
          llmPowered: true,
          llmMode: mode,
        };
    }

    // === Handle tool_calls (function calling) ===
    if (llmResponse.finishReason === "tool_calls" && llmResponse.toolCalls) {
      // OpenAI / compatible APIs require a single assistant message carrying
      // every tool_call *before* the corresponding role:"tool" results.
      // Without that, the next call is rejected as malformed conversation.
      messages.push({
        role: "assistant",
        content: llmResponse.content ?? "",
        tool_calls: llmResponse.toolCalls,
      });
      for (const tc of llmResponse.toolCalls) {
        const step: AgentStep = {
          thought: `Calling tool: ${tc.function.name}`,
          action: tc.function.name,
        };

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        step.actionInput = args;

        // Execute via ToolManager — gets timeout, concurrency, retry, guardrails
        let obsText: string;
        try {
          obsText = await toolManager.execute(tc.function.name, args);
          // ToolManager's execute returns a string; "Error: ..." prefixes
          // are the canonical signal of a failure that should be visible to
          // the LLM. Surface them as a regular observation.
          step.observation = obsText;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          step.observation = `Error: ${errMsg}`;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: step.observation });

        steps.push(step);
        await onStep?.(step);
      }
      continue; // Go back to LLM with tool results
    }

    // === Handle text response ===
    const text = llmResponse.content || "";
    messages.push({ role: "assistant", content: text });

    // Check for Final Answer — return full content, not just parsed text
    const finalMatch = text.match(/Final Answer:\s*(.*?)$/s);
    if (finalMatch) {
      const finalStep: AgentStep = { thought: "Task completed.", finalAnswer: text };
      steps.push(finalStep);
      await onStep?.(finalStep);
      return {
        success: true,
        answer: text, // Full LLM response, not just the captured group
        steps,
        totalSteps: steps.length,
        llmPowered: true,
        llmMode: mode,
      };
    }

    // If no final answer, ask for it
    if (i < MAX_STEPS - 1) {
      messages.push({
        role: "user",
        content: "Please provide your Final Answer now based on what you know.",
      });
    }
  }

  // Max steps — force final summary
  messages.push({
    role: "user",
    content: "Maximum steps reached. Please provide your Final Answer now.",
  });
  const finalResponse = await callLLM(messages, openaiTools);

  if (finalResponse.error) {
    const failureStep: AgentStep = {
      thought: "Max steps reached; forced final call failed.",
      finalAnswer: `Error: ${finalResponse.errorMessage || "forced final call failed"}`,
    };
    steps.push(failureStep);
    await onStep?.(failureStep);
    return {
      success: false,
      answer: failureStep.finalAnswer!,
      steps,
      totalSteps: steps.length,
      llmPowered: true,
      llmMode: mode,
    };
  }

  const finalText = finalResponse.content || "Task completed.";
  const completionStep: AgentStep = {
    thought: "Max steps reached; produced final summary.",
    finalAnswer: finalText,
  };
  steps.push(completionStep);
  await onStep?.(completionStep);
  return {
    success: true,
    answer: finalText,
    steps,
    totalSteps: steps.length,
    llmPowered: true,
    llmMode: mode,
  };
}

/**
 * Rule-based fallback agent — used when no LLM API key is configured.
 * Pattern-matches the task and calls appropriate tools.
 */
async function runRuleBasedAgent(
  task: string,
  onStep?: (step: AgentStep) => void | Promise<void>,
  toolAllowlist?: string[]
): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const observations: string[] = [];
  const allowed = new Set(toolAllowlist && toolAllowlist.length > 0 ? toolAllowlist : allTools.map((t) => t.name));

  // Helper to invoke tools through ToolManager so timeouts, retries, history,
  // and concurrency limits apply uniformly across LLM and rule-mode paths.
  async function runViaManager(name: string, args: Record<string, unknown>): Promise<string> {
    if (!allowed.has(name)) {
      throw new Error(`Tool '${name}' is not in the current allowlist`);
    }
    return await toolManager.execute(name, args);
  }

  // Split compound tasks on " and then " or " then " (only for rule-based)
  // Note: intentionally NOT splitting on bare "and" to avoid breaking math like "5 and 3"
  const subTasks = task
    .split(/\s+and\s+then\s+|\s+then\s+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Pattern 1: Math expression
  // Match expressions containing digits and math operators/functions only.
  // Known math function names (used for precise expression extraction below).
  const MATH_FN = "(?:sqrt|sin|cos|tan|asin|acos|atan|log|ln|abs|exp|floor|ceil|round|pi|e)";

  /**
   * Strip trailing non-math content from an extracted expression.
   * Removes English words that are not valid math tokens, so "2^10 with help"
   * becomes "2^10". Also strips natural-language suffixes like "and convert to...".
   */
  function cleanMathExpr(raw: string): string {
    const m = raw.match(
      new RegExp(`^(?:${MATH_FN}\\s*)?[\\d\\s+\\-*/().^]+(?:\\s*(?:${MATH_FN})\\s*[\\d\\s+\\-*/().^]*)*`, "i")
    );
    return m ? m[0].trim() : raw.trim();
  }

  const mathExprRegex = /(?:calculate|compute|evaluate|solve)\s+([\d\s+\-*/().^a-z_]+)/i;
  const mathOperatorRegex = /(\(?\s*[\d]+\s*[+\-*/^]+\s*[\d\s+\-*/().^a-z_]+)/;

  for (const subTask of subTasks) {
    let expr: string | null = null;

    // Try "calculate X" pattern
    const calcMatch = subTask.match(mathExprRegex);
    if (calcMatch && calcMatch[1]) {
      expr = cleanMathExpr(calcMatch[1]);
    }

    // Try bare math expression pattern
    if (!expr) {
      const opMatch = subTask.match(mathOperatorRegex);
      if (opMatch && opMatch[1]) {
        expr = cleanMathExpr(opMatch[1]);
      }
    }

    // Try "what is X" pattern
    if (!expr) {
      const whatMatch = subTask.match(/what\s+is\s+([\d\s+\-*/().^a-z_]+)/i);
      if (whatMatch && whatMatch[1]) {
        expr = cleanMathExpr(whatMatch[1]);
      }
    }

    if (
      expr &&
      /[\d]/.test(expr) &&
      /[+\-*/^]|sqrt|sin|cos|tan|log|ln|abs|exp|floor|ceil|round|pi|\be\b/.test(expr)
    ) {
      const step: AgentStep = {
        thought: `Detected a math expression: ${expr}`,
        action: "calculator",
        actionInput: { expression: expr },
      };
      try {
        step.observation = await runViaManager("calculator", step.actionInput || {});
      } catch (err) {
        step.observation = `Error: ${(err as Error).message}`;
      }
      observations.push(step.observation || "");
      steps.push(step);
      await onStep?.(step);
    }
  }

  // Pattern 2: Unit conversion — check all subtasks
  for (const subTask of subTasks) {
    const convertMatch = subTask.match(/convert\s+([\d.]+)\s*(\w+)\s+(?:to|into)\s*(\w+)/i);
    if (convertMatch) {
      const [, valueStr, from, to] = convertMatch;
      const step: AgentStep = {
        thought: `Converting ${valueStr} ${from} to ${to}`,
        action: "unit_convert",
        actionInput: {
          value: parseFloat(valueStr),
          from: from.toLowerCase(),
          to: to.toLowerCase(),
        },
      };
      try {
        step.observation = await runViaManager("unit_convert", step.actionInput || {});
      } catch (err) {
        step.observation = `Error: ${(err as Error).message}`;
      }
      observations.push(step.observation || "");
      steps.push(step);
      await onStep?.(step);
    }
  }

  // Pattern 3: Current time/date
  if (/(current\s+time|what\s+time|today'?s?\s+date|what\s+date|now)/i.test(task)) {
    const tzMatch = task.match(/(?:timezone|tz)\s*[:=]?\s*(\S+)/i);
    const step: AgentStep = {
      thought: "Getting current date/time",
      action: "datetime_info",
      actionInput: {
        operation: "now",
        timezone: tzMatch ? tzMatch[1] : "Asia/Shanghai",
      },
    };
    try {
      step.observation = await runViaManager("datetime_info", step.actionInput || {});
    } catch (err) {
      step.observation = `Error: ${(err as Error).message}`;
    }
    observations.push(step.observation || "");
    steps.push(step);
    await onStep?.(step);
  }

  // Pattern 4: Generate password
  if (/(generate|create|make).*(password|pwd)/i.test(task)) {
    const lenMatch = task.match(/(\d+)\s*(?:char|character|length)/i);
    const step: AgentStep = {
      thought: "Generating a random password",
      action: "random_gen",
      actionInput: {
        operation: "password",
        length: lenMatch ? parseInt(lenMatch[1]) : 16,
      },
    };
    try {
      step.observation = await runViaManager("random_gen", step.actionInput || {});
    } catch (err) {
      step.observation = `Error: ${(err as Error).message}`;
    }
    observations.push(step.observation || "");
    steps.push(step);
    await onStep?.(step);
  }

  // Pattern 5: UUID
  if (/(generate|create).*(uuid|guid)/i.test(task)) {
    const step: AgentStep = {
      thought: "Generating a UUID",
      action: "random_gen",
      actionInput: { operation: "uuid" },
    };
    try {
      step.observation = await runViaManager("random_gen", step.actionInput || {});
    } catch (err) {
      step.observation = `Error: ${(err as Error).message}`;
    }
    observations.push(step.observation || "");
    steps.push(step);
    await onStep?.(step);
  }

  // Pattern 6: Text analysis
  const analyzeMatch = task.match(
    /(?:analyze|stats?|statistics)\s+(?:of|for|this)?\s*:?\s*["']?(.+?)["']?$/i
  );
  if (analyzeMatch && analyzeMatch[1]) {
    const text = analyzeMatch[1].trim();
    const step: AgentStep = {
      thought: "Analyzing text statistics",
      action: "text_stats",
      actionInput: { text },
    };
    try {
      step.observation = await runViaManager("text_stats", step.actionInput || {});
    } catch (err) {
      step.observation = `Error: ${(err as Error).message}`;
    }
    observations.push(step.observation || "");
    steps.push(step);
    await onStep?.(step);
  }

  // Pattern 7: Date difference
  const diffMatch = task.match(
    /(?:diff|difference|days\s+between).*(\d{4}-\d{2}-\d{2}).*(\d{4}-\d{2}-\d{2})/i
  );
  if (diffMatch) {
    const [, d1, d2] = diffMatch;
    const step: AgentStep = {
      thought: `Calculating difference between ${d1} and ${d2}`,
      action: "datetime_info",
      actionInput: { operation: "diff", date: d1, date2: d2 },
    };
    try {
      step.observation = await runViaManager("datetime_info", step.actionInput || {});
    } catch (err) {
      step.observation = `Error: ${(err as Error).message}`;
    }
    observations.push(step.observation || "");
    steps.push(step);
    await onStep?.(step);
  }

  // Synthesize answer
  if (steps.length === 0) {
    // Include AnySearch tools in error message for discoverability
    let searchHint = "";
    try {
      const extraTools = await buildToolList();
      const names = extraTools.map((t) => t.name).filter((n) => !allTools.some((a) => a.name === n));
      if (names.length > 0) {
        searchHint = `\n\nExtended tools available: ${names.join(", ")}`;
      }
    } catch {
      /* ignore — search tools just won't be mentioned */
    }

    return {
      success: false,
      answer:
        `I couldn't determine which tool to use for this task in rule-based mode.\n` +
        `Task: "${task}"\n\n` +
        `Available tools: ${allTools.map((t) => t.name).join(", ")}${searchHint}\n\n` +
        `Tip: Set LLM_API_KEY environment variable to enable LLM-powered reasoning ` +
        `for more complex tasks.`,
      steps,
      totalSteps: 0,
      llmPowered: false,
    };
  }

  const finalStep: AgentStep = {
    thought: "Task completed, synthesizing final answer.",
    finalAnswer: observations.join("\n\n---\n\n"),
  };
  steps.push(finalStep);
  await onStep?.(finalStep);

  return {
    success: true,
    answer: observations.join("\n\n"),
    steps,
    totalSteps: steps.length,
    llmPowered: false,
  };
}

/**
 * Main entry point — runs the agent on a task.
 * Priority: MCP sampling (client model) > Direct HTTP > Rule-based
 */
export async function runAgent(
  task: string,
  forceMode?: "rule",
  onStep?: (step: AgentStep) => void | Promise<void>,
  options?: { toolAllowlist?: string[] }
): Promise<AgentResult> {
  const allowlist = options?.toolAllowlist;
  const mode = forceMode === "rule" ? "none" : getLLMMode();

  if (mode === "sampling") {
    try {
      return await runLLMAgent(task, "sampling", onStep, { toolAllowlist: allowlist });
    } catch (samplingErr) {
      const httpConfig = getLLMConfig();
      if (httpConfig) {
        try {
          return await runLLMAgent(task, "http", onStep, { toolAllowlist: allowlist });
        } catch (httpErr) {
          const sMsg = samplingErr instanceof Error ? samplingErr.message : String(samplingErr);
          const hMsg = httpErr instanceof Error ? httpErr.message : String(httpErr);
          const result = await runRuleBasedAgent(task, onStep, allowlist);
          result.answer = `[LLM errors: sampling (${sMsg}), http (${hMsg})] — falling back to rule-based mode.\n\n${result.answer}`;
          return result;
        }
      }
      const sMsg = samplingErr instanceof Error ? samplingErr.message : String(samplingErr);
      const result = await runRuleBasedAgent(task, onStep, allowlist);
      result.answer = `[Sampling error: ${sMsg}] — falling back to rule-based mode.\n\n${result.answer}`;
      return result;
    }
  }

  if (mode === "http") {
    try {
      return await runLLMAgent(task, "http", onStep, { toolAllowlist: allowlist });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result = await runRuleBasedAgent(task, onStep, allowlist);
      result.answer = `[LLM error: ${msg}] — falling back to rule-based mode.\n\n${result.answer}`;
      return result;
    }
  }

  return await runRuleBasedAgent(task, onStep, allowlist);
}
