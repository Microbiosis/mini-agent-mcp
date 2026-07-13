// Test runWorkflow (DAG) and deepResearch
process.env.LLM_API_KEY = "REDACTED-LONGCHAT-API-KEY-ROTATE-IN-VENDOR-CONSOLE";
process.env.LLM_BASE_URL = "https://api.longcat.chat/openai";
process.env.LLM_MODEL = "LongCat-2.0";
process.env.AGENT_MAX_TURNS = "4";

const { runWorkflow } = await import("../dist/workflow/dag.js");
const { deepResearch } = await import("../dist/workflow/research.js");

console.log("\n=== Test 1: Workflow with dependency DAG (3 steps) ===");
const steps = [
  { id: "calc1", label: "Compute 2^10", task: "用 calculator 计算 2 的 10 次方，结果是多少？", timeout: 30 },
  { id: "calc2", label: "Compute 100/4", task: "用 calculator 计算 100 除以 4 的结果。", dependsOn: ["calc1"], timeout: 30 },
  { id: "summarize", label: "Summarize both", task: "把前面两步的算术结果用一句话总结。只回答这一句话。", dependsOn: ["calc1","calc2"], timeout: 30 },
];
try {
  const r = await runWorkflow(steps);
  console.log("success:", r.success, "| totalDurationMs:", r.totalDurationMs);
  for (const s of r.steps) {
    console.log(`  [${s.id}]${s.label?" "+s.label:""} ${s.error?"FAIL: "+s.error:"OK"} (${s.durationMs}ms)`);
    console.log(`    -> ${s.result.slice(0, 140)}`);
  }
} catch (e) {
  console.log("ERROR:", e.message);
}

console.log("\n=== Test 2: Deep Research on a simple fact ===");
try {
  const start = Date.now();
  const r = await deepResearch("什么是 FastMCP？一个开放协议？");
  console.log("subQuestions:", r.subQuestions.length);
  console.log("totalSteps:", r.totalSteps);
  console.log("durationMs:", r.durationMs, "(wall clock:", Date.now()-start, "ms)");
  console.log("\n--- Report (first 800 chars) ---");
  console.log(r.report.slice(0, 800));
} catch (e) {
  console.log("ERROR:", e.message);
}

process.exit(0);
