// Pin every export subpath declared in package.json to:
//   1. exist as a real file
//   2. be importable via Node ESM package resolution
//   3. expose the documented public symbols at runtime
//
// Strategy: stage a fake `node_modules/mini-agent-mcp` under a tmpdir,
// copying only the package.json + dist/ from the project root, and
// reuse the project's existing node_modules entry for transitive deps
// by copying them only when missing from a sibling test directory.
// This proves the exact resolution path a downstream consumer would hit.

import { existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname, join, basename } from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");

const EXPORTS = {
  ".": [
    "toolManager",
    "ToolManagerImpl",
    "runAgent",
    "withRequestContext",
    "getRequestContext",
    "runWorkflowTool",
    "deepResearchTool",
    "rememberTool",
    "recallTool",
    "searchMemoriesTool",
    "memoryStatsTool",
    "extractSkillTool",
    "matchSkillTool",
    "useSkillTool",
    "listSkillsTool",
    "getInternalModuleDefinitions",
  ],
  "./agent": ["addCreateHook", "addNextHook", "clearHooks", "runAgent"],
  "./agent/llm": [
    "isSamplingAvailable",
    "isHttpAvailable",
    "getLLMMode",
    "getLLMConfig",
    "isLMAvailable",
    "callLLM",
    "setLLMSession",
    "withRequestContext",
    "getRequestContext",
  ],
  "./tools/manager": ["toolManager", "ToolManagerImpl"],
  "./tools/internal-modules": [
    "runWorkflowTool",
    "deepResearchTool",
    "rememberTool",
    "recallTool",
    "searchMemoriesTool",
    "memoryStatsTool",
    "extractSkillTool",
    "matchSkillTool",
    "useSkillTool",
    "listSkillsTool",
    "getInternalModuleDefinitions",
  ],
  "./workflow": ["runWorkflow", "deepResearch", "parseSubQuestions", "buildStepTask"],
  "./memory": ["remember", "recall", "searchMemories", "getMemoryStats", "getMemories", "clearMemories"],
  "./skill": ["extractSkill", "matchSkill", "useSkill", "listSkills", "getSkillStats"],
};

function pkgJsonExports() {
  return JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).exports;
}

let pass = 0, fail = 0;
async function it(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ── Phase 1: structural integrity of `exports` in package.json ─────────────
const declared = pkgJsonExports();
await it("package.json has `exports` block", async () => {
  assert.ok(declared && typeof declared === "object", "exports missing");
});

for (const key of Object.keys(EXPORTS)) {
  await it(`exports["${key}"] resolves to a real file`, async () => {
    const entry = declared[key];
    assert.ok(entry, `missing exports entry for "${key}"`);
    const target = entry.import || entry.default;
    assert.ok(typeof target === "string", `exports["${key}"] has no "import"`);
    const targetPath = join(pkgRoot, target);
    assert.ok(existsSync(targetPath), `exported path does not exist: ${targetPath}`);
    const dtsPath = targetPath.replace(/\.js$/, ".d.ts");
    assert.ok(existsSync(dtsPath), `missing TypeScript declaration file: ${dtsPath}`);
  });
}

// ── Phase 2: stage a fresh install + use Node ESM resolution ──────────────
//
// Use a UNIQUE staging root in tmpdir. We deliberately never write to
// `D:\Github\mini-agent-mcp` itself (other than dist/, which tsc owns).
const stagingRoot = join(os.tmpdir(), `mini-agent-mcp-exports-${process.pid}-${Date.now()}`);
const stagingNodeModules = join(stagingRoot, "node_modules");
const stagedPkg = join(stagingNodeModules, "mini-agent-mcp");

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagedPkg, { recursive: true });
mkdirSync(join(stagingRoot, ".."), { recursive: true });
writeFileSync(join(stagingRoot, "package.json"), JSON.stringify({ type: "module", name: "exports-tester" }, null, 2));

// Materialise the published subset.
cpSync(join(pkgRoot, "package.json"), join(stagedPkg, "package.json"));
cpSync(join(pkgRoot, "dist"), join(stagedPkg, "dist"), { recursive: true });

// Bring along ALL top-level node_modules entries (not just the listed
// deps), so transitive packages (openai, zod-to-json-schema, etc.) are
// resolvable from the staged dist code.
const topLevel = readdirSync(join(pkgRoot, "node_modules"));
for (const entry of topLevel) {
  if (entry.startsWith(".")) continue;
  const src = join(pkgRoot, "node_modules", entry);
  if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) continue;
  const dst = join(stagingNodeModules, entry);
  try { statSync(dst); } catch { cpSync(src, dst, { recursive: true }); }
}

for (const [spec, symbols] of Object.entries(EXPORTS)) {
  await it(`mini-agent-mcp${spec === "." ? "" : "/" + spec.slice(2)} imports + exposes symbols`, async () => {
    const target = spec === "." ? "mini-agent-mcp" : `mini-agent-mcp/${spec.slice(2)}`;
    // Per-iteration unique probe URL so Node's ESM loader doesn't return
    // a cached namespace from a previous iteration.
    const probePath = join(stagingRoot, `exports-probe-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(probePath, `import * as __m from "${target}";\nexport const __list = Object.keys(__m);\n`);
    const probeUrl = pathToFileURL(probePath).href;
    const mod = await import(probeUrl);
    const keys = new Set(mod.__list);
    for (const sym of symbols) {
      assert.ok(keys.has(sym), `missing symbol "${sym}" from "${spec}" (got keys: ${[...keys].join(", ")})`);
    }
  });
}

rmSync(stagingRoot, { recursive: true, force: true });

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
