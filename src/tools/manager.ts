/**
 * ToolManager — unified tool registry with timeout and concurrency control.
 *
 * Inspired by ms-agent's ToolManager pattern:
 *   - Single registry for all tools (local + remote)
 *   - Per-call timeout enforcement
 *   - Concurrency caps (max parallel executions)
 *   - Per-tool mutual exclusion when `concurrencySafe === false`
 *   - Call history tracking
 *
 * Timeouts do NOT trigger automatic retries: the underlying async work
 * keeps running and may produce duplicate side effects if the same call
 * were re-issued. Only re-classified transient errors (5xx / 429 / reset)
 * are retried.
 */

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

/** Max tool retries on transient error (env TOOL_RETRY_COUNT, default 2) */
const TOOL_RETRY_COUNT = (() => {
  const v = process.env.TOOL_RETRY_COUNT;
  if (v) {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 0 && n <= 5) return n;
  }
  return 2;
})();

/** Classify error as hard or transient */
function classifyToolError(err: unknown): "hard" | "transient" {
  const m = err instanceof Error ? err.message : String(err);
  const l = m.toLowerCase();
  if (
    l.includes("401") ||
    l.includes("403") ||
    l.includes("refused") ||
    l.includes("dns") ||
    l.includes("enotfound")
  )
    return "hard";
  if (l.includes("timeout") || l.includes("429") || l.includes("5xx") || l.includes("econnreset"))
    return "transient";
  return "hard";
}

export class ToolManagerImpl {
  private tools: Map<string, ToolEntry> = new Map();
  private activeCalls = 0;
  private callHistory: ToolCallRecord[] = [];
  private maxConcurrent = 10;
  /** Per-tool mutex queues for `concurrencySafe: false` tools. */
  private perToolQueues: Map<string, Promise<unknown>> = new Map();

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
   * Acquire the per-tool mutex for tools that are NOT concurrency-safe.
   * Calls are chained so they run strictly sequentially; downstream
   * callers always see the previous call resolved before starting.
   */
  private async withPerToolLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.perToolQueues.get(name) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.perToolQueues.set(name, prev.then(() => next));
    try {
      await prev;
      return await fn();
    } finally {
      release();
      // Compact: if no other call has queued in the meantime, drop the entry.
      if (this.perToolQueues.get(name) === next) this.perToolQueues.delete(name);
    }
  }

  /**
   * Execute a tool with smart_retry, timeout, and concurrency enforcement.
   * - Hard errors (401/403/refused) → fail immediately
   * - Transient errors (429/5xx/reset — NOT timeouts) → retry with exponential backoff
   * - `concurrencySafe: false` tools are serialized per name
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found. Available: ${Array.from(this.tools.keys()).join(", ")}`);
    }

    if (this.activeCalls >= this.maxConcurrent) {
      throw new Error(`Concurrency limit (${this.maxConcurrent}) reached. Try again later.`);
    }

    const guardrailError = this.runGuardrails(name, args);
    if (guardrailError) return guardrailError;

    const dispatcher = async (): Promise<{ result: string; error: boolean }> => {
      this.activeCalls++;
      const start = Date.now();
      let result: string | undefined;
      let error = false;
      try {
        for (let attempt = 1; attempt <= TOOL_RETRY_COUNT + 1; attempt++) {
          try {
            result = await this.executeWithTimeout(tool, args);
            error = false;
            break;
          } catch (err) {
            const type = classifyToolError(err);
            // Timeouts always fail through without retry — the underlying
            // async work is still in flight and re-invoking would produce
            // duplicate side effects.
            const isTimeout = err instanceof Error && err.message.startsWith(`Tool '${tool.name}' timed out`);
            if (type === "hard" || isTimeout || attempt > TOOL_RETRY_COUNT) {
              error = true;
              result = `Error: ${err instanceof Error ? err.message : String(err)}`;
              break;
            }
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
            console.error(
              `[ToolManager] Retry ${attempt}/${TOOL_RETRY_COUNT} for '${tool.name}' after ${delay}ms`
            );
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      } finally {
        this.activeCalls--;
      }
      const finalResult = result ?? `Error: tool '${name}' produced no result`;
      this.callHistory.push({
        toolName: name,
        args,
        result: finalResult,
        durationMs: Date.now() - start,
        error,
        timestamp: Date.now(),
      });
      return { result: finalResult, error };
    };

    const dispatched = tool.concurrencySafe ? await dispatcher() : await this.withPerToolLock(name, dispatcher);
    return dispatched.result;
  }

  /** Execute with timeout */
  private executeWithTimeout(tool: ToolEntry, args: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = tool.timeoutMs > 0 ? tool.timeoutMs : 30000;
      let settled = false;
      let timerRef: { value: NodeJS.Timeout } | null = null;
      const finish = (cb: () => void) => {
        if (settled) return;
        settled = true;
        if (timerRef) clearTimeout(timerRef.value);
        cb();
      };
      timerRef = {
        value: setTimeout(() => {
          finish(() => reject(new Error(`Tool '${tool.name}' timed out after ${timeout}ms`)));
        }, timeout),
      };
      timerRef.value.unref?.();
      tool.execute(args).then(
        (result) => finish(() => resolve(result)),
        (err) => finish(() => reject(err))
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
