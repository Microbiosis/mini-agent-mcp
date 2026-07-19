// Smoke test for deepResearch.
//
// Requires LLM_API_KEY in env; otherwise the script SKIPs without touching
// any upstream. Run with `node scripts/test-deep-research.mjs`.

if (!process.env.LLM_API_KEY) {
  console.log("[SKIP] test-deep-research requires LLM_API_KEY in env");
  process.exit(0);
}
process.env.LLM_BASE_URL ??= "https://api.longcat.chat/openai/v1";
process.env.LLM_MODEL ??= "LongCat-2.0";
process.env.AGENT_MAX_TURNS ??= "3";

const { deepResearch } = await import("../dist/workflow/research.js");

console.log("=== Deep Research (no real search) ===");
console.log("Starting... " + new Date().toISOString());
const t0 = Date.now();
try {
  const r = await deepResearch("什么是 FastMCP 库？它的用途是什么？");
  console.log(`\n[OK] duration=${r.durationMs}ms (wall ${Date.now()-t0}ms) subQs=${r.subQuestions.length} steps=${r.totalSteps}`);
  for (const [i, sq] of r.subQuestions.entries()) {
    console.log(`\n--- subQ ${i + 1}: ${sq.question.slice(0, 80)}`);
    console.log(`    answer: ${sq.findings.slice(0, 150)}`);
  }
  console.log("\n--- report (first 1500 chars) ---");
  console.log(r.report.slice(0, 1500));
} catch (e) {
  console.log("ERROR:", e.message);
  process.exit(1);
}
