/**
 * ReAct Agent — Reasoning + Acting loop.
 *
 * Hooks system (Yao pattern):
 *   - CreateHook: runs before each LLM call, can modify messages
 *   - NextHook: runs after each LLM call, can validate output
 */

import { allTools, getTool, getToolDescriptions, buildToolList } from "../tools/registry.js";
import type { ToolDefinition as MCPToolDef, ToolResult } from "../tools/types.js";
import { callLLM, getLLMConfig, getLLMMode, type LLMMessage, type ToolDefinition as LLMToolDef } from "./llm.js";

// ─── Hooks System ──────────────────────────────────────────────────────────
export interface HookContext {
  task: string;
  step: number;
  maxSteps: number;
}

export type CreateHook = (ctx: HookContext, messages: LLMMessage[]) => Promise<LLMMessage[] | null>;
export type NextHook = (ctx: HookContext, response: { content: string | null; toolCalls?: any[] }) => Promise<"continue" | "stop" | null>;

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

const MAX_STEPS = 8;

const SYSTEM_PROMPT = `You are a helpful agent that solves tasks by using tools.
You have access to the following tools:

{TOOL_DESCRIPTIONS}

To use a tool, respond in EXACTLY this format:

Thought: <your reasoning about what to do next>
Action: <tool_name>
Action Input: <JSON object with the tool's parameters>

Example:
Thought: I need to calculate the result of 15 * 23
Action: calculator
Action Input: {"expression": "15 * 23"}

After receiving the tool result (Observation), you continue reasoning.

When you have enough information to answer the original task, respond with:

Thought: <brief summary of what you found>
Final Answer: <your complete answer to the task>

Rules:
- Always use exactly one tool at a time.
- Action Input must be valid JSON matching the tool's parameters.
- If a task doesn't need any tool, directly give the Final Answer.
- Be concise in your thoughts.
- Maximum ${MAX_STEPS} tool calls allowed.`;

/**
 * Parse the LLM response to extract Thought, Action, Action Input, or Final Answer.
 */
function parseLLMResponse(response: string): AgentStep {
  const step: AgentStep = { thought: "" };

  // Extract Thought
  const thoughtMatch = response.match(/Thought:\s*(.*?)(?=\n(?:Action:|Final Answer:)|$)/s);
  if (thoughtMatch) {
    step.thought = thoughtMatch[1].trim();
  }

  // Check for Final Answer
  const finalMatch = response.match(/Final Answer:\s*(.*?)$/s);
  if (finalMatch) {
    step.finalAnswer = finalMatch[1].trim();
    return step;
  }

  // Extract Action
  const actionMatch = response.match(/Action:\s*(\S+)/);
  if (actionMatch) {
    step.action = actionMatch[1].trim();
  }

  // Extract Action Input (JSON)
  const inputMatch = response.match(/Action Input:\s*(\{[\s\S]*?\})/);
  if (inputMatch) {
    try {
      step.actionInput = JSON.parse(inputMatch[1]);
    } catch {
      step.actionInput = {};
    }
  }

  return step;
}

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
 *   2a. LLM returns tool_calls → execute tool → add result as tool role → repeat
 *   2b. LLM returns text → parse for Final Answer, or continue loop
 *   3. Max 8 steps, then force final answer
 */
