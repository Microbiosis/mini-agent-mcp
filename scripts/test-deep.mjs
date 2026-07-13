process.env.LLM_API_KEY = "REDACTED-LONGCHAT-API-KEY-ROTATE-IN-VENDOR-CONSOLE";
process.env.LLM_BASE_URL = "https://api.longcat.chat/openai";
process.env.LLM_MODEL = "LongCat-2.0";

const m = await import("../dist/agent/llm.js");
console.log("[config]", m.getLLMConfig && JSON.stringify(m.getLLMConfig()));
console.log("[mode]", m.getLLMMode && m.getLLMMode());

const r = await m.callLLM([{role:"user", content:"用一句话介绍 MCP（Model Context Protocol）。"}], [], "auto");
console.log("[resp]", JSON.stringify({
  content: r.content,
  error: r.error,
  errorMessage: r.errorMessage,
  finishReason: r.finishReason,
  usage: r.usage
}, null, 2));
process.exit(0);
