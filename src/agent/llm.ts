/**
 * LLM Communication Layer — powered by OpenAI SDK
 *
 * Uses the official OpenAI SDK for direct HTTP calls. For MCP Sampling,
 * the FastMCP server (`run_agent` handler) wraps the request in an
 * AsyncLocalStorage context so that `callViaSampling` can dispatch through
 * `FastMCP.requestSampling()` using the *correct* per-session server — not
 * a process-global one.
 *
 * Modes (priority order):
 *   1. MCP Sampling — client handles LLM (zero config, when supported)
 *   2. Direct HTTP — SDK calls LLM API directly
 *   3. Rule-based — fallback when no LLM available
 */

import OpenAI from "openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, existsSync } from "node:fs";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions.js";

// Minimal FastMCP session interface — only what sampling needs.
interface FastMCPSessionLike {
  requestSampling?: (
    message: unknown,
    options?: { timeout?: number }
  ) => Promise<{ content: { type?: string; text?: string }; model: string; role: string }>;
}

interface RequestContext {
  /** Per-request FastMCP session (used by `callViaSampling`). */
  session?: FastMCPSessionLike;
  /** Whether the connected MCP client advertised the `sampling` capability. */
  clientSupportsSampling?: boolean;
  sessionId?: string;
  requestId?: string;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` inside a per-request context — any LLM / Sampling calls inside
 *  observe the same context via `getRequestContext()`. */
export function withRequestContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return requestStorage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LLMMessageContent {
  type: string;
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | LLMMessageContent[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LLMResponse {
  content: string | null;
  finishReason: "stop" | "length" | "tool_calls" | "error" | "unknown";
  error: boolean;
  errorMessage?: string;
  errorStatusCode?: number;
  errorShouldRetry?: boolean;
  retryAfter?: number;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// ─── State ───────────────────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

/**
 * Legacy global fallback for clients that still call this at startup.
 *
 * FastMCP 4.x does not expose a process-global raw SDK `Server`; the
 * canonical path is via the per-request `FastMCPSession` captured inside
 * `run_agent`. This setter remains so external embedders that want a
 * process-wide fallback can still register one.
 */
export function setLLMSession(session: FastMCPSessionLike | null): void {
  // Wrap in a global context for any code path that doesn't go through
  // withRequestContext (e.g. legacy callers).
  legacySession = session;
}
let legacySession: FastMCPSessionLike | null = null;

// ─── Config helpers ──────────────────────────────────────────────────────────

/**
 * Load provider config from env vars + optional providers.json.
 *
 * Priority:
 *   1. LLM_PROVIDER env selects named provider from providers.json
 *   2. Fallback: LLM_API_KEY + LLM_BASE_URL + LLM_MODEL (default provider)
 */
function loadProviderConfig(): LLMConfig | null {
  const providerName = process.env.LLM_PROVIDER || "default";
  const providersPath = process.env.LLM_PROVIDERS_PATH;

  // Try to load named provider from providers config file
  if (providersPath && providerName !== "default") {
    try {
      if (existsSync(providersPath)) {
        const content = JSON.parse(readFileSync(providersPath, "utf8"));
        const provider = content.providers?.[providerName];
        if (provider?.apiKey && provider?.baseUrl && provider?.model) {
          return provider as LLMConfig;
        }
      }
    } catch {
      /* fall through to env vars */
    }
  }

  // Fallback: env vars as default provider
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl, model };
}

/** Get LLM config (backward-compatible) */
export function getLLMConfig(): LLMConfig | null {
  return loadProviderConfig();
}

/** Get max tokens from env var, default 4096 */
export function getMaxTokens(): number {
  const val = process.env.LLM_MAX_TOKENS;
  if (val) {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 4096;
}

/**
 * Get or create the OpenAI SDK client.
 * Re-uses the same client instance if config hasn't changed.
 */
function getOpenAIClient(): OpenAI | null {
  const cfg = getLLMConfig();
  if (!cfg) return null;

  if (openaiClient) return openaiClient;

  // Normalize baseURL: ensure /v1 (or version path) is present.
  // OpenAI SDK builds URLs as {baseURL}/{path}, and the path is like
  // "chat/completions" (no /v1 prefix), so the baseURL must include /v1.
  let baseURL = cfg.baseUrl.replace(/\/+$/, "");
  if (!/\/(v1|v\d+)(\/|$)/.test(baseURL)) {
    baseURL = baseURL + "/v1";
  }

  openaiClient = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL,
  });

  return openaiClient;
}

/** Reset the OpenAI client (needed when env vars change). */
export function resetOpenAIClient(): void {
  openaiClient = null;
}

// ─── Capability checks ─────────────────────────────────────────────────────

export function isSamplingAvailable(): boolean {
  // Sampling is available when (a) the connected client advertised the
  // `sampling` capability, AND (b) we have a session or legacy fallback
  // capable of issuing `requestSampling`.
  const ctx = getRequestContext();
  const session = ctx?.session ?? legacySession;
  if (!session || typeof session.requestSampling !== "function") return false;
  if (ctx?.clientSupportsSampling !== undefined) return ctx.clientSupportsSampling;
  // Without explicit info we err on the side of "available" — using a
  // present capability is just a request that may be rejected by the client.
  return true;
}

export function isHttpAvailable(): boolean {
  return getOpenAIClient() !== null;
}

export function getLLMMode(): "sampling" | "http" | "none" {
  if (isSamplingAvailable()) return "sampling";
  if (isHttpAvailable()) return "http";
  return "none";
}

export function isLMAvailable(): boolean {
  return isSamplingAvailable() || isHttpAvailable();
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function callLLM(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } }
): Promise<LLMResponse> {
  if (isSamplingAvailable()) {
    return await callViaSampling(messages);
  }

  const client = getOpenAIClient();
  if (client) {
    return await callViaOpenAI(client, messages, tools, toolChoice);
  }

  return {
    content: "",
    finishReason: "error",
    error: true,
    errorMessage: "No LLM available. Connect via MCP or set LLM_API_KEY + LLM_BASE_URL + LLM_MODEL.",
  };
}

// ─── MCP Sampling ──────────────────────────────────────────────────────────

async function callViaSampling(messages: LLMMessage[]): Promise<LLMResponse> {
  const ctx = getRequestContext();
  const session = ctx?.session ?? legacySession;
  if (!session || typeof session.requestSampling !== "function") {
    return {
      content: "",
      finishReason: "error",
      error: true,
      errorMessage: "MCP sampling not available for this request",
    };
  }

  try {
    const systemContent = messages.find((m) => m.role === "system")?.content;
    const systemPrompt = typeof systemContent === "string" ? systemContent : undefined;
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: {
          type: "text" as const,
          text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        },
      }));

    const maxTokens = getMaxTokens();
    const params = { messages: chatMessages, systemPrompt, maxTokens };
    const result = await session.requestSampling(params, { timeout: 120_000 });

    const content = result?.content;
    if (content && typeof (content as { text?: unknown }).text === "string") {
      return { content: (content as { text: string }).text, finishReason: "stop", error: false };
    }

    return {
      content: "",
      finishReason: "error",
      error: true,
      errorMessage: "MCP sampling returned non-text content",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: "",
      finishReason: "error",
      error: true,
      errorMessage: `MCP sampling failed: ${msg}`,
      errorShouldRetry: false,
    };
  }
}

// ─── OpenAI SDK ────────────────────────────────────────────────────────────

async function callViaOpenAI(
  client: OpenAI,
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } }
): Promise<LLMResponse> {
  const cfg = getLLMConfig();
  if (!cfg) {
    return { content: "", finishReason: "error", error: true, errorMessage: "LLM config not available" };
  }

  try {
    const maxTokens = getMaxTokens();
    const body: ChatCompletionCreateParamsNonStreaming = {
      model: cfg.model,
      messages: messages as ChatCompletionCreateParamsNonStreaming["messages"],
      temperature: 0.3,
      max_tokens: maxTokens,
    };
    if (tools) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;

    const response = await client.chat.completions.create(body, { timeout: 60_000 });

    const choice = response.choices?.[0];
    const content = choice?.message?.content ?? null;
    const finishReason = choice?.finish_reason ?? "unknown";
    const toolCalls = choice?.message?.tool_calls;

    // Handle tool calls result
    if (finishReason === "tool_calls" && toolCalls) {
      return {
        content: null,
        finishReason: "tool_calls",
        error: false,
        toolCalls: (
          toolCalls as Array<{ id: string; type: string; function: { name: string; arguments: string } }>
        ).map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    }

    return {
      content,
      finishReason: finishReason as LLMResponse["finishReason"],
      error: false,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusCode = err instanceof OpenAI.APIError ? err.status : undefined;
    console.error(`[OpenAI SDK] Error: ${msg}`);
    return {
      content: "",
      finishReason: "error",
      error: true,
      errorMessage: `OpenAI SDK error: ${msg}`,
      errorStatusCode: statusCode,
      errorShouldRetry: statusCode === 429 || !statusCode || statusCode >= 500,
    };
  }
}
