// Verify package.json and server.json share a single source of truth for
// the published version, plus that registry metadata references files
// that are actually published. Deterministic — no network required.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const server = JSON.parse(readFileSync("server.json", "utf8"));

assert.equal(pkg.version, server.version, "package.json version must equal server.json version");
assert.equal(
  pkg.version,
  server.packages[0].version,
  "package.json version must equal server.json packages[0].version"
);

for (const f of pkg.files) {
  assert.ok(existsSync(f), `package.json files entry missing: ${f}`);
}
assert.ok(pkg.bin && Object.keys(pkg.bin).length > 0, "package.json missing bin entry");
assert.ok(pkg.main, "package.json missing main entry");

console.log("✓ package.json and server.json versions are in sync");
console.log(`  version=${pkg.version}  bin=${Object.keys(pkg.bin).join(",")}  files=${pkg.files.join(",")}`);
