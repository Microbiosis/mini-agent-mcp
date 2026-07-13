#!/usr/bin/env node
/**
 * Probe the MCP server over stdio using JSON-RPC and list all registered tools.
 * This is the same protocol the MCP client uses, so it tells us exactly which
 * tools the running server is exposing.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = "D:/Github/mini-agent-mcp";
const serverPath = resolve(repoRoot, "dist/index.js");

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: repoRoot,
  env: { ...process.env },
  windowsHide: true,
});

let stdoutBuf = "";
let stderrBuf = "";
child.stdout.on("data", (d) => {
  stdoutBuf += d.toString("utf8");
});
child.stderr.on("data", (d) => {
  stderrBuf += d.toString("utf8");
  process.stderr.write(`[server stderr] ${d.toString("utf8")}`);
});

function send(msg) {
  const payload = JSON.stringify(msg) + "\n";
  child.stdin.write(payload);
}

let id = 0;
const pending = new Map();

function handleLine(line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve: r, reject: j } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) j(new Error(JSON.stringify(msg.error)));
    else r(msg.result);
  }
}

// Wait for headers (Content-Length: ... or just raw JSON)
function waitForResponse(id) {
  return new Promise((resolveP, rejectP) => {
    pending.set(id, { resolve: resolveP, reject: rejectP });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rejectP(new Error("timeout"));
      }
    }, 15000);
  });
}

// The server speaks "newline-delimited JSON" if --sse not used (stdio transport)
let buffered = "";
const splitter = setInterval(() => {
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const l of lines) handleLine(l);
}, 50);

child.stdout.on("data", (d) => { buffered += d.toString("utf8"); });

// MCP handshake
const initId = ++id;
send({
  jsonrpc: "2.0",
  id: initId,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "0.0.1" },
  },
});

try {
  await waitForResponse(initId);
  console.log("✅ initialize OK");
} catch (e) {
  console.error("❌ initialize failed:", e.message);
  child.kill();
  process.exit(1);
}

send({ jsonrpc: "2.0", method: "notifications/initialized" });

const listId = ++id;
send({ jsonrpc: "2.0", id: listId, method: "tools/list", params: {} });

try {
  const result = await waitForResponse(listId);
  const tools = result.tools ?? [];
  console.log(`\n📦 Registered tools: ${tools.length}\n`);
  for (const t of tools) {
    console.log(`  - ${t.name}`);
  }
  console.log("");
  const expected = [
    "calculator", "text_stats", "text_transform", "unit_convert",
    "datetime_info", "random_gen",
    "run_agent", "run_workflow", "deep_research",
    "remember", "recall", "memory_stats",
    "extract_skill", "list_skills",
  ];
  console.log("🔍 Coverage check:");
  for (const name of expected) {
    const ok = tools.some((t) => t.name === name);
    console.log(`  ${ok ? "✅" : "❌"} ${name}`);
  }
} catch (e) {
  console.error("❌ tools/list failed:", e.message);
}

clearInterval(splitter);
child.kill();
process.exit(0);