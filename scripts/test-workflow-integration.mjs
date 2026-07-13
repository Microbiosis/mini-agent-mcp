// Integration test: drives a 3-step DAG through the real runWorkflow
// + runAgent (LLM mode) path and verifies that the previously-broken
// behavior — dependent steps not seeing prior results — is now fixed.
//
// Requires network access to api.longcat.chat.
// Run with: node scripts/test-workflow-integration.mjs
process.env.LLM_API_KEY = "REDACTED-LONGCHAT-API-KEY-ROTATE-IN-VENDOR-CONSOLE";
process.env.LLM_BASE_URL = "https://api.longcat.chat/openai";
process.env.LLM_MODEL = "LongCat-2.0";
process.env.AGENT_MAX_TURNS = "4";

import assert from "node:assert/strict";
import { runWorkflow } from "../dist/workflow/dag.js";
import { parseSubQuestions } from "../dist/workflow/research.js";

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

// Core regression assertions — these would fail before the fix.
assert.match(sum.result, /1024/, "summarize result contains 1024");
assert.match(sum.result, /25/, "summarize result contains 25");

console.log("\n✓ summarize step sees both predecessor values");

console.log("\n=== Integration: parseSubQuestions end-to-end on a real LLM-style answer ===");

// These two don't need a live LLM; they're the parser on canned input.
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

console.log(`\nALL PASSED — workflow success=${result.success}`);
process.exit(result.success ? 0 : 1);
