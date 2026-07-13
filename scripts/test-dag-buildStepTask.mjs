// Unit tests for buildStepTask — pure string transform, no LLM.
// Run with: node scripts/test-dag-buildStepTask.mjs
import assert from "node:assert/strict";
import { buildStepTask } from "../dist/workflow/dag.js";

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

console.log("buildStepTask — unit tests");

// 1. No deps — passthrough
run("step without dependsOn returns task unchanged", () => {
  const completed = new Map();
  const task = buildStepTask({ id: "a", task: "compute x" }, completed);
  assert.equal(task, "compute x");
});

// 2. Single dep — append context
run("step with single dep injects answer", () => {
  const completed = new Map([["calc1", "1024"]]);
  const task = buildStepTask(
    { id: "summarize", task: "summarize prior results", dependsOn: ["calc1"] },
    completed,
  );
  assert.ok(task.startsWith("summarize prior results"), "task prefix");
  assert.ok(task.includes("---"), "separator");
  assert.ok(task.includes("Results from previous steps:"), "label");
  assert.ok(task.includes("[calc1]"), "id block");
  assert.ok(task.includes("1024"), "answer injected");
});

// 3. Multiple deps
run("step with 2 deps injects both answers in order", () => {
  const completed = new Map([
    ["calc1", "1024"],
    ["calc2", "25"],
  ]);
  const task = buildStepTask(
    { id: "summarize", task: "summarize everything", dependsOn: ["calc1", "calc2"] },
    completed,
  );
  const idx1 = task.indexOf("[calc1]");
  const idx2 = task.indexOf("[calc2]");
  assert.ok(idx1 > -1 && idx2 > -1, "both deps present");
  assert.ok(idx1 < idx2, "deps in declared order");
  assert.ok(task.includes("1024"), "calc1 answer");
  assert.ok(task.includes("25"), "calc2 answer");
});

// 4. Dep listed but not in completed (should not crash, no block for it)
run("missing dep is silently skipped", () => {
  const completed = new Map([["calc1", "1024"]]);
  const task = buildStepTask(
    { id: "s", task: "go", dependsOn: ["calc1", "ghost"] },
    completed,
  );
  assert.ok(task.includes("1024"));
  assert.ok(!task.includes("[ghost]"), "missing dep not rendered");
});

// 5. Dep with empty/blank answer
run("dep with empty string is still rendered (preserves trace)", () => {
  const completed = new Map([["a", ""], ["b", ""]]);
  const task = buildStepTask({ id: "s", task: "go", dependsOn: ["a", "b"] }, completed);
  // Both ids listed, but answer body empty.
  assert.ok(task.includes("[a]"));
  assert.ok(task.includes("[b]"));
});

// 6. Whitespace answer is trimmed visually by runAgent, but buildStepTask preserves verbatim
run("multiline answer preserved verbatim", () => {
  const completed = new Map([["calc1", "line1\nline2\nline3"]]);
  const task = buildStepTask({ id: "s", task: "go", dependsOn: ["calc1"] }, completed);
  assert.ok(task.includes("line1\nline2\nline3"));
});

// 7. dependsOn: [] (explicit empty array) — same as no deps
run("dependsOn=[] behaves as no deps", () => {
  const completed = new Map([["a", "1024"]]);
  const task = buildStepTask({ id: "s", task: "go", dependsOn: [] }, completed);
  assert.equal(task, "go");
});

// 8. Special chars in answer survive transport
run("answer with backticks / quotes / newlines is intact", () => {
  const tricky = 'Result: `code` "quoted" end';
  const completed = new Map([["a", tricky]]);
  const task = buildStepTask({ id: "s", task: "go", dependsOn: ["a"] }, completed);
  assert.ok(task.includes(tricky), "answer preserved exactly");
});

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
