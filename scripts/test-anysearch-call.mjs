const { getAnySearchTools } = await import("../dist/tools/anysearch.js");
const tools = await getAnySearchTools();
const searchTool = tools.find(t => t.name === "anysearch_search");
if (!searchTool) { console.log("no search tool"); process.exit(1); }

console.log("=== AnySearch live call ===");
try {
  const r = await searchTool.handler({ query: "what is Model Context Protocol", max_results: 3 });
  console.log(JSON.stringify(r, null, 2).slice(0, 2000));
} catch (e) {
  console.log("ERROR:", e.message);
}
process.exit(0);
