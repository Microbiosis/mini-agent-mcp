/**
 * Tool registry — collects all tool definitions and provides lookup.
 *
 * Local tools are always available. AnySearch tools are discovered
 * dynamically at server startup from the remote MCP server.
 */

import type { ToolDefinition } from "./types.js";
import { calculatorTool } from "./calculator.js";
import { textStatsTool, textTransformTool } from "./text.js";
import { unitConvertTool } from "./converter.js";
import { datetimeTool } from "./datetime.js";
import { randomGenTool } from "./random.js";

export type { ToolDefinition, ToolResult } from "./types.js";

/** Local (built-in) tools — always available */
export const allTools: ToolDefinition[] = [
  calculatorTool,
  textStatsTool,
  textTransformTool,
  unitConvertTool,
  datetimeTool,
  randomGenTool,
];

/** Map for quick lookup by name */
export const toolMap = new Map<string, ToolDefinition>(allTools.map((t) => [t.name, t]));

/** Get a tool by name */
export function getTool(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

/**
 * Build the complete tool list by combining local tools with
 * AnySearch tools discovered from the remote MCP server.
 *
 * If AnySearch is unreachable, returns only local tools —
 * the server continues to work without search capabilities.
 *
 * `includeOrchestration` controls whether run_workflow / deep_research
 * are exposed to the embedded Agent. They are NOT recursive-safe when
 * invoked from inside run_workflow / deep_research itself, so nested
 * runs pass `includeOrchestration: false`.
 */
export async function buildToolList(options: { includeOrchestration?: boolean } = {}): Promise<ToolDefinition[]> {
  const tools = [...allTools];

  // Memory + Skill internal modules (excluding run_workflow/deep_research
  // by default at the top-level context, since they would never be useful
  // via direct function calling — they accept argument shapes designed
  // for human callers). Orchestration tools are added when requested.
  try {
    const { getInternalModuleDefinitions } = await import("./internal-modules.js");
    tools.push(...getInternalModuleDefinitions({ includeOrchestration: options.includeOrchestration !== false }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[registry] Internal modules not available: ${msg}`);
  }

  // Lazily trigger AnySearch discovery + ToolManager registration.
  // First call pays the discovery cost (~1-3s); subsequent calls use cache.
  try {
    const { ensureAnySearchTools } = await import("./anysearch.js");
    const anysearchTools = await ensureAnySearchTools();
    tools.push(...anysearchTools);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[registry] AnySearch tools not available: ${msg}`);
  }

  return tools;
}

/** Rebuild the tool map after tools are added (e.g., AnySearch) */
export function rebuildToolMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
  return new Map(tools.map((t) => [t.name, t]));
}

/** Get tool descriptions for the agent's system prompt */
export function getToolDescriptions(tools: ToolDefinition[]): string {
  return tools
    .map((t) => {
      // Defensive: anysearch-sourced tools may lack properties/required
      // after upstream schema drift; fall back to empty objects/arrays
      // so a single bad tool doesn't take down prompt rendering.
      const schema = (t.inputSchema ?? {}) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const properties = (
        schema.properties && typeof schema.properties === "object" ? schema.properties : {}
      ) as Record<string, unknown>;
      const required = Array.isArray(schema.required) ? schema.required : [];
      const params = Object.entries(properties)
        .map(([key, val]) => {
          const v = val as { type?: string; description?: string };
          const isRequired = required.includes(key);
          return `    - ${key} (${v.type || "any"})${isRequired ? " [required]" : ""}: ${v.description || ""}`;
        })
        .join("\n");
      return `  Tool: ${t.name}\n    Description: ${t.description}\n    Parameters:\n${params}`;
    })
    .join("\n\n");
}
