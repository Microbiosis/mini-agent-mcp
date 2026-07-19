/**
 * DagWorkflow — Directed Acyclic Graph workflow orchestration.
 *
 * Inspired by ms-agent's DagWorkflow:
 *   - Define workflow steps with dependencies
 *   - Steps run in order based on dependency resolution
 *   - Each step calls runAgent with a task
 *   - Results propagate between steps
 */

import { runAgent } from "../agent/react.js";

export interface WorkflowStep {
  /** Unique step ID */
  id: string;
  /** Task description for the agent */
  task: string;
  /** IDs of steps that must complete before this one */
  dependsOn?: string[];
  /** Timeout in seconds (default 60) */
  timeout?: number;
  /** Optional label for display */
  label?: string;
}

export interface WorkflowResult {
  success: boolean;
  steps: Array<{
    id: string;
    label?: string;
    result: string;
    error?: string;
    durationMs: number;
  }>;
  totalDurationMs: number;
}

/**
 * Inject the results of a step's dependencies into the task string.
 *
 * This is what makes "results propagate between steps" actually true.
 * When a step depends on prior steps, their `result.answer` strings are
 * gathered here and appended to the original task so the downstream
 * runAgent call has the context it needs.
 *
 * Exported so tests can verify behavior without invoking runAgent.
 */
export function buildStepTask(step: WorkflowStep, completed: Map<string, string>): string {
  const deps = step.dependsOn || [];
  if (deps.length === 0) {
    return step.task;
  }

  const blocks: string[] = [];
  for (const depId of deps) {
    const ans = completed.get(depId);
    if (ans !== undefined) {
      blocks.push(`[${depId}]\n${ans}`);
    }
  }

  if (blocks.length === 0) return step.task;

  return [step.task, "", "---", "Results from previous steps:", ...blocks].join("\n");
}

/**
 * Run a DAG workflow.
 * Steps with no dependencies start immediately.
 * Steps with dependencies wait for their prerequisites to complete.
 *
 * For dependent steps, the results of prerequisite steps are automatically
 * appended to the step's task before it is executed. See `buildStepTask`.
 *
 * `options.toolAllowlist` scopes the tools that nested runAgent() calls
 * may dispatch — used by `run_workflow` to avoid recursive orchestration.
 */
export interface RunWorkflowOptions {
  toolAllowlist?: string[];
}
export async function runWorkflow(steps: WorkflowStep[], options: RunWorkflowOptions = {}): Promise<WorkflowResult> {
  // Validate step definition shape up-front, so the user gets a clear error
  // rather than a deadlock later.
  validateSteps(steps);

  const start = Date.now();
  const completed = new Map<string, string>();
  const results: WorkflowResult["steps"] = [];

  // Detect cycles. Build a local id-index to make repeated lookups cheap.
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  function checkCycle(id: string, path: Set<string>) {
    if (path.has(id)) throw new Error(`Circular dependency detected: ${id}`);
    if (visited.has(id)) return;
    visited.add(id);
    path.add(id);
    const step = byId.get(id);
    for (const dep of step?.dependsOn || []) {
      if (!byId.has(dep)) {
        throw new Error(`Step '${id}' depends on unknown step '${dep}'`);
      }
      checkCycle(dep, new Set(path));
    }
    path.delete(id);
  }
  for (const s of steps) checkCycle(s.id, new Set());

  // Get ready steps (no unmet dependencies)
  function getReady(): WorkflowStep[] {
    return steps.filter((s) => {
      if (completed.has(s.id)) return false;
      return (s.dependsOn || []).every((d) => completed.has(d));
    });
  }

  // Run steps sequentially (respecting dependencies)
  while (completed.size < steps.length) {
    const ready = getReady();

    if (ready.length === 0) {
      // Deadlock: some steps have unmet dependencies that will never complete
      const blocked = steps.filter((s) => !completed.has(s.id));
      for (const b of blocked) {
        results.push({
          id: b.id,
          label: b.label,
          result: "",
          error: `Blocked by unmet dependencies: ${(b.dependsOn || []).filter((d) => !completed.has(d)).join(", ")}`,
          durationMs: 0,
        });
      }
      break;
    }

    // Run ready steps in parallel (independent branches)
    const stepResults = await Promise.all(
      ready.map(async (step) => {
        const stepStart = Date.now();
        const timeoutMs = (step.timeout || 60) * 1000;
        let timedOut = false;
        let timer: NodeJS.Timeout | undefined;
        try {
          // Inject predecessor results so dependencies see their context.
          const effectiveTask = buildStepTask(step, completed);
          const runP = runAgent(effectiveTask, undefined, undefined, {
            toolAllowlist: options.toolAllowlist,
          });
          const timeoutP = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              reject(new Error(`Workflow step '${step.id}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            // unref so a hung step never blocks process exit
            timer.unref?.();
          });
          const result = await Promise.race([runP, timeoutP]);
          const duration = Date.now() - stepStart;
          completed.set(step.id, result.answer);
          return {
            id: step.id,
            label: step.label,
            result: result.answer,
            error: undefined,
            durationMs: duration,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          completed.set(step.id, "");
          return {
            id: step.id,
            label: step.label,
            result: "",
            error: timedOut ? `Timed out after ${timeoutMs}ms` : msg,
            durationMs: Date.now() - stepStart,
          };
        } finally {
          if (timer) clearTimeout(timer);
        }
      })
    );
    results.push(...stepResults);
  }

  return {
    success: results.every((r) => !r.error),
    steps: results,
    totalDurationMs: Date.now() - start,
  };
}

/** Up-front validation of a workflow definition. */
function validateSteps(steps: WorkflowStep[]): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("Workflow must contain at least one step");
  }
  const ids = new Set<string>();
  for (const s of steps) {
    if (!s || typeof s !== "object") {
      throw new Error("Each workflow step must be an object");
    }
    if (typeof s.id !== "string" || s.id.length === 0) {
      throw new Error(`Workflow step id must be a non-empty string (got ${JSON.stringify(s)})`);
    }
    if (ids.has(s.id)) {
      throw new Error(`Duplicate workflow step id: ${s.id}`);
    }
    ids.add(s.id);
    if (typeof s.task !== "string" || s.task.length === 0) {
      throw new Error(`Workflow step '${s.id}' requires a non-empty task`);
    }
    if (s.timeout !== undefined) {
      if (!Number.isFinite(s.timeout) || s.timeout <= 0 || s.timeout > 3600) {
        throw new Error(`Workflow step '${s.id}' timeout must be in (0, 3600] seconds`);
      }
    }
    for (const dep of s.dependsOn || []) {
      if (typeof dep !== "string") {
        throw new Error(`Workflow step '${s.id}' dependencies must be strings`);
      }
    }
  }
}
