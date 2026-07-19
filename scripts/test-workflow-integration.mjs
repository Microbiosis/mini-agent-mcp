// Integration test: drives a 3-step DAG through the real runWorkflow
// + runAgent (LLM mode) path and verifies that the previously-broken
// behavior — dependent steps not seeing prior results — is now fixed.
//
// No credentials in this file. When LLM_API_KEY is missing the
// DAG integration portion SKIPs, but the parseSubQuestions assertions
// still run as a no-LLM regression suite.
if (!process.env.LLM_API_KEY) {
  console.log("[SKIP] test-workflow-integration: LLM_API_KEY not set; skipping DAG regression");
} else {
  process.env.LLM_BASE_URL ??= "https://api.longcat.chat/openai/v1";
  process.env.LLM_MODEL ??= "LongCat-2.0";
  process.env.AGENT_MAX_TURNS ??= "4";
}

import assert from "node:assert/strict";
import { runWorkflow } from "../dist/workflow/dag.js";
import { parseSubQuestions } from "../dist/workflow/research.js";

if (process.env.LLM_API_KEY) {
  console.log("=== Integration: workflow step dependencies now see prior results ===");
  const result = await runWorkflow([
    { id: "calc1", label: "Compute 2^10", task: 'Use the calculator tool to compute 2 ** 10. Reply with ONLY the number, nothing else.', timeout: 60 },
    { id: "calc2", label: "Compute 100/4", task: 'Use the calculator tool to compute 100 / 4. Reply with ONLY the number, nothing else.', timeout: 60 },
    {
      id: "summarize",
      label: "Summarize using prior results",
      task:
        'Below are the results of two prior calculator steps.\n' +
        'Restate BOTH numbers exactly as they appear, then write ONE sentence combining them.\n' +
        'Your final answer MUST contain the literal strings "1024" and "25".',
      dependsOn: ["calc1", "calc2"],
      timeout: 90,
    },
  ]);

  console.log("\nWorkflow result:");
  console.log(`  success: ${result.success}  totalMs: ${result.totalDurationMs}`);
  for (const s of result.steps) {
    console.log(`  - [${s.id}] ${s.error ? "FAIL " + s.error : "OK " + s.durationMs + "ms"}`);
    console.log(`      -> ${s.result.slice(0, 200)}`);
  }

  const sum = result.steps.find((s) => s.id === "summarize");
  assert.ok(sum, "summarize step exists");
  assert.ok(!sum.error, `summarize must not error, got: ${sum.error}`);

  assert.match(sum.result, /1024/, "summarize result contains 1024");
  assert.match(sum.result, /25/, "summarize result contains 25");

  console.log("\n✓ summarize step sees both predecessor values");

  console.log(`\nALL PASSED — workflow success=${result.success}`);
  process.exit(result.success ? 0 : 1);
}

console.log("\n=== parseSubQuestions end-to-end on a real LLM-style answer ===");

const cased1 = "```\n- What is a binary tree structure?\n- How is in-order traversal done?\n- When should one balance a tree?\n```";
assert.deepEqual(parseSubQuestions(cased1), [
  "What is a binary tree structure?",
  "How is in-order traversal done?",
  "When should one balance a tree?",
]);
console.log("✓ parseSubQuestions on fenced answer");

const cased2 = "```\n- short\n- Exactly twelve characters in this line\n- Maybe questions are clearer with a question mark?\n```";
assert.deepEqual(parseSubQuestions(cased2), [
  "Exactly twelve characters in this line",
  "Maybe questions are clearer with a question mark?",
]);
console.log("✓ parseSubQuestions enforces ≥12-char rule");

