const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchBounded, sameStoryFingerprint, requireCompatibleBridge, withDeadline } = require("../media-utils.js");

test("a stalled browser API cannot keep sequence capture waiting indefinitely", async () => {
  await assert.rejects(withDeadline(new Promise(() => {}), 20), /deadline reached/);
});

test("incompatible application and extension versions require an explicit update", () => {
  assert.throws(() => requireCompatibleBridge({ protocolVersion: 1 }), /matching compatibility/);
  assert.throws(() => requireCompatibleBridge({}), /matching compatibility/);
  assert.doesNotThrow(() => requireCompatibleBridge({ protocolVersion: 2 }));
});

test("a response with immediate headers and stalled body still times out", async () => {
  const original = global.fetch;
  let cancelled = false;
  global.fetch = async () => ({ headers: new Headers(), body: { getReader: () => ({
    read: () => new Promise(() => {}), cancel: async () => { cancelled = true; }
  }) } });
  try {
    await assert.rejects(fetchBounded("https://example.test/media", {}, 20, 1024), /timed out/);
    assert.equal(cancelled, true);
  } finally { global.fetch = original; }
});

test("streamed bodies cannot exceed their byte budget without content-length", async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(new Uint8Array(2048));
  try {
    await assert.rejects(fetchBounded("https://example.test/media", {}, 1000, 1024), /byte limit/);
  } finally { global.fetch = original; }
});

test("identical perceptual hashes cannot discard different content", () => {
  const first = { site: "test", kind: "image", visualHash: "0000000000000000505050", contentHash: "a".repeat(64) };
  assert.equal(sameStoryFingerprint(first, { ...first, contentHash: "b".repeat(64) }), false);
});
