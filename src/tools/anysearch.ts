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
 * Normalize an MCP tool's inputSchema so downstream consumers
 * (this server's MCP SDK registration, getToolDescriptions,
 *  ReAct prompt rendering) never see `undefined` for properties/required.
 *
 * Some upstream AnySearch tools occasionally return tool descriptors
 * with a missing or partial JSON Schema (no `properties` / `required`
 * keys). Passing that straight into @modelcontextprotocol/sdk's
 * tool() registration triggers `Cannot use 'in' operator to search
 * for 'jsonSchema' in undefined` during initialization. Defending
 * here keeps the local MCP server healthy even when the remote
 * schema is malformed.
 */
function normalizeInputSchema(raw: Record<string, unknown> | undefined): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
} {
  const properties =
    raw && typeof raw === "object" && raw.properties && typeof raw.properties === "object"
      ? (raw.properties as Record<string, unknown>)
      : {};
  const required =
    raw && typeof raw === "object" && Array.isArray(raw.required)
      ? (raw.required as string[])
      : [];
  return { type: "object", properties, required };
}

/**
 * Build native tool definitions for all AnySearch tools.
 * Tool names are prefixed with "anysearch_" for clarity.
 */
function buildToolDefinitions(tools: Awaited<ReturnType<typeof listAnySearchTools>>): ToolDefinition[] {
  return tools.map((tool) => {
    const localName = `anysearch_${tool.name}`;
    return {
      name: localName,
      description: tool.description || "",
      inputSchema: normalizeInputSchema(tool.inputSchema as Record<string, unknown> | undefined),
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

