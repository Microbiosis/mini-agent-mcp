/**
 * AnySearch Tool Definitions
 *
 * Wraps the AnySearch MCP server tools as native ToolDefinition objects
 * so the ReAct agent can use them autonomously.
 *
 * The AnySearch tools are discovered dynamically at startup from the
 * MCP server at https://api.anysearch.com/mcp. Each tool is wrapped
 * with a handler that proxies calls through the MCP client.
 *
 * Tool names are prefixed with "anysearch_" to make their origin clear
 * and avoid collisions with future built-in tools.
 */

import type { ToolDefinition, ToolResult } from "./types.js";
import { textResult } from "./types.js";
import { listAnySearchTools, callAnySearchTool } from "./anysearch-client.js";

/** Cache of dynamically discovered tool definitions */
let cachedToolDefs: ToolDefinition[] | null = null;

/**
 * Build native tool definitions for all AnySearch tools.
 * Tool names are prefixed with "anysearch_" for clarity.
 */
function buildToolDefinitions(tools: Awaited<ReturnType<typeof listAnySearchTools>>): ToolDefinition[] {
  return tools.map((tool) => {
    const localName = `anysearch_${tool.name}`;
    return {
      name: localName,
      description: tool.description,
      inputSchema: {
        type: "object",
        properties: tool.inputSchema.properties as Record<string, unknown>,
        required: (tool.inputSchema.required as string[]) || [],
      },
      handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const result = await callAnySearchTool(tool.name, args);
          return textResult(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return textResult(
            `Error executing AnySearch tool '${tool.name}': ${msg}`,
            true
          );
        }
      },
    };
  });
}

/**
 * Get all AnySearch tool definitions.
 * Dynamically discovers tools on first call, then caches the result.
 *
 * If AnySearch is unreachable, returns an empty array so the rest
 * of the server continues to work without search capabilities.
 */
export async function getAnySearchTools(): Promise<ToolDefinition[]> {
  if (cachedToolDefs) {
    return cachedToolDefs;
  }

  try {
    const tools = await listAnySearchTools();
    cachedToolDefs = buildToolDefinitions(tools);
    return cachedToolDefs;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AnySearch] Failed to discover tools: ${msg}`);
    console.error("[AnySearch] Search tools will be unavailable. Set ANYSEARCH_API_KEY if needed.");
    cachedToolDefs = [];
    return cachedToolDefs;
  }
}

/**
 * Check if AnySearch is available (has discoverable tools).
 */
export async function isAnySearchEnabled(): Promise<boolean> {
  const tools = await getAnySearchTools();
  return tools.length > 0;
}
