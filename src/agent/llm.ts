/**
 * LLM Communication Layer — powered by OpenAI SDK
 *
 * Uses the official OpenAI SDK for all LLM calls. This handles:
 *   - API format normalization
 *   - Authentication (Bearer / x-api-key)
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

export interface LLMResponse {
  content: string;
  finishReason: "stop" | "length" | "tool_calls" | "error" | "unknown";
  error: boolean;
  errorMessage?: string;
  errorStatusCode?: number;
  errorShouldRetry?: boolean;
  retryAfter?: number;
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

/**
 * Get or create the OpenAI SDK client.
 * Re-uses the same client instance if config hasn't changed.
 */
function getOpenAIClient(): OpenAI | null {
  const cfg = getLLMConfig();
  if (!cfg) return null;

  // Reuse existing client if config matches
  if (openaiClient) return openaiClient;

  const resolvedBaseUrl = cfg.baseUrl.replace(/\/+$/, "");

  // Determine auth: LongCat Anthropic uses x-api-key, others use Bearer
  const isAnthropicViaLongCat = cfg.baseUrl.includes("/anthropic") || process.env.LLM_API_FORMAT === "anthropic";

  if (isAnthropicViaLongCat) {
    // For Anthropic-compatible endpoints, build a custom client with x-api-key
    openaiClient = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: `${resolvedBaseUrl.replace(/\/anthropic$/, "")}/anthropic/v1`,
      defaultHeaders: { "anthropic-version": "2023-06-01", "x-api-key": cfg.apiKey },
    });
  } else {
    // Standard OpenAI-compatible endpoint
    openaiClient = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: resolvedBaseUrl,
    });
  }

  return openaiClient;
}

/**
 * Reset the OpenAI client (needed when env vars change).
 */
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

export async function callLLM(messages: LLMMessage[]): Promise<LLMResponse> {
  if (isSamplingAvailable()) {
    return await callViaSampling(messages);
  }

  const client = getOpenAIClient();
  if (client) {
    return await callViaOpenAI(client, messages);
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
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: { type: "text" as const, text: m.content },
      }));

    const result = await mcpServer!.createMessage(
      { messages: chatMessages, systemPrompt: systemContent, maxTokens: 1024 },
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

async function callViaOpenAI(client: OpenAI, messages: LLMMessage[]): Promise<LLMResponse> {
  try {
    const response = await client.chat.completions.create(
      {
        model: process.env.LLM_MODEL || "gpt-4o-mini",
        messages,
        temperature: 0.3,
        max_tokens: 1024,
      },
      { timeout: 60_000 }
    );

    const choice = response.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason ?? "unknown";

    if (!content) {
      return {
        content: "", finishReason: "error", error: true,
        errorMessage: "OpenAI SDK returned empty content",
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

    return {
      content: "", finishReason: "error", error: true,
      errorMessage: `OpenAI SDK error: ${msg}`,
      errorStatusCode: statusCode,
      errorShouldRetry: statusCode === 429 || !statusCode || statusCode >= 500,
    };
  }
}
