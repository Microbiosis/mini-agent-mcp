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
 * Run a DAG workflow.
 * Steps with no dependencies start immediately.
 * Steps with dependencies wait for their prerequisites to complete.
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

    for (const step of ready) {
      const stepStart = Date.now();
      try {
        // Timeout handling
        const timeoutMs = (step.timeout || 60) * 1000;
        const result = await Promise.race([
          runAgent(step.task),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Workflow step '${step.id}' timed out after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);
        const duration = Date.now() - stepStart;
        completed.set(step.id, result.answer);
        results.push({ id: step.id, label: step.label, result: result.answer, durationMs: duration });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ id: step.id, label: step.label, result: "", error: msg, durationMs: Date.now() - stepStart });
        // Mark as completed with empty result so dependent steps can still run
        completed.set(step.id, "");
      }
    }
  }

  return {
    success: results.every((r) => !r.error),
    steps: results,
    totalDurationMs: Date.now() - start,
  };
}