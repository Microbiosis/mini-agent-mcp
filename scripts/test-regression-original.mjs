// Mirror of the ORIGINAL test-workflow.mjs Test 1, run post-fix to confirm
// Bug A is gone. Uses the exact phrasing from the original buggy run.
process.env.LLM_API_KEY = "REDACTED-LONGCHAT-API-KEY-ROTATE-IN-VENDOR-CONSOLE";
process.env.LLM_BASE_URL = "https://api.longcat.chat/openai";
process.env.LLM_MODEL = "LongCat-2.0";
process.env.AGENT_MAX_TURNS = "4";

import assert from "node:assert/strict";
import { runWorkflow } from "../dist/workflow/dag.js";

console.log("=== Regression: original test-workflow.mjs scenario ===");

const r = await runWorkflow([
  { id: "calc1", label: "Compute 2^10", task: "用 calculator 计算 2 的 10 次方，结果是多少？", timeout: 60 },
  { id: "calc2", label: "Compute 100/4", task: "用 calculator 计算 100 除以 4 的结果。", timeout: 60 },
  { id: "summarize", label: "Summarize", task: "把前面两步的算术结果用一句话总结。只回答这一句话。", dependsOn: ["calc1","calc2"], timeout: 60 },
]);

console.log("success:", r.success, "totalMs:", r.totalDurationMs);
for (const s of r.steps) {
  console.log("  [" + s.id + "]", s.error ? "FAIL " + s.error : "OK " + s.durationMs + "ms");
  console.log("     ->", s.result.slice(0, 250));
}

const sum = r.steps.find(x => x.id === "summarize");
assert.ok(sum, "summarize step exists");
assert.ok(!sum.error, "summarize must not error");
// Pre-fix: sum.result was "由于对话中没有提供前面两步的算术结果，我无法为您总结"
// Post-fix: it must reference at least one of the prior numbers.
const mentions = ["1024", "25"].filter(n => sum.result.includes(n));
assert.ok(mentions.length >= 1, `summarize should reference at least one prior value; saw "${sum.result.slice(0,200)}"`);

console.log(`\n✓ Regression PASS — summarize references [${mentions.join(", ")}] from prior steps`);
console.log(`  (Before fix: "由于对话中没有提供前面两步的算术结果，我无法为您总结")`);
process.exit(r.success ? 0 : 1);
