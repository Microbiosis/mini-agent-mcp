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
 */
export async function runWorkflow(steps: WorkflowStep[]): Promise<WorkflowResult> {
  const start = Date.now();
  const completed = new Map<string, string>();
  const results: WorkflowResult["steps"] = [];

  // Validate no circular dependencies
  const visited = new Set<string>();
  function checkCycle(id: string, path: Set<string>) {
    if (path.has(id)) throw new Error(`Circular dependency detected: ${id}`);
    if (visited.has(id)) return;
    visited.add(id);
    path.add(id);
    const step = steps.find((s) => s.id === id);
    for (const dep of step?.dependsOn || []) checkCycle(dep, new Set(path));
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
        try {
          const timeoutMs = (step.timeout || 60) * 1000;
          // Inject predecessor results so dependencies see their context.
          const effectiveTask = buildStepTask(step, completed);
          const result = await Promise.race([
            runAgent(effectiveTask),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Workflow step '${step.id}' timed out after ${timeoutMs}ms`)),
                timeoutMs
              )
            ),
          ]);
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
            error: msg,
            durationMs: Date.now() - stepStart,
          };
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
