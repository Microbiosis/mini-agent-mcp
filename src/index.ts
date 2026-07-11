#!/usr/bin/env node

/**
 * Mini Agent MCP Server
 *
 * An MCP (Model Context Protocol) server that provides utility tools
 * AND an integrated ReAct mini-agent that can autonomously use those tools.
 *
 * Includes AnySearch integration — web search, domain-specific search,
 * batch search, and URL content extraction via the AnySearch MCP server.
 *
 * Usage:
 *   node dist/index.js           — Start as MCP server (stdio transport)
 *   node dist/index.js --test    — Run built-in tests
 *
 * Environment variables:
 *   LLM_API_KEY   — API key
 *   LLM_BASE_URL  — LLM base URL
 *   LLM_MODEL     — LLM model name
 *   ANYSEARCH_API_KEY — AnySearch API key (optional, anonymous works)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildToolList, rebuildToolMap } from "./tools/registry.js";
import { agentTool } from "./agent/index.js";
import { isLMAvailable, setLLMServer, getLLMMode } from "./agent/llm.js";

// Re-export for test mode
export { agentTool };

// -- Test mode --
async function runTests() {
  console.log("=== Mini Agent MCP — Test Mode ===\n");
  console.log(`LLM Available: ${isLMAvailable() ? "Yes" : "No (rule-based mode)"}\n`);

  const { getTool } = await import("./tools/registry.js");

  const testCases: Array<{ name: string; tool: string; args: Record<string, unknown> }> = [
    { name: "Calculator", tool: "calculator", args: { expression: "sqrt(144) + 2^3" } },
    { name: "Text Stats", tool: "text_stats", args: { text: "Hello world! This is a test sentence. Hello again." } },
    { name: "Text Transform", tool: "text_transform", args: { text: "hello world", operation: "uppercase" } },
    { name: "Unit Convert", tool: "unit_convert", args: { value: 100, from: "cm", to: "inch" } },
    { name: "DateTime Now", tool: "datetime_info", args: { operation: "now", timezone: "Asia/Shanghai" } },
    { name: "Random UUID", tool: "random_gen", args: { operation: "uuid" } },
    { name: "Random Password", tool: "random_gen", args: { operation: "password", length: 20 } },
  ];

  // Run built-in tool tests
  for (const tc of testCases) {
    console.log(`--- Test: ${tc.name} ---`);
    const tool = getTool(tc.tool)!;
    const result = await tool.handler(tc.args);
    const text = result.content
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
      .join("\n");
    console.log(text);
    console.log("");
  }

  // Show all available tools (including dynamically discovered AnySearch tools)
  const allTools = await buildToolList();
  console.log("--- Available Tools ---");
  for (const t of allTools) {
    const isSearch = t.name.startsWith("anysearch_");
    console.log(`  ${t.name}${isSearch ? " [AnySearch]" : ""}`);
  }
  console.log("");

  // Test the agent
  console.log("--- Test: Agent (multi-step) ---");
  const agentResult = await agentTool.handler({
    task: "Calculate 25 * 4 + sqrt(81) and then convert 500 grams to pounds",
  });
  const agentText = agentResult.content
    .map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json)))
    .join("\n");
  console.log(agentText);
  console.log("");

  console.log("=== All tests passed ===");
}

// -- Main --
async function main() {
  // Check for --test flag
  if (process.argv.includes("--test")) {
    await runTests();
    return;
  }

  // Build the complete tool list (including async AnySearch tools)
  const tools = await buildToolList();
  const toolMap = rebuildToolMap(tools);

  // All tools including the agent
  const allServerTools = [...tools, agentTool];

  const server = new Server(
    {
      name: "mini-agent-mcp",
      version: "1.0.9",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register the server instance for MCP sampling mode
  // (agent uses server.createMessage() instead of direct HTTP)
  setLLMServer(server);

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allServerTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name) || allServerTools.find((t) => t.name === name);

    if (!tool) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: tool '${name}' not found. Available tools: ${allServerTools.map((t) => t.name).join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(args || {});
      return {
        content: result.content.map((c) => {
          if (c.type === "json") {
            return { type: "text" as const, text: JSON.stringify(c.json, null, 2) };
          }
          return { type: "text" as const, text: c.text };
        }),
        isError: result.isError,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error executing tool '${name}': ${msg}` }],
        isError: true,
      };
    }
  });

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error(`Mini Agent MCP server started`);
  console.error(`  Tools: ${allServerTools.map((t) => t.name).join(", ")}`);
  const mode = getLLMMode();
  if (mode === "sampling") {
    console.error(`  LLM: MCP sampling (client manages model)`);
  } else if (mode === "http") {
    console.error(`  LLM: direct HTTP (${process.env.LLM_MODEL})`);
  } else {
    console.error(`  LLM: unavailable (rule-based mode)`);
    console.error(`    - MCP sampling: no client sampling support, OR`);
    console.error(`    - Set LLM_API_KEY + LLM_BASE_URL + LLM_MODEL for direct HTTP`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
