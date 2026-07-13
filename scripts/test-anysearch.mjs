const { getAnySearchTools } = await import("../dist/tools/anysearch.js");
try {
  const tools = await getAnySearchTools();
  console.log("[OK] anysearch tools loaded:", tools.length);
  for (const t of tools) console.log(`  - ${t.name}: ${t.description?.slice(0,80)}`);
} catch (e) {
  console.log("[ERROR]", e.message);
}
process.exit(0);
