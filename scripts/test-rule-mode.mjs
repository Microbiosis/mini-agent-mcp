// runRuleBasedAgent should:
//  - Route all tool calls through ToolManager (so history is recorded)
//  - Honor tool allowlist (silently skip tools not in the list)

import assert from "node:assert/strict";
import { toolManager } from "../dist/tools/manager.js";
import { calculatorTool } from "../dist/tools/calculator.js";
import { runAgent } from "../dist/agent/react.js";

// Test setup: register a real calculator tool so runViaManager finds it.
toolManager.register({
  name: calculatorTool.name,
  description: calculatorTool.description,
  timeoutMs: 5_000,
  concurrencySafe: true,
  execute: async (args) => {
    const r = await calculatorTool.handler(args);
    return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  },
});

const before = toolManager.getHistory(10);

const r = await runAgent("calculate 7 * 6", "rule", undefined, {
  toolAllowlist: ["calculator"],
});

assert.equal(r.llmPowered, false, "rule mode should not invoke LLM");
assert.ok(r.steps.length > 0, "rule mode should produce at least one step");
console.log("  ✓ rule mode produced output");

const after = toolManager.getHistory(100);
assert.ok(after.length > before.length, `expected at least one new history entry; before=${before.length} after=${after.length}`);
console.log("  ✓ rule mode recorded tool(s) in ToolManager history");

// Tools not in allowlist should never be attempted
const offending = after.find((h) => h.toolName === "datetime_info" || h.toolName === "random_gen");
assert.equal(offending, undefined, `unexpected tool call recorded: ${offending?.toolName}`);
console.log("  ✓ rule mode respected tool allowlist");

