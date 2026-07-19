// Random tool input validation — checks that malformed numbers return
// structured errors instead of crashing randomBytes() / shaping logic.

import assert from "node:assert/strict";
import { randomGenTool } from "../dist/tools/random.js";

async function run(args) {
  const res = await randomGenTool.handler(args);
  assert.ok(Array.isArray(res.content) && res.content.length === 1, "expected single text block");
  if (res.isError) return { error: res.content[0].text };
  return { value: res.content[0].text };
}

const cases = [
  ["rejects length=-1", { operation: "password", length: -1 }, /integer in \[1, 1024\]/],
  ["rejects length=1.5", { operation: "password", length: 1.5 }, /integer in \[1, 1024\]/],
  ["rejects length=NaN", { operation: "password", length: Number.NaN }, /integer in \[1, 1024\]/],
  ["rejects length=Infinity", { operation: "password", length: Number.POSITIVE_INFINITY }, /integer in \[1, 1024\]/],
  ["rejects length=2000", { operation: "password", length: 2000 }, /integer in \[1, 1024\]/],
];

let pass = 0, fail = 0;
for (const [name, args, expect] of cases) {
  try {
    const out = await run(args);
    assert.match(out.error, expect, `${name} → ${JSON.stringify(out.error)}`);
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

// pick: invalid count
try {
  const out = await run({ operation: "pick", items: ["a", "b"], count: -1 });
  assert.match(out.error, /integer in \[1, 2\]/);
  console.log("  ✓ pick rejects count=-1");
  pass++;
} catch (e) {
  fail++;
  console.error(`  ✗ pick count=-1: ${e.message}`);
}

try {
  const out = await run({ operation: "pick", items: ["a", "b"], count: 1.5 });
  assert.match(out.error, /integer in \[1, 2\]/);
  console.log("  ✓ pick rejects count=1.5");
  pass++;
} catch (e) {
  fail++;
  console.error(`  ✗ pick count=1.5: ${e.message}`);
}

// Valid password / pick still work
try {
  const out = await run({ operation: "password", length: 20 });
  assert.ok(out.value && out.value.startsWith("Password (20"), "password 20-char OK");
  console.log("  ✓ password length=20 works");
  pass++;
} catch (e) {
  fail++;
  console.error(`  ✗ password 20: ${e.message}`);
}

try {
  const out = await run({ operation: "pick", items: ["a", "b", "c"], count: 2 });
  assert.ok(out.value.startsWith("Picked 2"), "pick OK");
  console.log("  ✓ pick count=2 works");
  pass++;
} catch (e) {
  fail++;
  console.error(`  ✗ pick count=2: ${e.message}`);
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
