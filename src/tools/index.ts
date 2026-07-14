/**
 * Tool re-exports for FastMCP registration.
 * Each tool exports: name, description, inputSchema (Zod), and handler.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "./types.js";

/** A single JSON Schema property (subset we care about for tool registration). */
interface JSONSchemaProperty {
  type?: string;
  description?: string;
  enum?: ReadonlyArray<string | number | boolean>;
}

/** Convert a JSON Schema to a Zod schema (simplified) */
function schemaToZod(properties: Record<string, unknown>, required: string[]): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  for (const [key, raw] of Object.entries(properties)) {
    const v = raw as JSONSchemaProperty;
    const isRequired = required.includes(key);
    let zodType: z.ZodTypeAny;

    switch (v.type) {
      case "string":
        zodType = z.string();
        break;
      case "number":
        zodType = z.number();
        break;
      case "integer":
        zodType = z.number().int();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "array":
        zodType = z.array(z.any());
        break;
      default:
        zodType = z.any();
        break;
    }

    if (v.enum) {
      const allowed = v.enum;
      zodType = zodType.refine((x: unknown): x is (typeof allowed)[number] => allowed.includes(x as never), {
        message: `Must be one of: ${allowed.join(", ")}`,
      });
    }
    if (!isRequired) zodType = zodType.optional();
    if (v.description) zodType = zodType.describe(v.description);

    shape[key] = zodType;
  }
  return z.object(shape);
}

/** Wraps a ToolDefinition handler into a FastMCP-compatible execute function */
function wrapHandler(handler: (args: Record<string, unknown>) => Promise<ToolResult>) {
  return async (args: Record<string, unknown>) => {
    const result = await handler(args);
    if (result.isError) {
      throw new Error(
        result.content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json))).join("\n")
      );
    }
    return result.content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c.json))).join("\n");
  };
}

function wrapTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schemaToZod(tool.inputSchema.properties, tool.inputSchema.required),
    handler: wrapHandler(tool.handler),
  };
}

// Import all tool definitions
import { calculatorTool } from "./calculator.js";
import { textStatsTool, textTransformTool } from "./text.js";
import { unitConvertTool } from "./converter.js";
import { datetimeTool } from "./datetime.js";
import { randomGenTool } from "./random.js";

export const calculator = wrapTool(calculatorTool);
export const textStats = wrapTool(textStatsTool);
export const textTransform = wrapTool(textTransformTool);
export const unitConvert = wrapTool(unitConvertTool);
export const datetimeInfo = wrapTool(datetimeTool);
export const randomGen = wrapTool(randomGenTool);
