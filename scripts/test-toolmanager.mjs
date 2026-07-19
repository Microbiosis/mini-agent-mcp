// ToolManager unit tests — exercised without any real tool handler so we
// can assert concurrency / timeout / serial-queue semantics in isolation.

import assert from "node:assert/strict";
import { ToolManagerImpl } from "../dist/tools/manager.js";

function make(name, timeoutMs, concurrencySafe, execFn) {
  return { name, description: "", timeoutMs, concurrencySafe, execute: execFn };
}

let pass = 0, fail = 0;
function it(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`  ✓ ${name}`); })
    .catch((e) => { fail++; console.error(`  ✗ ${name}: ${e.message}`); });
}

(async () => {
  // Per-tool serial queue
  await it("serializes concurrencySafe:false calls", async () => {
    process.env.TOOL_RETRY_COUNT = "0";
    const tm = new ToolManagerImpl();
    let active = 0, peak = 0;
    tm.register(
      make("serial-tool", 5000, false, async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 50));
        active--;
        return "ok";
      })
    );
    const results = await Promise.all([tm.execute("serial-tool", {}), tm.execute("serial-tool", {}), tm.execute("serial-tool", {})]);
    assert.equal(peak, 1, `expected peak=1 but was ${peak}`);
    assert.deepEqual(results, ["ok", "ok", "ok"]);
  });

  // Concurrency Safe: should allow parallel
  await it("allows concurrencySafe:true to overlap", async () => {
    const tm = new ToolManagerImpl();
    let active = 0, peak = 0;
    tm.register(
      make("parallel-tool", 5000, true, async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 30));
        active--;
        return "ok";
      })
    );
    await Promise.all([tm.execute("parallel-tool", {}), tm.execute("parallel-tool", {}), tm.execute("parallel-tool", {})]);
    assert.ok(peak > 1, `expected overlap > 1 but was ${peak}`);
  });

  // Timeout does NOT silently retry
  await it("timeout does not auto-retry", async () => {
    const tm = new ToolManagerImpl();
    let calls = 0;
    tm.register(
      make("slow-tool", 80, true, async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 500));
        return "should-not-reach";
      })
    );
    const out = await tm.execute("slow-tool", {});
    assert.match(out, /timed out after 80ms/);
    assert.equal(calls, 1, `expected 1 execution but was ${calls}`);
  });

  // Guardrail returns string immediately
  await it("guardrail short-circuits before execute", async () => {
    const tm = new ToolManagerImpl();
    let called = false;
    tm.register(
      make("gr-tool", 5000, true, async () => {
        called = true;
        return "ok";
      })
    );
    const big = "x".repeat(11_000);
    const out = await tm.execute("gr-tool", { text: big });
    assert.match(out, /Guardrail/);
    assert.equal(called, false);
  });

  // History records entries
  await it("records history with error flag", async () => {
    const tm = new ToolManagerImpl();
    tm.register(make("h1", 5000, true, async () => "ok"));
    tm.register(make("h2", 80, true, async () => {
      await new Promise((r) => setTimeout(r, 500));
      return "ok";
    }));
    await tm.execute("h1", { a: 1 });
    await tm.execute("h2", {});
    const hist = tm.getHistory(10);
    assert.equal(hist.length, 2);
    // getHistory returns most-recent-first; index 0 is the timeout call.
    assert.equal(hist[0].toolName, "h2");
    assert.equal(hist[0].error, true);
    assert.equal(hist[1].toolName, "h1");
    assert.equal(hist[1].error, false);
  });

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
