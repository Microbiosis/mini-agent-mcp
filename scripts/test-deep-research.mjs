// Test Deep Research with proper output buffering + memory + skill
process.env.LLM_API_KEY = "REDACTED-LONGCHAT-API-KEY-ROTATE-IN-VENDOR-CONSOLE";
process.env.LLM_BASE_URL = "https://api.longcat.chat/openai";
process.env.LLM_MODEL = "LongCat-2.0";
process.env.AGENT_MAX_TURNS = "3";

// Pre-flush stdout
const origLog = console.log;
console.log = (...a) => { origLog(...a); if (process.stdout.write) process.stdout.write(""); };

const { deepResearch } = await import("../dist/workflow/research.js");

console.log("=== Deep Research (no real search) ===");
console.log("Starting... " + new Date().toISOString());
const t0 = Date.now();
try {
  const r = await deepResearch("什么是 FastMCP 库？它的用途是什么？");
  console.log(`\n[OK] duration=${r.durationMs}ms (wall ${Date.now()-t0}ms) subQs=${r.subQuestions.length} steps=${r.totalSteps}`);
  for (const [i, sq] of r.subQuestions.entries()) {
    console.log(`\n--- subQ ${i+1}: ${sq.question.slice(0,80)}`);
    console.log(`    answer: ${sq.findings.slice(0,150)}`);
  }
  console.log("\n--- report (first 1500 chars) ---");
  console.log(r.report.slice(0, 1500));
} catch (e) {
  console.log("ERROR:", e.message);
}
process.exit(0);
