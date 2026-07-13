// Test deepResearch with the actual function but force short timeout per agent call
process.env.LLM_API_KEY = "REDACTED-LONGCHAT-API-KEY-ROTATE-IN-VENDOR-CONSOLE";
process.env.LLM_BASE_URL = "https://api.longcat.chat/openai";
process.env.LLM_MODEL = "LongCat-2.0";
process.env.AGENT_MAX_TURNS = "2"; // minimize per-call thinking

const { deepResearch } = await import("../dist/workflow/research.js");

console.log("=== Deep Research (real function) ===");
const t0 = Date.now();
try {
  const r = await deepResearch("What is Node.js?");
  console.log(`\n[OK] duration=${r.durationMs}ms wall=${Date.now()-t0}ms subQs=${r.subQuestions.length}`);
  console.log("\n--- subQs encountered ---");
  for (const [i, sq] of r.subQuestions.entries()) {
    console.log(`  [${i}] "${sq.question.slice(0,60)}" -> "${sq.findings.slice(0,60)}"`);
  }
  console.log("\n--- final report ---");
  console.log(r.report);
} catch (e) {
  console.log("ERROR:", e.message, e.stack?.slice(0,500));
}
process.exit(0);
