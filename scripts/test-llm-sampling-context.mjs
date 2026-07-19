// Verify that when a sampling-capable session is supplied via
// AsyncLocalStorage, `isSamplingAvailable()` returns true and a custom
// `requestSampling` implementation is what gets called.

import assert from "node:assert/strict";
import { withRequestContext, getRequestContext, isSamplingAvailable, callLLM } from "../dist/agent/llm.js";

let captured = null;
const fakeSession = {
  requestSampling: async (msg, opts) => {
    captured = { msg, opts };
    return { content: { type: "text", text: "fake-llm-answer" }, model: "fake", role: "assistant" };
  },
};

const result = await withRequestContext(
  {
    session: fakeSession,
    clientSupportsSampling: true,
    sessionId: "test-session",
    requestId: "rid-1",
  },
  async () => {
    assert.equal(isSamplingAvailable(), true, "isSamplingAvailable() should be true inside the context");
    const ctx = getRequestContext();
    assert.equal(ctx.sessionId, "test-session");
    const r = await callLLM([{ role: "user", content: "hello" }], undefined, "auto");
    return r;
  }
);

assert.deepEqual(captured.msg.messages.map((m) => m.content.text), ["hello"]);
assert.equal(captured.opts.timeout, 120_000);
assert.equal(result.content, "fake-llm-answer");
assert.equal(result.finishReason, "stop");
console.log("  ✓ requestSampling dispatched with captured timeout + content");
