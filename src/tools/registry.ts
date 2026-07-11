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
export const toolMap = new Map<string, ToolDefinition>(
  allTools.map((t) => [t.name, t])
);

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
 */
export async function buildToolList(): Promise<ToolDefinition[]> {
  const tools = [...allTools];

  // Dynamically add AnySearch tools (fire-and-forget on failure)
  try {
    const { getAnySearchTools } = await import("./anysearch.js");
    const anysearchTools = await getAnySearchTools();
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
      const params = Object.entries(t.inputSchema.properties)
        .map(([key, val]) => {
          const v = val as { type?: string; description?: string };
          const required = t.inputSchema.required.includes(key);
          return `    - ${key} (${v.type || "any"})${required ? " [required]" : ""}: ${v.description || ""}`;
        })
        .join("\n");
      return `  Tool: ${t.name}\n    Description: ${t.description}\n    Parameters:\n${params}`;
    })
    .join("\n\n");
}
