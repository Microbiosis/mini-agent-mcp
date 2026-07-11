/**
 * LLM client — two communication modes for the agent's reasoning:
 *
 * 1. MCP Sampling (preferred): server.createMessage() asks the client
 *    (ZCode) to perform LLM inference. The client picks the model — no
 *    API keys needed on the server side. This is how MCP servers talk
 *    to multiple models through a single client.
 *
 * 2. Direct HTTP (fallback): server calls an OpenAI-compatible API directly
 *    using LLM_API_KEY + LLM_BASE_URL + LLM_MODEL env vars.
 *
 * Configure via env vars (for HTTP mode only — MCP sampling needs none):
 *   LLM_API_KEY   — API key
 *   LLM_BASE_URL  — base URL (e.g. https://api.longcat.chat/openai)
 *   LLM_MODEL     — model name (e.g. LongCat-2.0-Preview)
 *
 * No defaults: if env vars are unset, only MCP sampling is available.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** The MCP server instance — set via setLLMServer() once connected */
let mcpServer: Server | null = null;

/** Set the server instance for MCP sampling mode */
export function setLLMServer(server: Server): void {
  mcpServer = server;
}

/** Check if MCP sampling is available (server connected + client supports it) */
export function isSamplingAvailable(): boolean {
  return mcpServer !== null;
}

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
 * Check if LLM reasoning is available by any means:
 * - MCP sampling (client handles the model)
 * - Direct HTTP (env vars configured)
 */
export function isLMAvailable(): boolean {
  return isSamplingAvailable() || getLLMConfig() !== null;
}

/**
 * Get the communication mode label for display
 */
export function getLLMMode(): "sampling" | "http" | "none" {
  if (isSamplingAvailable()) return "sampling";
  if (getLLMConfig()) return "http";
  return "none";
}

/**
 * Call the LLM with a list of messages and get a response.
 *
 * Priority:
 * 1. MCP sampling (server.createMessage) — client picks model
 * 2. Direct HTTP — use env var config
 *
 * @param messages - conversation history
 * @param config - optional HTTP config override
 */
export async function callLLM(
  messages: LLMMessage[],
  config?: LLMConfig
): Promise<string> {
  // Mode 1: MCP sampling — ask the client to sample
  if (isSamplingAvailable()) {
    return await callViaSampling(messages);
  }

  // Mode 2: Direct HTTP
  const cfg = config || getLLMConfig();
  if (cfg) {
    return await callViaHTTP(messages, cfg);
  }

  throw new Error(
    "No LLM available. Either:\n" +
    "  1. Connect via MCP (the client provides sampling) — no env vars needed, or\n" +
    "  2. Set LLM_API_KEY + LLM_BASE_URL + LLM_MODEL (no defaults)."
  );
}

/**
 * MCP Sampling mode: request the client to perform LLM inference.
 * The client decides which model to use — this is the native MCP way
 * for servers to access LLM capabilities without holding credentials.
 */
async function callViaSampling(messages: LLMMessage[]): Promise<string> {
  // Convert LLMMessage to SamplingMessage format
  const samplingMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: {
      type: "text" as const,
      text: m.content,
    },
  }));

  const result = await mcpServer!.createMessage(
    {
      messages: samplingMessages,
      maxTokens: 1024,
    },
    { timeout: 60_000 }
  );

  // Extract text content from the response
  const content = result.content;
  if (content && "text" in content) {
    return content.text as string;
  }

  throw new Error("MCP sampling returned non-text content");
}

/**
 * Direct HTTP mode: call an OpenAI-compatible API.
 */
async function callViaHTTP(
  messages: LLMMessage[],
  cfg: LLMConfig
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM API error (${response.status}): ${errorText.slice(0, 500)}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response");
  }
  return content;
}
