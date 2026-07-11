/**
 * Tool definition types shared across all tools.
 * Each tool is a self-contained function with a JSON schema description.
 */

export interface ToolSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "json"; json: unknown }
  >;
  isError?: boolean;
}

/** Helper to create a text result */
export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError };
}

/** Helper to create a JSON result */
export function jsonResult(json: unknown): ToolResult {
  return { content: [{ type: "json", json }] };
}
