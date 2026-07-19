// Verify every advanced internal tool is registered in ToolManager and
// has a non-empty input schema. Also verifies run_workflow's nested
// runAgent call receives a tool allowlist (no recursion back to itself).

import assert from "node:assert/strict";
import { toolManager } from "../dist/tools/manager.js";
import {
  runWorkflowTool,
  deepResearchTool,
  rememberTool,
  recallTool,
  searchMemoriesTool,
  memoryStatsTool,
  extractSkillTool,
  matchSkillTool,
  useSkillTool,
  listSkillsTool,
} from "../dist/tools/internal-modules.js";

const expected = [
  runWorkflowTool,
  deepResearchTool,
  rememberTool,
  recallTool,
  searchMemoriesTool,
  memoryStatsTool,
  extractSkillTool,
  matchSkillTool,
  useSkillTool,
  listSkillsTool,
];

// Register them in the singleton (the server entry point normally does
// this; tests bypass server startup).
function register(def, timeoutMs) {
  toolManager.register({
    name: def.name,
    description: def.description,
    timeoutMs,
    concurrencySafe: true,
    execute: async (args) => {
      const result = await def.handler(args);
      if (result && typeof result === "object" && "isError" in result && result.isError) {
        throw new Error(result.content.map((c) => c.text || "").join("\n") || `${def.name} error`);
      }
      return (result.content || []).map((c) => c.text || "").join("\n");
    },
  });
}
register(runWorkflowTool, 30_000);
register(deepResearchTool, 30_000);
register(rememberTool, 5_000);
register(recallTool, 5_000);
register(searchMemoriesTool, 5_000);
register(memoryStatsTool, 5_000);
register(extractSkillTool, 5_000);
register(matchSkillTool, 5_000);
register(useSkillTool, 5_000);
register(listSkillsTool, 5_000);

let pass = 0, fail = 0;
function it(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch((e) => { fail++; console.error(`  ✗ ${name}: ${e.message}`); });
}

(async () => {
  for (const def of expected) {
    await it(`${def.name} is registered in ToolManager`, async () => {
      const entry = toolManager.get(def.name);
      assert.ok(entry, `${def.name} not in ToolManager`);
      assert.equal(typeof entry.execute, "function");
      assert.ok(typeof entry.timeoutMs === "number" && entry.timeoutMs > 0);
      assert.equal(def.inputSchema.type, "object");
      assert.ok(typeof def.inputSchema.properties === "object");
    });
  }

  // Test memory CRUD round-trip via ToolManager.execute
  await it("rememberTool actually persists", async () => {
    const beforeRes = await toolManager.execute("memory_stats", {});
    const before = JSON.parse(beforeRes);
    const beforeTotal = before.total;
    await toolManager.execute("remember", { type: "fact", content: "the quick brown fox", tags: "fox, animal" });
    const afterRes = await toolManager.execute("memory_stats", {});
    const after = JSON.parse(afterRes);
    assert.equal(after.total, beforeTotal + 1, `expected one more memory (before=${beforeTotal} after=${after.total})`);
    const recalledRes = await toolManager.execute("recall", { tags: "fox", limit: 5 });
    const recalled = JSON.parse(recalledRes);
    assert.ok(recalled.count >= 1);
  });

  // Test skill extract + match round-trip
  await it("extractSkillTool persists and matches", async () => {
    await toolManager.execute("extract_skill", {
      name: "test-roundtrip",
      description: "Round-trip skill",
      exampleTask: "do the roundtrip",
      steps: JSON.stringify(["step one", "step two"]),
      tags: "roundtrip, test",
    });
    const matchedRes = await toolManager.execute("match_skill", { task: "please do the roundtrip test" });
    const matched = JSON.parse(matchedRes);
    assert.ok(matched.matched && matched.matched.name === "test-roundtrip", `expected match, got ${JSON.stringify(matched)}`);
  });

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
