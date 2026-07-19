// Test memory + skill + tool manager. **No LLM required.**
//
// Persisted under $MINI_AGENT_DATA_DIR (defaulting to the package's
// .mini-agent/) so it never writes into the host working directory.

import { remember, recall, getMemoryStats } from "../dist/memory/index.js";
import { extractSkill, matchSkill, listSkills, getSkillStats } from "../dist/skill/index.js";
import { toolManager } from "../dist/tools/manager.js";

console.log("=== Memory System ===");
console.log("\n[before] stats:", JSON.stringify(getMemoryStats()));

const t1 = "user-prefers-cli";
const t2 = "project-mcp";
remember("fact", "用户喜欢用 CLI 而不是 GUI 工具", [t1, "style"]);
remember("fact", "mini-agent-mcp 是 Microbiosis 维护的项目", [t2, "fact"]);
remember("task", "完成 MCP 智能体测试", [t2, "todo"]);
remember("preference", "默认 LLM = LongCat-2.0", [t1, "config"]);
remember("conversation", "本地 MCP server 有 12 个注册工具", [t2]);

console.log("\n[after] stats:", JSON.stringify(getMemoryStats()));

console.log("\n[recall t1]", recall([t1]).map((m) => `[${m.type}] ${m.content.slice(0, 80)}`).join("\n           "));
console.log(
  "\n[recall t2 (limit 2)]",
  recall([t2], 2).map((m) => `[${m.type}] ${m.content.slice(0, 80)}`).join("\n                       ")
);
console.log("\n[recall missing]", recall(["never-existed"]));

console.log("\n=== Skill System ===");
console.log("\n[before] stats:", JSON.stringify(getSkillStats()));

extractSkill(
  "test-skill-calc",
  "When user asks to compute, use calculator tool directly",
  "计算 5 阶乘",
  ["Parse the math expression", "Call calculator with the expression", "Return the numeric result"],
  ["math", "calculate", "compute", "算", "计算"]
);

extractSkill(
  "test-skill-summary",
  "Summarize long articles into 3 bullets",
  "总结这段长文",
  ["Read full text", "Extract key points", "Format as bullets"],
  ["summary", "summarize", "总结"]
);

console.log("\n[after] stats:", JSON.stringify(getSkillStats()));
console.log("\n[match calc task]", matchSkill("我想计算 100 的阶乘")?.name || "(no match)");
console.log("\n[match summary task]", matchSkill("帮我总结下这段文字")?.name || "(no match)");
console.log("\n[match nothing]", matchSkill("play minecraft")?.name || "(no match)");

console.log("\n[list skills]");
for (const s of listSkills()) console.log(`  - ${s.name} (used ${s.useCount}x): ${s.description}`);

console.log("\n=== ToolManager stats ===");
console.log("Total tools:", toolManager.size);
console.log("Names:", toolManager.list().map((t) => t.name).join(", "));
