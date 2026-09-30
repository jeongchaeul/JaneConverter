const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanStore, layoutKey, preferredStrategy, recordOutcome } = require("../adaptation.js");

test("story adaptation stores only a structural site and layout key", () => {
  const key = layoutKey("https://www.example.test/stories/private?token=secret", {
    storyCandidate: true, mediaKind: "image", surface: "0:0:12:21",
    width: 1080, height: 1920, mediaUrl: "https://cdn.test/photo?token=secret"
  });
  assert.equal(key, "www.example.test|image|0:0:12:21|8x15");
  const stored = recordOutcome(null, key, "rendered", true, 1000);
  assert.equal(preferredStrategy(stored, key, 1001), "rendered");
  assert.doesNotMatch(JSON.stringify(stored), /secret|private|cdn\.test|token/);
  assert.equal(layoutKey("https://example.test/", { mediaKind: "image", surface: "0:0:12:21" }), null);
});

test("failed methods lose preference, stale entries expire, and invalid storage is discarded", () => {
  const key = "example.test|video|0:0:12:21|8x15";
  let stored = recordOutcome(null, key, "session-fetch", true, 1000);
  stored = recordOutcome(stored, key, "session-fetch", false, 1001);
  assert.equal(preferredStrategy(stored, key, 1002), null);
  stored = recordOutcome(stored, key, "rendered", true, 1003);
  assert.equal(preferredStrategy(stored, key, 1004), "rendered");
  assert.equal(preferredStrategy(stored, key, 15 * 24 * 60 * 60 * 1000), null);
  assert.deepEqual(cleanStore({ version: 1, entries: [
    { key: "example.test/private?token=secret", strategy: "rendered", successes: 1, failures: 0, updatedAt: 1000 }
  ] }, 1001).entries, []);
  assert.deepEqual(recordOutcome(null, "example.test/private?token=secret", "rendered", true, 1000).entries, []);
});
