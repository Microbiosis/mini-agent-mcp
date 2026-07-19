// runWorkflow input validation — fails fast on bad definitions instead
// of deadlocking on them later.

import assert from "node:assert/strict";
import { runWorkflow } from "../dist/workflow/dag.js";

async function expectThrow(label, steps, match) {
  try {
    await runWorkflow(steps);
    throw new Error(`expected throw for: ${label}`);
  } catch (e) {
    assert.match(e.message, match, `${label} → ${e.message}`);
    console.log(`  ✓ ${label}`);
  }
}

await expectThrow("empty array", [], /at least one step/);
await expectThrow("missing id", [{ task: "x" }], /id must be a non-empty string/);
await expectThrow("duplicate id", [{ id: "a", task: "x" }, { id: "a", task: "y" }], /Duplicate/);
await expectThrow("missing task", [{ id: "a" }], /requires a non-empty task/);
await expectThrow("unknown dep", [{ id: "a", task: "x", dependsOn: ["ghost"] }], /unknown step 'ghost'/);
// Timeout > 3600
await expectThrow(
  "timeout too large",
  [{ id: "a", task: "x", timeout: 7200 }],
  /timeout must be in \(0, 3600\]/
);

console.log("\nResult: validation tests passed");
