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

/** Cooldown before retrying after a failure (ms). */
const RECONNECT_COOLDOWN_MS = (() => {
  const v = process.env.ANYSEARCH_RECONNECT_COOLDOWN_MS;
  if (v) {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 0) return n;
  }
  return 30_000;
})();

/** In-flight connection promise, used to coalesce concurrent cold boots. */
let clientPromise: Promise<Client> | null = null;
/** Earliest permitted next reconnect attempt after a failure. */
let nextRetryAt = 0;

/** Get current runtime status for monitoring */
export function getMCPStatus(): MCPRuntimeState {
  return { ...runtime, failureHistory: runtime.failureHistory.slice(-10) };
}

/** Classify an error as hard or transient */
function classifyError(err: unknown): "hard" | "transient" {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  // Hard errors: connection refused, DNS failure, auth issues
  if (
    lower.includes("refused") ||
    lower.includes("dns") ||
    lower.includes("enotfound") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized")
  ) {
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

async function connectClient(): Promise<Client> {
  const apiKey = process.env.ANYSEARCH_API_KEY;
  const transport = new StreamableHTTPClientTransport(new URL(ANYSEARCH_MCP_URL), {
    requestInit: apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined,
  });
  const next = new Client({ name: "mini-agent-mcp-anysearch", version }, { capabilities: {} });
  await next.connect(transport);
  return next;
}

async function getClient(): Promise<Client> {
  // Disabled state — surface a clear message; resetMCPRuntime() lifts it.
  if (runtime.state === "disabled") {
    throw new Error("AnySearch MCP client is disabled (too many failures). Call resetMCPRuntime() to retry.");
  }

  if (client) return client;
  if (clientPromise) return clientPromise;

  // Cooldown: respect a backoff after a transient/degraded failure so we
  // don't hammer the upstream.
  if (nextRetryAt > Date.now() && (runtime.state === "degraded" || runtime.state === "error")) {
    throw new Error(
      `AnySearch waiting for cooldown (${Math.ceil((nextRetryAt - Date.now()) / 1000)}s remaining)`
    );
  }

  transition("connecting");
  clientPromise = connectClient()
    .then((c) => {
      client = c;
      transition("connected");
      return c;
    })
    .catch((err) => {
      const type = classifyError(err);
      if (type === "hard") {
        transition("error", err);
        if (runtime.consecutiveFailures >= 2) {
          runtime.state = "disabled";
          console.error("[MCPRuntime] Persistent hard errors — disabling AnySearch");
        }
      } else {
        transition("degraded", err);
        nextRetryAt = Date.now() + RECONNECT_COOLDOWN_MS;
      }
      throw err;
    })
    .finally(() => {
      clientPromise = null;
    });
  return clientPromise;
}

/**
 * List tools from AnySearch with runtime management.
 * Returns cached tools if available. A first-time discovery failure does
 * NOT cache an empty list — it re-throws so callers can keep retrying.
 * A stale cache, if present, is still served so end users see *some*
 * tools when the upstream is flapping.
 */
export async function listAnySearchTools(): Promise<AnySearchTool[]> {
  if (cachedTools) return cachedTools;
  if (runtime.state === "disabled") {
    throw new Error("AnySearch MCP client is disabled (too many failures). Call resetMCPRuntime() to retry.");
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
  } catch (err) {
    if (cachedTools && cachedTools.length > 0) {
      console.error(`[MCPRuntime] Discovery failed (${(err as Error).message}); serving stale cache`);
      return cachedTools;
    }
    throw err;
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

    // If upstream signals isError, propagate that to the caller via throw so
    // ToolManager treats it as a hard error and records the failure rather
    // than logging it as a "successful" text observation.
    if (response && (response as { isError?: boolean }).isError) {
      throw new Error(`AnySearch tool '${toolName}' returned an error response`);
    }

    const content = response.content as unknown as Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
      | { type: "resource"; resource: { uri: string; text?: string; mimeType?: string } }
    >;

    const parts: string[] = [];
    for (const block of content) {
      if (block.type === "text") parts.push(block.text);
      else if (block.type === "image") parts.push(`[Image: ${block.mimeType}]`);
      else if (block.type === "resource")
        parts.push(block.resource.text || `[Resource: ${block.resource.uri}]`);
    }

    return parts.join("\n");
  } catch (err) {
    const type = classifyError(err);
    if (type === "hard") {
      transition("error", err);
      if (runtime.consecutiveFailures >= 2) {
        runtime.state = "disabled";
        console.error("[MCPRuntime] Persistent hard errors — disabling AnySearch");
      }
    } else {
      transition("degraded", err);
      nextRetryAt = Date.now() + RECONNECT_COOLDOWN_MS;
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
  }
  cachedTools = null;
  clientPromise = null;
  runtime = { state: "idle", consecutiveFailures: 0, failureHistory: [] };
  nextRetryAt = 0;
}

/** Reset runtime state (e.g., for retry after disable) */
export function resetMCPRuntime(): void {
  runtime = { state: "idle", consecutiveFailures: 0, failureHistory: [] };
  client = null;
  clientPromise = null;
  cachedTools = null;
  nextRetryAt = 0;
  console.error("[MCPRuntime] Reset — reconnection will be attempted on next call");
}
