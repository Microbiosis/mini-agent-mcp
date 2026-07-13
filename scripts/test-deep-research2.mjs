// Direct sub-question injection — bypass slow decompose
process.env.LLM_API_KEY = "REDACTED-LONGCHAT-API-KEY-ROTATE-IN-VENDOR-CONSOLE";
process.env.LLM_BASE_URL = "https://api.longcat.chat/openai";
process.env.LLM_MODEL = "LongCat-2.0";
process.env.AGENT_MAX_TURNS = "4";

// Bypass the planner - directly drive deepResearch with known good input
const { runAgent } = await import("../dist/agent/react.js");

console.log("=== mini Deep Research: decompose then synthesize ===");
const t0 = Date.now();

// Manually replicate deepResearch with 1 sub-question for speed
const question = "FastMCP 是 Node.js 上的什么库？";
console.log("[step1] decompose...");
const decomp = await runAgent(`Break down this question into 1-2 specific sub-questions, each starting with "- ":\nQuestion: "${question}"`, "auto");
console.log(`  took ${Date.now()-t0}ms`);
const subs = decomp.answer.split("\n").map(l => l.replace(/^-\s*/,"").trim()).filter(l => l.length > 5);
console.log("  subQs:", subs);

const findings = [];
for (const sq of subs) {
  const s = Date.now();
  console.log(`[step2.${sq.slice(0,30)}] research...`);
  const r = await runAgent(`Answer this briefly in 2 bullets: ${sq}`, "auto");
  console.log(`  took ${Date.now()-s}ms`);
  findings.push({q: sq, f: r.answer});
}

console.log("\n[step3] synthesize...");
const fs = Date.now();
const synth = await runAgent(
  `Write a short Markdown report (3 bullets max) answering:\n"${question}"\n\nFindings:\n${findings.map(f => `## ${f.q}\n${f.f}`).join("\n\n")}`,
  "auto"
);
console.log(`  took ${Date.now()-fs}ms`);
console.log("\n--- final report ---");
console.log(synth.answer);
console.log("\nTOTAL:", Date.now()-t0, "ms");
process.exit(0);
