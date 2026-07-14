/**
 * Agent tool — exposes the ReAct agent as an MCP tool.
 * This is the main integration point: clients can call 'run_agent'
 * with a task description, and the agent will autonomously use
 * other available tools to complete it.
 */

import type { ToolDefinition } from "../tools/types.js";
import { textResult } from "../tools/types.js";
import { runAgent } from "./react.js";
import { isLMAvailable } from "./llm.js";
import { allTools } from "../tools/registry.js";

// Collect built-in tool names once for the description
const builtinToolNames = allTools.map((t) => t.name).join(", ");

const agentDescription = [
  "Run a mini ReAct agent that can autonomously use all available tools to complete a task. ",
  "The agent reasons step-by-step: it thinks about what to do, selects a tool, executes it, ",
  "observes the result, and continues until it has enough information to give a final answer.\n\n",
  "The agent supports multi-step tasks. Examples:\n",
  '  - "Calculate 15 * 23 + sqrt(144)"\n',
  '  - "Convert 100 cm to inches and also generate a UUID"\n',
  '  - "What time is it in Asia/Shanghai?"\n',
  '  - "Generate a 20-character password and tell me today\'s date"\n',
  '  - "Search the web for the latest news about AI agents"\n',
  '  - "Extract the content from https://example.com/article"\n\n',
  "Available tool categories:\n",
  `  - Built-in: ${builtinToolNames}\n`,
  "  - AnySearch (if connected): anysearch_search, anysearch_batch_search, anysearch_extract, anysearch_get_sub_domains\n\n",
  "If LLM_API_KEY + LLM_BASE_URL + LLM_MODEL are all set (no defaults), the agent uses LLM-powered reasoning. ",
  "Otherwise it uses a rule-based pattern matching engine.",
].join("");

export const agentTool: ToolDefinition = {
  name: "run_agent",
  description: agentDescription,
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task for the agent to complete. Be specific about what you want.",
      },
    },
    required: ["task"],
  },
  handler: async (args) => {
    const task = args.task as string;
    if (!task || typeof task !== "string") {
      return textResult("Error: task is required and must be a string", true);
    }

    const result = await runAgent(task);

    // Format the output with the reasoning trace
    const lines: string[] = [];
    lines.push("=== Agent Result ===");
    lines.push(`Task: ${task}`);
    const modeLabel = result.llmPowered
      ? result.llmMode === "sampling"
        ? "LLM-powered (MCP sampling)"
        : "LLM-powered (direct HTTP)"
      : "Rule-based";
    lines.push(`Mode: ${modeLabel}`);
    lines.push(`Steps: ${result.totalSteps}`);
    lines.push(`Success: ${result.success}`);
    lines.push("");

    // Show reasoning trace
    if (result.steps.length > 0) {
      lines.push("--- Reasoning Trace ---");
      for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i];
        lines.push(`[Step ${i + 1}]`);
        if (step.thought) {
          lines.push(`  Thought: ${step.thought}`);
        }
        if (step.action) {
          lines.push(`  Action: ${step.action}`);
          lines.push(`  Input: ${JSON.stringify(step.actionInput)}`);
        }
        if (step.observation) {
          lines.push(`  Observation: ${step.observation}`);
        }
        if (step.finalAnswer) {
          lines.push(`  Final Answer: ${step.finalAnswer}`);
        }
        lines.push("");
      }
    }

    lines.push("--- Final Answer ---");
    lines.push(result.answer);

    if (!result.llmPowered && !isLMAvailable()) {
      lines.push("");
      lines.push(
        "Note: Running in rule-based mode. Set LLM_API_KEY environment variable " +
          "to enable LLM-powered reasoning for more complex tasks."
      );
    }

    return textResult(lines.join("\n"));
  },
};