async function runLLMAgent(task: string, mode: "sampling" | "http"): Promise<AgentResult> {
  const steps: AgentStep[] = [];

  // Discover all tools including AnySearch for the LLM
  const availableTools = await buildToolList();
  const availableToolMap = new Map(availableTools.map((t) => [t.name, t]));
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

  for (let i = 0; i < MAX_STEPS; i++) {
    // ── CreateHook: before LLM call ──
    const ctx: HookContext = { task, step: i, maxSteps: MAX_STEPS };
    for (const hook of createHooks) {
      const modified = await hook(ctx, messages);
      if (modified === null) {
        throw new Error("LLM call cancelled by CreateHook");
      }
      // If hook returned modified messages, use them
      if (modified) messages.length = 0 && messages.push(...modified);
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
      if (decision === "stop") return {
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

        // Execute the tool
        const tool = availableToolMap.get(tc.function.name) || getTool(tc.function.name);
        if (tool) {
          try {
            const result: ToolResult = await tool.handler(args);
            const obsText = result.content
              .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
              .join("\n");
            step.observation = obsText;
            messages.push({ role: "tool", tool_call_id: tc.id, content: obsText });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            step.observation = `Error: ${msg}`;
            messages.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${msg}` });
          }
        } else {
          const err = `Tool '${tc.function.name}' not found`;
          step.observation = err;
          messages.push({ role: "tool", tool_call_id: tc.id, content: err });
        }

        steps.push(step);
      }
      continue; // Go back to LLM with tool results
    }

    // === Handle text response ===
    const text = llmResponse.content || "";
    messages.push({ role: "assistant", content: text });

    // Check for Final Answer — return full content, not just parsed text
    const finalMatch = text.match(/Final Answer:\s*(.*?)$/s);
    if (finalMatch) {
      steps.push({ thought: "Task completed.", finalAnswer: text });
      return {
        success: true,
        answer: text,  // Full LLM response, not just the captured group
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
    return {
      success: true,
      answer: "Max steps reached.",
      steps,
      totalSteps: steps.length,
      llmPowered: true,
      llmMode: mode,
    };
  }

  return {
    success: true,
    answer: finalResponse.content || "Task completed.",
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
async function runRuleBasedAgent(task: string): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const lowerTask = task.toLowerCase();
  const observations: string[] = [];

  // Split compound tasks on " and then " or " then " or " and " (only for rule-based)
  const subTasks = task
    .split(/\s+and\s+then\s+|\s+then\s+|\s+and\s+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Pattern 1: Math expression
  // Match expressions containing digits and math operators/functions only
  const mathExprRegex =
    /(?:calculate|compute|evaluate|solve)\s+([\d\s+\-*/().^a-z_]+)/i;
  const mathOperatorRegex =
    /([\d]+\s*[+\-*/^]+\s*[\d\s+\-*/().^a-z_]+)/;

  for (const subTask of subTasks) {
    let expr: string | null = null;

    // Try "calculate X" pattern
    const calcMatch = subTask.match(mathExprRegex);
    if (calcMatch && calcMatch[1]) {
      // Trim at first non-math word (like "and", "to", "into")
      expr = calcMatch[1].replace(/\s+(?:and|to|into|then)\s.*$/i, "").trim();
    }

    // Try bare math expression pattern
    if (!expr) {
      const opMatch = subTask.match(mathOperatorRegex);
      if (opMatch && opMatch[1]) {
        expr = opMatch[1].replace(/\s+(?:and|to|into|then)\s.*$/i, "").trim();
      }
    }

    // Try "what is X" pattern
    if (!expr) {
      const whatMatch = subTask.match(/what\s+is\s+([\d\s+\-*/().^a-z_]+)/i);
      if (whatMatch && whatMatch[1]) {
        expr = whatMatch[1].replace(/\s+(?:and|to|into|then)\s.*$/i, "").trim();
      }
    }

    if (expr && /[\d]/.test(expr) && /[+\-*/^]|sqrt|sin|cos|tan|log|ln|abs|exp|floor|ceil|round|pi|\be\b/.test(expr)) {
      const step: AgentStep = {
        thought: `Detected a math expression: ${expr}`,
        action: "calculator",
        actionInput: { expression: expr },
      };
      const tool = getTool("calculator")!;
      const result = await tool.handler(step.actionInput || {});
      const obs = result.content
        .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
        .join("\n");
      step.observation = obs;
      steps.push(step);
      observations.push(obs);
    }
  }

  // Pattern 2: Unit conversion — check all subtasks
  for (const subTask of subTasks) {
    const convertMatch = subTask.match(
      /convert\s+([\d.]+)\s*(\w+)\s+(?:to|into)\s*(\w+)/i
    );
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
      const tool = getTool("unit_convert")!;
      const result = await tool.handler(step.actionInput || {});
      const obs = result.content
        .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
        .join("\n");
      step.observation = obs;
      steps.push(step);
      observations.push(obs);
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
    const tool = getTool("datetime_info")!;
    const result = await tool.handler(step.actionInput || {});
    const obs = result.content
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
      .join("\n");
    step.observation = obs;
    steps.push(step);
    observations.push(obs);
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
    const tool = getTool("random_gen")!;
    const result = await tool.handler(step.actionInput || {});
    const obs = result.content
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
      .join("\n");
    step.observation = obs;
    steps.push(step);
    observations.push(obs);
  }

  // Pattern 5: UUID
  if (/(generate|create).*(uuid|guid)/i.test(task)) {
    const step: AgentStep = {
      thought: "Generating a UUID",
      action: "random_gen",
      actionInput: { operation: "uuid" },
    };
    const tool = getTool("random_gen")!;
    const result = await tool.handler(step.actionInput || {});
    const obs = result.content
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
      .join("\n");
    step.observation = obs;
    steps.push(step);
    observations.push(obs);
  }

  // Pattern 6: Text analysis
  const analyzeMatch = task.match(/(?:analyze|stats?|statistics)\s+(?:of|for|this)?\s*:?\s*["']?(.+?)["']?$/i);
  if (analyzeMatch && analyzeMatch[1]) {
    const text = analyzeMatch[1].trim();
    const step: AgentStep = {
      thought: "Analyzing text statistics",
      action: "text_stats",
      actionInput: { text },
    };
    const tool = getTool("text_stats")!;
    const result = await tool.handler(step.actionInput || {});
    const obs = result.content
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
      .join("\n");
    step.observation = obs;
    steps.push(step);
    observations.push(obs);
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
    const tool = getTool("datetime_info")!;
    const result = await tool.handler(step.actionInput || {});
    const obs = result.content
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
      .join("\n");
    step.observation = obs;
    steps.push(step);
    observations.push(obs);
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
    } catch { /* ignore — search tools just won't be mentioned */ }

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
export async function runAgent(task: string, forceMode?: "rule"): Promise<AgentResult> {
  const mode = forceMode === "rule" ? "none" : getLLMMode();

  if (mode === "sampling") {
    // 1) Try MCP sampling first
    try {
      return await runLLMAgent(task, "sampling");
    } catch (samplingErr) {
      // 2) Sampling failed — try Direct HTTP if env vars are configured
      const httpConfig = getLLMConfig();
      if (httpConfig) {
        try {
          return await runLLMAgent(task, "http");
        } catch (httpErr) {
          // 3) Direct HTTP also failed — fall back to rule-based
          const sMsg = samplingErr instanceof Error ? samplingErr.message : String(samplingErr);
          const hMsg = httpErr instanceof Error ? httpErr.message : String(httpErr);
          const result = await runRuleBasedAgent(task);
          result.answer = `[LLM errors: sampling (${sMsg}), http (${hMsg})] — falling back to rule-based mode.\n\n${result.answer}`;
          return result;
        }
      }
      // No Direct HTTP config — fall back to rule-based
      const sMsg = samplingErr instanceof Error ? samplingErr.message : String(samplingErr);
      const result = await runRuleBasedAgent(task);
      result.answer = `[Sampling error: ${sMsg}] — falling back to rule-based mode.\n\n${result.answer}`;
      return result;
    }
  }

  if (mode === "http") {
    // Direct HTTP only (no sampling available)
    try {
      return await runLLMAgent(task, "http");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result = await runRuleBasedAgent(task);
      result.answer = `[LLM error: ${msg}] — falling back to rule-based mode.\n\n${result.answer}`;
      return result;
    }
  }

  // Rule-based only (no LLM available)
  return await runRuleBasedAgent(task);
}
