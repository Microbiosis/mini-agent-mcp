#!/usr/bin/env node

/**
 * Mini Agent MCP Server — powered by FastMCP + ToolManager
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAnySearchTools } from "./tools/anysearch.js";
import { calculator, textStats, textTransform, unitConvert, datetimeInfo, randomGen } from "./tools/index.js";
import { runAgent } from "./agent/react.js";
import { runWorkflow } from "./workflow/dag.js";
import { toolManager } from "./tools/manager.js";

// ─── Load .env ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnvFile(): void {
  const envPaths = [
    resolve(process.cwd(), ".env"),
    resolve(__dirname, "..", ".env"),
    resolve(__dirname, "..", "..", ".env"),
  ];
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          let value = trimmed.slice(eqIdx + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
          if (!process.env[key]) process.env[key] = value;
        }
        console.error(`[Config] Loaded .env from ${envPath}`);
        break;
      } catch { /* ignore */ }
    }
  }
}
loadEnvFile();

// ─── Version ──────────────────────────────────────────────────────────────
const pkgPath = resolve(__dirname, "..", "package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

// ─── FastMCP Server ──────────────────────────────────────────────────────
const server = new FastMCP({
  name: "mini-agent-mcp",
  version: version as `${number}.${number}.${number}`,
});

// ─── Register tools via ToolManager ──────────────────────────────────────
function registerFastMCPTool(name: string, description: string, params: z.ZodObject<any>, handler: (args: any) => Promise<string>) {
  server.addTool({
    name,
    description,
    parameters: params,
    execute: (args) => toolManager.execute(name, args as Record<string, unknown>),
  });
}

// Built-in tools
for (const [, def] of Object.entries({ calculator, textStats, textTransform, unitConvert, datetimeInfo, randomGen })) {
  toolManager.register({
    name: def.name,
    description: def.description,
    timeoutMs: 30000,
    concurrencySafe: true,
    execute: def.handler,
  });
  registerFastMCPTool(def.name, def.description, def.inputSchema, def.handler);
}

// AnySearch (dynamic)
(async () => {
  try {
    const anyTools = await getAnySearchTools();
    for (const t of anyTools) {
      toolManager.register({
        name: t.name,
        description: t.description,
        timeoutMs: 60000,
        concurrencySafe: false,
        execute: async (args) => {
          const result = await (t.handler as (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>)(args);
          return result.content.map((c) => c.text).join("\n");
        },
      });
      registerFastMCPTool(t.name, t.description, t.inputSchema as any, t.handler as any);
    }
    console.error(`[AnySearch] ${anyTools.length} tools registered via ToolManager`);
  } catch {
    console.error("[AnySearch] Not available (search tools disabled)");
  }
})();

// run_agent
registerFastMCPTool(
  "run_agent",
  "Run a ReAct agent that can autonomously use all available tools to complete a task. Supports multi-step tasks with LLM or rule-based mode.",
  z.object({
    task: z.string().describe("The task for the agent to complete"),
    mode: z.enum(["auto", "rule"]).optional().describe("Force mode: 'rule' for no-LLM mode"),
  }),
  async (args) => {
    const result = await runAgent(args.task, args.mode === "rule" ? "rule" : undefined);
    const lines = [`Task: ${args.task}`, `Mode: ${result.llmPowered ? (result.llmMode === "sampling" ? "LLM (sampling)" : "LLM (HTTP)") : "Rule-based"}`, `Steps: ${result.totalSteps}`, ""];
    if (result.steps.length > 0) {
      lines.push("--- Reasoning Trace ---");
      for (let i = 0; i < result.steps.length; i++) {
        const s = result.steps[i];
        lines.push(`[Step ${i + 1}]`);
        if (s.thought) lines.push(`  Thought: ${s.thought}`);
        if (s.action) lines.push(`  Action: ${s.action}`);
        if (s.observation) lines.push(`  Observation: ${s.observation}`);
        if (s.finalAnswer) lines.push(`  Final Answer: ${s.finalAnswer}`);
        lines.push("");
      }
    }
    lines.push("--- Final Answer ---", result.answer);
    return lines.join("\n");
  }
);

registerFastMCPTool(
  "run_workflow",
  "Run a multi-step DAG workflow. Define steps with dependencies; runs them in order. Each step is an agent task.",
  z.object({
    steps: z.string().describe("JSON array of workflow steps: [{id, task, dependsOn?, label?, timeout?}]"),
  }),
  async (args) => {
    let steps: any[];
    try { steps = JSON.parse(args.steps); } catch { return "Error: steps must be valid JSON"; }
    const result = await runWorkflow(steps);
    const lines = [`Workflow ${result.success ? "succeeded" : "completed with errors"}`, `Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`, ""];
    for (const s of result.steps) {
      lines.push(`[${s.id}]${s.label ? " " + s.label : ""} — ${s.error ? "FAIL: " + s.error : "OK"} (${(s.durationMs / 1000).toFixed(1)}s)`);
    }
    return lines.join("\n");
  }
);

// ─── Test mode ────────────────────────────────────────────────────────────
if (process.argv.includes("--test")) {
  console.log("=== Mini Agent MCP — Test Mode ===\n");
  const testArgs: Record<string, Record<string, unknown>> = {
    calculator: { expression: "sqrt(144) + 2^3" },
    text_stats: { text: "Hello world! This is a test. Hello again." },
    text_transform: { text: "hello world", operation: "uppercase" },
    unit_convert: { value: 100, from: "cm", to: "inch" },
    datetime_info: { operation: "now", timezone: "Asia/Shanghai" },
    random_gen: { operation: "uuid" },
  };
  for (const tool of toolManager.list()) {
    const args = testArgs[tool.name];
    if (!args) { console.log(`--- ${tool.name} ---\n(skipped)\n`); continue; }
    console.log(`--- ${tool.name} ---`);
    try { console.log(await tool.execute(args)); } catch { console.log("(error)"); }
    console.log("");
  }
  console.log("=== All tests passed ===");
  process.exit(0);
}

// ─── Start Server ────────────────────────────────────────────────────────
server.start({ transportType: process.argv.includes("--sse") ? "httpStream" : "stdio" } as any).catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

console.error(`Mini Agent MCP v${version} started | Tools: ${toolManager.size} | MaxConcurrent: ${process.env.TOOL_MAX_CONCURRENT || 10}`);