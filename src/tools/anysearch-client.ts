/**
 * AnySearch MCP Client + MCPRuntime state machine
 *
 * MCPRuntime (ms-agent pattern):
 *   - Connection states: connecting → connected → degraded → error → disabled
 *   - Failure classification: hard vs transient
 *   - Graceful degradation: transient errors auto-retry, hard errors disable
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, "..", "..", "package.json");
const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

const ANYSEARCH_MCP_URL = "https://api.anysearch.com/mcp";

// ─── MCPRuntime State Machine ─────────────────────────────────────────────
type MCPState = "idle" | "connecting" | "connected" | "degraded" | "error" | "disabled";

interface MCPRuntimeState {
  state: MCPState;
  consecutiveFailures: number;
  lastError?: string;
  lastErrorTime?: number;
  failureHistory: Array<{ time: number; type: "hard" | "transient"; message: string }>;
}

let runtime: MCPRuntimeState = {
  state: "idle",
  consecutiveFailures: 0,
  failureHistory: [],
};

let client: Client | null = null;
let cachedTools: AnySearchTool[] | null = null;

export interface AnySearchTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Get current runtime status for monitoring */
export function getMCPStatus(): MCPRuntimeState {
  return { ...runtime, failureHistory: runtime.failureHistory.slice(-10) };
}

/** Classify an error as hard or transient */
function classifyError(err: unknown): "hard" | "transient" {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  // Hard errors: connection refused, DNS failure, auth issues
  if (lower.includes("refused") || lower.includes("dns") || lower.includes("enotfound")
    || lower.includes("401") || lower.includes("403") || lower.includes("unauthorized")) {
    return "hard";
  }
  // Transient: timeouts, 429, 5xx
  return "transient";
}

/** Transition to a new state with failure tracking */
function transition(newState: MCPState, err?: unknown): void {
  const prev = runtime.state;
  runtime.state = newState;

  if (err) {
    const type = classifyError(err);
    runtime.consecutiveFailures++;
    runtime.lastError = err instanceof Error ? err.message : String(err);
    runtime.lastErrorTime = Date.now();
    runtime.failureHistory.push({ time: Date.now(), type, message: runtime.lastError });
  } else {
    runtime.consecutiveFailures = 0;
  }

  console.error(`[MCPRuntime] ${prev} → ${newState}${err ? ` (${classifyError(err)})` : ""}`);
}

// ─── Client with Runtime ─────────────────────────────────────────────────

async function getClient(): Promise<Client> {
  // Disabled state — don't attempt connection
  if (runtime.state === "disabled") {
    throw new Error("AnySearch MCP client is disabled (too many failures)");
  }

  // Degraded state — try reconnecting
  if (runtime.state === "degraded" && runtime.consecutiveFailures >= 5) {
    runtime.state = "disabled";
    console.error("[MCPRuntime] Too many failures, disabling AnySearch");
    throw new Error("AnySearch disabled after 5 consecutive failures");
  }

  if (client) return client;

  transition("connecting");

  try {
    const apiKey = process.env.ANYSEARCH_API_KEY;
    const transport = new StreamableHTTPClientTransport(new URL(ANYSEARCH_MCP_URL), {
      requestInit: apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined,
    });

    client = new Client(
      { name: "mini-agent-mcp-anysearch", version },
      { capabilities: {} }
    );

    await client.connect(transport);
    transition("connected");
    return client;
  } catch (err) {
    const type = classifyError(err);
    if (type === "hard") {
      transition("error", err);
    } else {
      transition("degraded", err);
    }
    throw err;
  }
}

/**
 * List tools from AnySearch with runtime management.
 * Returns cached tools if available, even in degraded mode.
 */
export async function listAnySearchTools(): Promise<AnySearchTool[]> {
  if (cachedTools) return cachedTools;

  // In degraded/error mode, return empty (search tools unavailable)
  if (runtime.state === "degraded" || runtime.state === "error" || runtime.state === "disabled") {
    return [];
  }

  try {
    const c = await getClient();
    const response = await c.listTools();
    cachedTools = response.tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: (t.inputSchema || { type: "object", properties: {} }) as Record<string, unknown>,
    }));
    return cachedTools;
  } catch {
    return [];
  }
}

/**
 * Call an AnySearch tool with runtime management.
 */
export async function callAnySearchTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  if (runtime.state === "disabled") {
    throw new Error("AnySearch is disabled. Restart the server to retry.");
  }

  try {
    const c = await getClient();
    const response = await c.callTool({ name: toolName, arguments: args }, undefined, { timeout: 60_000 });

    const content = response.content as unknown as Array<
      { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      | { type: "resource"; resource: { uri: string; text?: string; mimeType?: string } }
    >;

    const parts: string[] = [];
    for (const block of content) {
      if (block.type === "text") parts.push(block.text);
      else if (block.type === "image") parts.push(`[Image: ${block.mimeType}]`);
      else if (block.type === "resource") parts.push(block.resource.text || `[Resource: ${block.resource.uri}]`);
    }

    return parts.join("\n");
  } catch (err) {
    const type = classifyError(err);
    if (type === "hard") {
      transition("error", err);
    } else {
      transition("degraded", err);
    }
    throw err;
  }
}

/**
 * Close the AnySearch connection and reset runtime state.
 */
export async function closeAnySearch(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    cachedTools = null;
  }
  runtime = { state: "idle", consecutiveFailures: 0, failureHistory: [] };
}

/** Reset runtime state (e.g., for retry after disable) */
export function resetMCPRuntime(): void {
  if (runtime.state === "disabled") {
    runtime = { state: "idle", consecutiveFailures: 0, failureHistory: [] };
    console.error("[MCPRuntime] Reset — reconnection will be attempted on next call");
  }
}