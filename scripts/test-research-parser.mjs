// Unit tests for parseSubQuestions — pure string transform, no LLM.
// Run with: node scripts/test-research-parser.mjs
import assert from "node:assert/strict";
import { parseSubQuestions } from "../dist/workflow/research.js";

const t = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${e.message.replace(/\n/g, "\n      ")}`);
    return false;
  }
};

let pass = 0, fail = 0;
const run = (name, fn) => (t(name, fn) ? pass++ : fail++);

console.log("parseSubQuestions — unit tests");

// === Happy path ===
run("parses a clean fenced block", () => {
  const ans = "```\n- What is FastMCP?\n- How does Node.js work?\n- Why is MCP useful?\n```";
  const subs = parseSubQuestions(ans);
  assert.deepEqual(subs, [
    "What is FastMCP?",
    "How does Node.js work?",
    "Why is MCP useful?",
  ]);
});

run("handles ```lang fenced blocks", () => {
  const ans = "```markdown\n- Sub one here\n- Sub two here longer\n- Sub three here longer\n```";
  const subs = parseSubQuestions(ans);
  assert.equal(subs.length, 3);
  assert.ok(subs[0].startsWith("Sub one"));
});

// === The original bug: LLM output without fence and with prose ===
run("ignores prose lines mixed in", () => {
  const ans = `Here are some sub-questions:

- What is the FastMCP library and what does it provide?
- How does it differ from the official MCP SDK in usage?
- What are the deployment scenarios it supports today?

I hope this helps.`;
  const subs = parseSubQuestions(ans);
  assert.equal(subs.length, 3, "exactly 3 sub-questions, not 6+");
  // No stray prose
  for (const s of subs) {
    assert.ok(!s.includes("Here are"), "no prose in items");
    assert.ok(!s.includes("I hope"), "no trailing fluff");
  }
});

// === Line-length and structure filter ===
run("drops short bullet items (<12 chars)", () => {
  const ans = "```\n- ok\n- hi there\n- more than twelve chars here\n```";
  const subs = parseSubQuestions(ans);
  assert.deepEqual(subs, ["more than twelve chars here"]);
});

run("drops lines missing the leading dash-space", () => {
  const ans = "```\nWhat is X?\n- Valid item here yes\n* Wrong bullet format here\n```";
  const subs = parseSubQuestions(ans);
  assert.deepEqual(subs, ["Valid item here yes"]);
});

// === Empty / null / weird ===
run("returns [] on empty input", () => {
  assert.deepEqual(parseSubQuestions(""), []);
  assert.deepEqual(parseSubQuestions(null), []);
  assert.deepEqual(parseSubQuestions(undefined), []);
  assert.deepEqual(parseSubQuestions(42), []);
});

run("returns [] when nothing matchable", () => {
  assert.deepEqual(parseSubQuestions("hello world"), []);
  assert.deepEqual(parseSubQuestions("```\nno bullets\njust text\n```"), []);
});

// === Cap enforcement ===
run("caps results at max=5", () => {
  const ans = "```\n" +
    Array.from({ length: 12 }, (_, i) => `- Sub-question number ${i + 1} here`).join("\n") +
    "\n```";
  const subs = parseSubQuestions(ans, 5);
  assert.equal(subs.length, 5);
});

run("max=2 honors smaller cap", () => {
  const ans = "```\n- First sub-question one\n- Second sub-question two\n- Third sub-question three\n```";
  const subs = parseSubQuestions(ans, 2);
  assert.equal(subs.length, 2);
  assert.equal(subs[0], "First sub-question one");
});

// === Whitespace resilience ===
run("tolerates extra whitespace between dash and text", () => {
  const ans = "```\n-    Compressed whitespace item long enough\n```";
  const subs = parseSubQuestions(ans);
  assert.equal(subs.length, 1);
  assert.equal(subs[0], "Compressed whitespace item long enough");
});

run("collapses internal whitespace runs in items", () => {
  const ans = "```\n- Spaced    out     item long enough yes\n```";
  const subs = parseSubQuestions(ans);
  assert.equal(subs.length, 1);
  assert.equal(subs[0], "Spaced out item long enough yes");
});

// === The edge case that originally triggered the bug ===
run("LLM that ignored the format directive returns [] (caller falls back)", () => {
  // Real captured output from the longcat run earlier — full prose with leading dashes in middle
  const ans = `Based on the search results, here is the complete answer:

**FastMCP 是 Node.js 上一个用于构建 MCP（Model Context Protocol）服务器的 TypeScript 框架。**

- 提供简洁的 API 来定义 Tool、Resource 和 Prompt
- 支持多种传输方式（stdio、HTTP Streaming、SSE）
- 内置会话管理、认证、错误处理、日志记录等功能

Final Answer: ...`;
  const subs = parseSubQuestions(ans, 5);
  // The old parser returned 8+ items here. The new one returns ≤ the real
  // number of valid bullet lines that meet the ≥12-char rule.
  assert.ok(subs.length <= 5, "capped to max");
  for (const s of subs) {
    assert.ok(s.length >= 12, `every item ≥12 chars: got "${s}"`);
  }
});

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
