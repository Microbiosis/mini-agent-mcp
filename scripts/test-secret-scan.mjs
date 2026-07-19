// Static scan to prevent credentials from being committed again.
// Fails with a clear message if anything matching the surface patterns
// of LLMS API keys is found in `src/`, `scripts/`, or tracked JSON files.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOTS = ["src", "scripts"];
const PATTERNS = [
  // The specific leaked key (rotated by the user but pattern remains —
  // any future leak of this exact shape is still picked up).
  /ak_[A-Za-z0-9]{20,}/,
  // Generic longcat-style prefixes
  /\bsk-[A-Za-z0-9-]{20,}\b/,
  // Bearer tokens in source code
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/,
];

const failures = [];

function walk(p) {
  let st;
  try {
    st = statSync(p);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const f of readdirSync(p)) walk(join(p, f));
    return;
  }
  const ext = extname(p);
  if (![".ts", ".js", ".mjs", ".json"].includes(ext)) return;
  const text = readFileSync(p, "utf8");
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m) failures.push({ file: p, hit: m[0].slice(0, 8) + "...", line: lineOf(text, m.index ?? 0) });
  }
}

function lineOf(text, idx) {
  return text.slice(0, idx).split("\n").length;
}

for (const r of ROOTS) walk(r);

if (failures.length > 0) {
  for (const f of failures) console.error(`✗ ${f.file}:${f.line}  matched ${f.hit}`);
  console.error("\nFAIL: committed credentials detected above. Rotate the affected key(s) immediately.");
  process.exit(1);
}
console.log("✓ no committed credentials detected under src/ + scripts/");
