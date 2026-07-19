// Test deepResearch with the actual function but a small AGENT_MAX_TURNS.
// Requires LLM_API_KEY in env; otherwise skips.

if (!process.env.LLM_API_KEY) {
  console.log("[SKIP] test-deep-research3 requires LLM_API_KEY in env");
  process.exit(0);
}
process.env.LLM_BASE_URL ??= "https://api.longcat.chat/openai/v1";
process.env.LLM_MODEL ??= "LongCat-2.0";
process.env.AGENT_MAX_TURNS ??= "2";

const { deepResearch } = await import("../dist/workflow/research.js");

console.log("=== Deep Research (real function) ===");
const t0 = Date.now();
try {
  const r = await deepResearch("What is Node.js?");
  console.log(`\n[OK] duration=${r.durationMs}ms wall=${Date.now() - t0}ms subQs=${r.subQuestions.length}`);
  console.log("\n--- subQs encountered ---");
  for (const [i, sq] of r.subQuestions.entries()) {
    console.log(`  [${i}] "${sq.question.slice(0, 60)}" -> "${sq.findings.slice(0, 60)}"`);
  }
  console.log("\n--- final report ---");
  console.log(r.report);
} catch (e) {
  console.log("ERROR:", e.message, e.stack?.slice(0, 500));
  process.exit(1);
}
