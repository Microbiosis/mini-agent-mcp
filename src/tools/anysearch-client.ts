/**
 * AnySearch MCP Client
 *
 * Connects to the AnySearch MCP server (https://api.anysearch.com/mcp)
 * via Streamable HTTP transport and provides a simple interface for
 * listing and calling AnySearch tools.
 *
 * Authentication (optional):
 *   ANYSEARCH_API_KEY  — API key for higher rate limits
 *   Without a key, anonymous access works with lower rate limits.
 *
 * See: https://github.com/anysearch-ai/anysearch-mcp-server
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ANYSEARCH_MCP_URL = "https://api.anysearch.com/mcp";

/** Cached client instance */
let client: Client | null = null;

/** Resolved list of available tools */
let cachedTools: AnySearchTool[] | null = null;

export interface AnySearchTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Get or create the MCP client connected to AnySearch.
 */
async function getClient(): Promise<Client> {
  if (client) {
    return client;
  }

  const apiKey = process.env.ANYSEARCH_API_KEY;

  const transport = new StreamableHTTPClientTransport(new URL(ANYSEARCH_MCP_URL), {
    requestInit: apiKey
      ? {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      : undefined,
  });

  client = new Client(
    {
      name: "mini-agent-mcp-anysearch",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  return client;
}

/**
 * List all available tools from AnySearch.
 * Results are cached after the first call.
 */
export async function listAnySearchTools(): Promise<AnySearchTool[]> {
  if (cachedTools) {
    return cachedTools;
  }

  const c = await getClient();
  const response = await c.listTools();

  cachedTools = response.tools.map((t) => ({
    name: t.name,
    description: t.description || "",
    inputSchema: (t.inputSchema || { type: "object", properties: {} }) as Record<string, unknown>,
  }));

  return cachedTools;
}

/**
 * Call an AnySearch tool by name with the given arguments.
 */
export async function callAnySearchTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const c = await getClient();

  const response = await c.callTool(
    {
      name: toolName,
      arguments: args,
    },
    undefined,
    {
      timeout: 30_000,
    }
  );

  // Convert MCP content blocks to text
  const content = response.content as unknown as Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; text?: string; mimeType?: string } }
  >;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "image") {
      parts.push(`[Image: ${block.mimeType}]`);
    } else if (block.type === "resource") {
      parts.push(block.resource.text || `[Resource: ${block.resource.uri}]`);
    }
  }

  return parts.join("\n");
}

/**
 * Check if AnySearch is reachable and available.
 */
export async function isAnySearchAvailable(): Promise<boolean> {
  try {
    await listAnySearchTools();
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the AnySearch MCP connection.
 */
export async function closeAnySearch(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    cachedTools = null;
  }
}
