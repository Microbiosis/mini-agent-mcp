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
let cacheTimestamp = 0;
/** Cache TTL: 1 hour by default. Override via ANYSEARCH_CACHE_TTL_MS env var. */
const CACHE_TTL_MS = (() => {
  const v = process.env.ANYSEARCH_CACHE_TTL_MS;
  if (v) {
    const n = Number.parseInt(v, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return 60 * 60 * 1000;
})();

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
    raw && typeof raw === "object" && Array.isArray(raw.required) ? (raw.required as string[]) : [];
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
          return textResult(`Error executing AnySearch tool '${tool.name}': ${msg}`, true);
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
  // Return cache if still fresh
  if (cachedToolDefs !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedToolDefs;
  }

  try {
    const tools = await listAnySearchTools();
    cachedToolDefs = buildToolDefinitions(tools);
    cacheTimestamp = Date.now();
    return cachedToolDefs;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // On transient failure, preserve the previous cache if we had one.
    // Better stale tools than no tools at all.
    if (cachedToolDefs !== null && cachedToolDefs.length > 0) {
      console.error(`[AnySearch] Refresh failed (${msg}); serving stale cache`);
      return cachedToolDefs;
    }
    console.error(`[AnySearch] Failed to discover tools: ${msg}`);
    console.error("[AnySearch] Search tools will be unavailable. Set ANYSEARCH_API_KEY if needed.");
    cachedToolDefs = [];
    cacheTimestamp = Date.now();
    return cachedToolDefs;
  }
}

/**
 * Force-invalidate the cache. Next call to getAnySearchTools() / ensureAnySearchTools()
 * will re-discover tools from AnySearch.
 *
 * Use cases:
 *   - Tooling scripts that need fresh metadata immediately
 *   - Tests that swap AnySearch backends
 *   - Manual override after detecting a tool drift
 */
export function resetAnySearchCache(): void {
  cachedToolDefs = null;
  cacheTimestamp = 0;
}

/**
 * Lazy-discovery + registration. Idempotent.
 *
 * Triggers AnySearch tool discovery on first call, registers all
 * discovered tools into ToolManager (so run_agent can route through
 * it), and caches for subsequent calls.
 *
 * If AnySearch is unreachable, returns an empty array. Safe to call
 * from cold paths (agent entry points) without blocking startup.
 */
export async function ensureAnySearchTools(): Promise<ToolDefinition[]> {
  // Lazy import to avoid circular dependency (manager imports tools)
  const { toolManager } = await import("./manager.js");

  const tools = await getAnySearchTools();
  for (const t of tools) {
    if (toolManager.get(t.name)) continue; // already registered
    toolManager.register({
      name: t.name,
      description: t.description,
      timeoutMs: 60000,
      concurrencySafe: false,
      execute: async (args) => {
        const result = await (
          t.handler as (
            args: Record<string, unknown>
          ) => Promise<{ content: Array<{ type: string; text: string }> }>
        )(args);
        return result.content.map((c) => c.text).join("\n");
      },
    });
  }
  return tools;
}

/**
 * Lazy-discovery variant: returns existing cache if any, otherwise
 * returns an empty array WITHOUT triggering the network call.
 *
 * Use this from hot paths (e.g. `tools/list`, system prompt rendering)
 * where blocking on AnySearch discovery would be unacceptable.
 */
export function peekAnySearchTools(): ToolDefinition[] {
  return cachedToolDefs ?? [];
}
