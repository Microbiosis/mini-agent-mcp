/**
 * LLM Communication Layer
 *
 * Architecture based on nanobot / smolagents / OpenAI Agents SDK patterns:
 *   - LLMProvider interface with provider implementations
 *   - LLMResponse with rich error metadata
 *   - Exponential backoff retry built into each provider
 *   - Two providers: OpenAI-format (most providers) and Anthropic-format
 *
 * Modes (priority order):
 *   1. MCP Sampling — client handles LLM (zero config)
 *   2. Direct HTTP — server calls LLM API directly
 *   3. Rule-based — fallback when no LLM available
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** API format selection (matches ZCode supplier config) */
export type ApiFormat = "openai" | "anthropic";

/**
 * Unified LLM response with error metadata (nanobot pattern).
 * Even on success, the structured shape is returned.
 * On error, the `error` fields explain what happened for retry decisions.
 */
export interface LLMResponse {
  content: string;
  finishReason: "stop" | "length" | "tool_calls" | "error" | "unknown";
  // Error metadata (for retry / fallback decisions)
  error: boolean;
  errorMessage?: string;
  errorStatusCode?: number;
  errorShouldRetry?: boolean;
  retryAfter?: number;
  // Usage info (optional, for logging)
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/** LLMProvider interface (one method, one responsibility) */
interface LLMProvider {
  chat(messages: LLMMessage[]): Promise<LLMResponse>;
}

// ─── State ───────────────────────────────────────────────────────────────────

let mcpServer: Server | null = null;

/** Set the MCP server instance for sampling mode */
export function setLLMServer(server: Server): void {
  mcpServer = server;
}

// ─── Config helpers ──────────────────────────────────────────────────────────

/** Get LLM config from environment variables — all fields required, no defaults */
export function getLLMConfig(): LLMConfig | null {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;

  if (!apiKey || !baseUrl || !model) {
    return null;
  }
  return { apiKey, baseUrl, model };
}

/**
 * Detect API format: explicit LLM_API_FORMAT env var, or auto-detect from URL.
 * Mirrors ZCode's API Format dropdown: Chat Completions vs Anthropic Messages.
 */
export function detectApiFormat(baseUrl: string): ApiFormat {
  const explicit = process.env.LLM_API_FORMAT;
  if (explicit) {
    const fmt = explicit.toLowerCase().trim();
    if (fmt === "openai" || fmt === "anthropic") return fmt;
    console.error(`[LLM] Unknown LLM_API_FORMAT="${fmt}", falling back to URL detection`);
  }
  // Auto-detect: URL containing /anthropic → anthropic format
  if (baseUrl.includes("/anthropic")) return "anthropic";
  return "openai";
}

// ─── Capability checks ─────────────────────────────────────────────────────

/** Check if MCP sampling is available (server connected + client supports it) */
export function isSamplingAvailable(): boolean {
  if (mcpServer === null) return false;
  const caps = mcpServer.getClientCapabilities();
  return caps != null && caps.sampling != null;
}

/** Check if Direct HTTP is available (env vars configured) */
export function isHttpAvailable(): boolean {
  return getLLMConfig() !== null;
}

/** Get current mode for display */
export function getLLMMode(): "sampling" | "http" | "none" {
  if (isSamplingAvailable()) return "sampling";
  if (isHttpAvailable()) return "http";
  return "none";
}

/** Check if any LLM is available */
export function isLMAvailable(): boolean {
  return isSamplingAvailable() || isHttpAvailable();
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Call the LLM with a list of messages.
 * Priority: MCP Sampling → Direct HTTP
 */
export async function callLLM(messages: LLMMessage[]): Promise<LLMResponse> {
  // Mode 1: MCP Sampling — ask the client
  if (isSamplingAvailable()) {
    return await callViaSampling(messages);
  }

  // Mode 2: Direct HTTP
  const cfg = getLLMConfig();
  if (cfg) {
    const format = detectApiFormat(cfg.baseUrl);
    return await callViaHttp(messages, cfg, format);
  }

  // No LLM available
  return {
    content: "",
    finishReason: "error",
    error: true,
    errorMessage: "No LLM available. Connect via MCP or set LLM_API_KEY + LLM_BASE_URL + LLM_MODEL.",
  };
}

// ─── Sampling Provider ──────────────────────────────────────────────────────

async function callViaSampling(messages: LLMMessage[]): Promise<LLMResponse> {
  try {
    const systemContent = messages.find((m) => m.role === "system")?.content;
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: { type: "text" as const, text: m.content },
      }));

    // Prepend system content to first user message (SDK doesn't support system field)
    if (systemContent && chatMessages.length > 0 && chatMessages[0].role === "user") {
      chatMessages[0] = {
        ...chatMessages[0],
        content: { type: "text", text: `[System]\n${systemContent}\n\n[User]\n${chatMessages[0].content.text}` },
      };
    }

