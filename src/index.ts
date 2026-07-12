#!/usr/bin/env node

/**
 * Mini Agent MCP Server — powered by FastMCP
 *
 * Built-in tools + AnySearch + ReAct Agent, all registered via FastMCP's addTool().
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Load .env file (fallback for clients that don't pass env vars) ─────────
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
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) process.env[key] = value;
        }
        console.error(`[Config] Loaded .env from ${envPath}`);
        break;
      } catch { /* ignore */ }
    }
  }
}
loadEnvFile();

// ─── Read version from package.json ───────────────────────────────────────
const pkgPath = resolve(__dirname, "..", "package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

// ─── FastMCP Server ──────────────────────────────────────────────────────
const server = new FastMCP({
  name: "mini-agent-mcp",
  version: version as `${number}.${number}.${number}`,
});

// ─── Register Built-in Tools ─────────────────────────────────────────────
import { calculator, textStats, textTransform, unitConvert, datetimeInfo, randomGen } from "./tools/index.js";

const toolSchemas = {
  calculator, textStats, textTransform, unitConvert, datetimeInfo, randomGen,
};

for (const [, def] of Object.entries(toolSchemas)) {
  server.addTool({
    name: def.name,
    description: def.description,
    parameters: def.inputSchema,
    execute: def.handler,
  });
}

// ─── Register run_agent Tool ─────────────────────────────────────────────
import { runAgent } from "./agent/react.js";

server.addTool({
  name: "run_agent",
  description:
    "Run a ReAct agent that can autonomously use all available tools to complete a task. " +
    "The agent reasons step-by-step: thinks, selects a tool, executes it, observes the result, and continues " +
    "until it has enough information to give a final answer. Supports multi-step tasks. " +
    "If LLM is configured (LLM_API_KEY + LLM_BASE_URL + LLM_MODEL), uses LLM-powered reasoning. " +
    "Otherwise uses a rule-based pattern matching engine for simple tasks.",
  parameters: z.object({
    task: z.string().describe("The task for the agent to complete"),
    mode: z.enum(["auto", "rule"]).optional().describe("Force mode: 'rule' for no-LLM mode"),
  }),
  execute: async (args) => {
    const result = await runAgent(args.task);
    const lines: string[] = [];
    lines.push(`Task: ${args.task}`);
    lines.push(`Mode: ${result.llmPowered ? (result.llmMode === "sampling" ? "LLM (sampling)" : "LLM (HTTP)") : "Rule-based"}`);
    lines.push(`Steps: ${result.totalSteps}`);
    lines.push("");
    if (result.steps.length > 0) {
      lines.push("--- Reasoning Trace ---");
      for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i];
        lines.push(`[Step ${i + 1}]`);
        if (step.thought) lines.push(`  Thought: ${step.thought}`);
        if (step.action) lines.push(`  Action: ${step.action} | Input: ${JSON.stringify(step.actionInput)}`);
        if (step.observation) lines.push(`  Observation: ${step.observation}`);
        if (step.finalAnswer) lines.push(`  Final Answer: ${step.finalAnswer}`);
        lines.push("");
      }
    }
    lines.push("--- Final Answer ---");
    lines.push(result.answer);
    return lines.join("\n");
  },
});

// ─── Test mode ────────────────────────────────────────────────────────────
if (process.argv.includes("--test")) {
  console.log("=== Mini Agent MCP — Test Mode ===\n");
  const { calculator: c, textStats: ts, textTransform: tt, unitConvert: uc, datetimeInfo: dt, randomGen: rg } = toolSchemas;
  const testCases = [
    { name: "Calculator", handler: c.handler, args: { expression: "sqrt(144) + 2^3" } },
    { name: "Text Stats", handler: ts.handler, args: { text: "Hello world! This is a test. Hello again." } },
    { name: "Text Transform", handler: tt.handler, args: { text: "hello world", operation: "uppercase" } },
    { name: "Unit Convert", handler: uc.handler, args: { value: 100, from: "cm", to: "inch" } },
    { name: "DateTime Now", handler: dt.handler, args: { operation: "now", timezone: "Asia/Shanghai" } },
    { name: "Random UUID", handler: rg.handler, args: { operation: "uuid" } },
    { name: "Random Password", handler: rg.handler, args: { operation: "password", length: 20 } },
  ];
  for (const tc of testCases) {
    console.log(`--- Test: ${tc.name} ---`);
    console.log(await tc.handler(tc.args as any));
    console.log("");
  }
  console.log("=== All tests passed ===");
  process.exit(0);
}

// ─── Start Server ────────────────────────────────────────────────────────
const transport = process.argv.includes("--sse") ? "httpStream" : "stdio";

server.start({ transportType: transport } as any).catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

console.error(`Mini Agent MCP v${version} started (${transport})`);
console.error(`  Tools: ${calculator.name}, text_stats, text_transform, unit_convert, datetime_info, random_gen, run_agent`);