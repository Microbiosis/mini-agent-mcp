/**
 * Declarative Config — auto-generates server configuration from a JSON/YAML config file.
 *
 * Inspired by Yao's declarative config pattern:
 *   - Define providers, tools, workflow in one config file
 *   - Server auto-generates registration, env vars, and API surface
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Optional: label for display */
  label?: string;
}

export interface ToolConfig {
  /** Built-in tool name to enable/disable */
  name: string;
  enabled: boolean;
  /** Custom timeout override for this tool */
  timeoutMs?: number;
}

export interface WorkflowConfig {
  id: string;
  label?: string;
  steps: Array<{
    id: string;
    task: string;
    dependsOn?: string[];
    label?: string;
    timeout?: number;
  }>;
}

export interface AppConfig {
  /** LLM provider definitions */
  providers?: Record<string, ProviderConfig>;
  /** Active provider name (defaults to "default") */
  activeProvider?: string;
  /** Provider config file path (alternative to inline providers) */
  providersPath?: string;
  /** Tool configurations */
  tools?: ToolConfig[];
  /** Predefined workflows */
  workflows?: WorkflowConfig[];
  /** Server settings */
  server?: {
    maxConcurrent?: number;
    maxTurns?: number;
    toolRetry?: number;
    transport?: "stdio" | "httpStream";
    port?: number;
  };
}

const CONFIG_PATHS = [
  resolve(process.cwd(), "mini-agent.json"),
  resolve(process.cwd(), "mini-agent.yaml"),
  resolve(process.cwd(), ".mini-agent.json"),
];

/**
 * Load config from config file.
 * Returns null if no config file is found.
 */
export function loadConfig(): AppConfig | null {
  for (const path of CONFIG_PATHS) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf8");
        const config = JSON.parse(raw) as AppConfig;
        console.error(`[Config] Loaded from ${path}`);
        return config;
      } catch (err) {
        console.error(`[Config] Error loading ${path}: ${err}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Apply config to environment variables.
 * Sets env vars from config values so the rest of the system picks them up.
 */
export function applyConfig(config: AppConfig): void {
  // Apply active provider
  if (config.providers) {
    const active = config.activeProvider || "default";
    const provider = config.providers[active];
    if (provider) {
      if (provider.apiKey) process.env.LLM_API_KEY = provider.apiKey;
      if (provider.baseUrl) process.env.LLM_BASE_URL = provider.baseUrl;
      if (provider.model) process.env.LLM_MODEL = provider.model;
      console.error(`[Config] Active provider: ${active}${provider.label ? " (" + provider.label + ")" : ""}`);
    }
  }

  // Apply providers path
  if (config.providersPath) {
    process.env.LLM_PROVIDERS_PATH = config.providersPath;
  }

  // Apply server settings
  if (config.server) {
    if (config.server.maxConcurrent) process.env.TOOL_MAX_CONCURRENT = String(config.server.maxConcurrent);
    if (config.server.maxTurns) process.env.AGENT_MAX_TURNS = String(config.server.maxTurns);
    if (config.server.toolRetry) process.env.AGENT_TOOL_RETRY = String(config.server.toolRetry);
  }

  console.error(`[Config] Applied ${Object.keys(config).length} config sections`);
}

/**
 * Load and apply config in one call.
 */
export function loadAndApplyConfig(): AppConfig | null {
  const config = loadConfig();
  if (config) applyConfig(config);
  return config;
}