    const result = await mcpServer!.createMessage(
      { messages: chatMessages, maxTokens: 1024 },
      { timeout: 120_000 }
    );

    const content = result.content;
    if (content && "text" in content) {
      return {
        content: content.text as string,
        finishReason: "stop",
        error: false,
      };
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
      errorShouldRetry: false, // Don't retry sampling, fall through to HTTP
    };
  }
}

// ─── HTTP Providers ─────────────────────────────────────────────────────────

/**
 * Direct HTTP: dispatch to the correct provider based on format.
 */
async function callViaHttp(
  messages: LLMMessage[],
  cfg: LLMConfig,
  format: ApiFormat
): Promise<LLMResponse> {
  if (format === "anthropic") {
    return await callViaAnthropic(messages, cfg);
  }
  return await callViaOpenAI(messages, cfg);
}

/**
 * OpenAI Chat Completions format provider.
 * Works with: OpenAI, LongCat (OpenAI mode), SenseNova (OpenAI mode), DeepSeek, kimi, Ollama, etc.
 * All of them speak the same wire format: POST {base}/chat/completions
 */
async function callViaOpenAI(messages: LLMMessage[], cfg: LLMConfig): Promise<LLMResponse> {
  // Normalize URL: SenseNova needs /v1 prefix
  let baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  if (baseUrl.includes("token.sensenova.cn") && !baseUrl.includes("/v1")) {
    baseUrl = `${baseUrl}/v1`;
  }

  const url = `${baseUrl}/chat/completions`;

  // Build standard OpenAI request body
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0.3,
  };

  // Some models use max_completion_tokens instead of max_tokens (GPT-5, o-series)
  if (cfg.model.match(/^(gpt-5|o[1-4])/)) {
    body.max_completion_tokens = 1024;
  } else {
    body.max_tokens = 1024;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryAfter = response.headers.get("retry-after");
      return {
        content: "",
        finishReason: "error",
        error: true,
        errorMessage: `HTTP ${response.status}: ${errorText.slice(0, 300)}`,
        errorStatusCode: response.status,
        errorShouldRetry: response.status === 429 || response.status >= 500,
        retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason ?? "unknown";

    if (!content) {
      return {
        content: "",
        finishReason: "error",
        error: true,
        errorMessage: "API returned empty content",
      };
    }

    return {
      content,
      finishReason: finishReason as LLMResponse["finishReason"],
      error: false,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: "",
      finishReason: "error",
      error: true,
      errorMessage: `OpenAI request failed: ${msg}`,
      errorShouldRetry: true, // Network error — retry
    };
  }
}

/**
 * Anthropic Messages format provider.
 * Works with: LongCat (Anthropic mode), SenseNova (Anthropic mode), native Anthropic.
 * Auth: LongCat uses x-api-key, SenseNova/Anthropic use Bearer.
 * Body: Anthropic format (system as top-level, messages without system role).
 */
async function callViaAnthropic(messages: LLMMessage[], cfg: LLMConfig): Promise<LLMResponse> {
  const isLongCat = cfg.baseUrl.includes("/anthropic");

  // Build URL
  let baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  let url: string;
  if (isLongCat) {
    url = `${baseUrl.replace(/\/anthropic$/, "")}/anthropic/v1/messages`;
  } else {
    if (!baseUrl.includes("/v1")) baseUrl = `${baseUrl}/v1`;
    url = `${baseUrl}/messages`;
  }

  // Build Anthropic-format body
  const systemMessage = messages.find((m) => m.role === "system");
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 1024,
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    system: systemMessage?.content,
  };

  // Auth header: LongCat uses x-api-key, others use Bearer
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (isLongCat) {
    headers["x-api-key"] = cfg.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryAfter = response.headers.get("retry-after");
      return {
        content: "",
        finishReason: "error",
        error: true,
        errorMessage: `HTTP ${response.status}: ${errorText.slice(0, 300)}`,
        errorStatusCode: response.status,
        errorShouldRetry: response.status === 429 || response.status >= 500,
        retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
      };
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text: string }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const textBlock = data.content?.find((c) => c.type === "text");
    if (!textBlock) {
      return {
        content: "",
        finishReason: "error",
        error: true,
        errorMessage: "Anthropic API returned no text content",
      };
    }

    return {
      content: textBlock.text,
      finishReason: (data.stop_reason === "max_tokens" ? "length" : data.stop_reason === "end_turn" ? "stop" : "unknown") as LLMResponse["finishReason"],
      error: false,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
          }
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: "",
      finishReason: "error",
      error: true,
      errorMessage: `Anthropic request failed: ${msg}`,
      errorShouldRetry: true,
    };
  }
}
