/**
 * ToolManager — unified tool registry with timeout and concurrency control.
 *
 * Inspired by ms-agent's ToolManager pattern:
 *   - Single registry for all tools (local + remote)
 *   - Per-call timeout enforcement
 *   - Concurrency caps (max parallel executions)
 *   - Call history tracking
 */

import type { ToolResult } from "./types.js";

export interface ToolEntry {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<string>;
  timeoutMs: number;
  /** Whether this tool is safe to run concurrently */
  concurrencySafe: boolean;
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  error: boolean;
  timestamp: number;
}

class ToolManagerImpl {
  private tools: Map<string, ToolEntry> = new Map();
  private activeCalls = 0;
  private callHistory: ToolCallRecord[] = [];
  private maxConcurrent = 10;

  constructor() {
    // Load max concurrent from env, default 10
    const val = process.env.TOOL_MAX_CONCURRENT;
    if (val) {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) this.maxConcurrent = n;
    }
  }

  /** Register a tool */
  register(entry: ToolEntry): void {
    this.tools.set(entry.name, entry);
  }

  /** Register multiple tools at once */
  registerAll(entries: ToolEntry[]): void {
    for (const e of entries) this.register(e);
  }

  /** Get a tool by name */
  get(name: string): ToolEntry | undefined {
    return this.tools.get(name);
  }

  /** List all registered tools */
  list(): ToolEntry[] {
    return Array.from(this.tools.values());
  }

  /** Number of registered tools */
  get size(): number {
    return this.tools.size;
  }

  /** Get call history (most recent first) */
  getHistory(limit = 10): ToolCallRecord[] {
    return this.callHistory.slice(-limit).reverse();
  }

  /**
   * Execute a tool with timeout and concurrency enforcement.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found. Available: ${Array.from(this.tools.keys()).join(", ")}`);
    }

    // Check concurrency cap
    if (this.activeCalls >= this.maxConcurrent) {
      throw new Error(`Concurrency limit (${this.maxConcurrent}) reached. Try again later.`);
    }

    // Notify guardrails (if any)
    const guardrailError = this.runGuardrails(name, args);
    if (guardrailError) return guardrailError;

    this.activeCalls++;
    const start = Date.now();
    let error = false;
    let result: string;

    try {
      result = await this.executeWithTimeout(tool, args);
    } catch (err) {
      error = true;
      result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.activeCalls--;
    }

    // Record call
    this.callHistory.push({
      toolName: name,
      args,
      result,
      durationMs: Date.now() - start,
      error,
      timestamp: Date.now(),
    });

    return result;
  }

  /** Execute with timeout */
  private executeWithTimeout(tool: ToolEntry, args: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      // Only set timeout if not already negative
      const timeout = tool.timeoutMs > 0 ? tool.timeoutMs : 30000;
      const timer = setTimeout(() => {
        reject(new Error(`Tool '${tool.name}' timed out after ${timeout}ms`));
      }, timeout);

      tool.execute(args).then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  /** Built-in guardrails */
  private runGuardrails(toolName: string, args: Record<string, unknown>): string | null {
    // input-length guardrail
    for (const [key, val] of Object.entries(args)) {
      if (typeof val === "string" && val.length > 10000) {
        return `[Guardrail] Parameter '${key}' exceeds 10,000 characters`;
      }
    }
    // calculator-expression guardrail
    if (toolName === "calculator" && typeof args.expression === "string" && args.expression.length > 500) {
      return "[Guardrail] Expression too long (max 500 chars)";
    }
    return null;
  }
}

/** Singleton ToolManager instance */
export const toolManager = new ToolManagerImpl();