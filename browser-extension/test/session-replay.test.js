const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const utils = require("../media-utils.js");
global.crypto = require("node:crypto").webcrypto;

function worker(rejectFinish = false) {
  const calls = [];
  const listener = { addListener() {} };
  const context = vm.createContext({
    JaneMediaUtils: utils, importScripts() {},
    chrome: { runtime: { onMessage: listener }, tabs: { onUpdated: listener, onRemoved: listener } },
    Response, Blob, Uint8Array, URL, AbortController, Date, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8"), context);
  context.bridgeRequest = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(url.endsWith("/start") ? { captureId: "capture" }
      : url.endsWith("/finish") ? rejectFinish ? { error: "Unreadable media" } : { captureCount: 1 }
      : { ok: true }), { status: rejectFinish && url.endsWith("/finish") ? 400 : 200 });
  };
  context.sendDiagnostic = async () => {};
  return { context, calls };
}

const bridge = { tab: { url: "http://127.0.0.1:1234/access/test" }, challenge: { bridgeToken: "test" } };
const fingerprint = { site: "instagram.com", kind: "image", width: 20, height: 30, surface: "story", sequenceIndex: 1 };
const payload = { pageUrl: "https://instagram.com/stories/example", mediaKind: "image", captureMode: "sequence", fingerprint, previousFingerprints: [] };

test("signed-in story replay keeps changed bytes and skips identical bytes before uploading", async () => {
  const { context, calls } = worker();
  const first = await context.uploadSessionResponse(bridge, payload, new Response("first"), "image/png", 5, Date.now() + 1000);
  assert.equal(first.captureCount, 1);
  const previous = [first.fingerprint];
  calls.length = 0;
  const repeated = await context.uploadSessionResponse(bridge, { ...payload, previousFingerprints: previous }, new Response("first"), "image/png", 5, Date.now() + 1000);
  assert.equal(repeated.duplicate, true);
  assert.equal(calls.length, 0);
  const changed = await context.uploadSessionResponse(bridge, { ...payload, previousFingerprints: previous }, new Response("other"), "image/png", 5, Date.now() + 1000);
  assert.equal(changed.captureCount, 1);
  assert.notEqual(changed.fingerprint.contentHash, first.fingerprint.contentHash);
});

test("a rejected signed-in capture aborts upload without acknowledging success", async () => {
  const { context, calls } = worker(true);
  await assert.rejects(context.uploadSessionResponse(bridge, payload, new Response("invalid"), "image/png", 7, Date.now() + 1000), /Unreadable/);
  assert.ok(calls.some((url) => url.endsWith("/abort")));
});

test("a stalled signed-in image body ends before native upload starts", async () => {
  const { context, calls } = worker();
  let cancelled = false;
  const response = { body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => { cancelled = true; } }) } };
  await assert.rejects(context.uploadSessionResponse(bridge, payload, response, "image/png", 0, Date.now() + 20), /deadline/);
  assert.equal(cancelled, true);
  assert.equal(calls.length, 0);
});
