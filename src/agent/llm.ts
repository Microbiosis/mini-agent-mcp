/**
 * LLM Communication Layer — powered by OpenAI SDK
 *
 * Uses the official OpenAI SDK for all LLM calls. This handles:
 *   - Authentication (Bearer <REDACTED>)
 *   - API format normalization
 *   - Retry logic with exponential backoff
 *   - Timeout handling
 *   - Token usage tracking
 *
 * Modes (priority order):
 *   1. MCP Sampling — client handles LLM (zero config)
 *   2. Direct HTTP — SDK calls LLM API directly
 *   3. Rule-based — fallback when no LLM available
 */

import OpenAI from "openai";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

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

let mcpServer: Server | null = null;
let openaiClient: OpenAI | null = null;

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

  openaiClient = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl.replace(/\/+$/, ""),
  });

  return openaiClient;
}

/** Reset the OpenAI client (needed when env vars change). */
export function resetOpenAIClient(): void {
  openaiClient = null;
}

// ─── Capability checks ─────────────────────────────────────────────────────

export function isSamplingAvailable(): boolean {
  if (mcpServer === null) return false;
  const caps = mcpServer.getClientCapabilities();
  return caps != null && caps.sampling != null;
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
    const result = await mcpServer!.createMessage(
      { messages: chatMessages, systemPrompt, maxTokens },
      { timeout: 120_000 }
    );

    const content = result.content;
    if (content && "text" in content) {
      return { content: content.text as string, finishReason: "stop", error: false };
    }

    return {
      content: "", finishReason: "error", error: true,
      errorMessage: "MCP sampling returned non-text content",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: "", finishReason: "error", error: true,
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
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    };
    if (tools) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;

    const response = await client.chat.completions.create(body as any, { timeout: 60_000 });

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
        toolCalls: (toolCalls as Array<{ id: string; type: string; function: { name: string; arguments: string } }>).map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
      };
    }

    return {
      content,
      finishReason: finishReason as LLMResponse["finishReason"],
      error: false,
      usage: response.usage
        ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens }
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusCode = err instanceof OpenAI.APIError ? err.status : undefined;
    console.error(`[OpenAI SDK] Error: ${msg}`);
    return {
      content: "", finishReason: "error", error: true,
      errorMessage: `OpenAI SDK error: ${msg}`,
      errorStatusCode: statusCode,
      errorShouldRetry: statusCode === 429 || !statusCode || statusCode >= 500,
    };
  }
}
