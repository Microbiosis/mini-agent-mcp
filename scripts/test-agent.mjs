// Test run_agent in both modes (rule + LLM)
process.env.LLM_API_KEY = "REDACTED-LONGCHAT-API-KEY-ROTATE-IN-VENDOR-CONSOLE";
process.env.LLM_BASE_URL = "https://api.longcat.chat/openai";
process.env.LLM_MODEL = "LongCat-2.0";
process.env.AGENT_MAX_TURNS = "5";

const { runAgent } = await import("../dist/agent/react.js");

console.log("\n=== Test 1: runAgent in RULE mode ===");
try {
  const r1 = await runAgent("用一句话介绍 MCP", "rule");
  console.log("success:", r1.success);
  console.log("answer:", r1.answer.slice(0, 200));
  console.log("totalSteps:", r1.totalSteps);
  console.log("llmPowered:", r1.llmPowered);
  console.log("steps:", r1.steps.length);
} catch (e) {
  console.log("ERROR:", e.message);
}

console.log("\n=== Test 2: runAgent in AUTO (LLM) mode ===");
try {
  const r2 = await runAgent("计算 15 的平方根加上 8 的值，结果保留 2 位小数。用 calculator 工具。", "auto");
  console.log("success:", r2.success);
  console.log("answer:", r2.answer.slice(0, 400));
  console.log("totalSteps:", r2.totalSteps);
  console.log("llmPowered:", r2.llmPowered);
  console.log("steps:");
  for (const [i, s] of r2.steps.entries()) {
    console.log(`  [${i}]`, JSON.stringify({thought:s.thought,action:s.action,observation:(s.observation||"").slice(0,80)}));
  }
} catch (e) {
  console.log("ERROR:", e.message);
}

process.exit(0);
