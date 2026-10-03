const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("collect mode is wired as a persistent extension feature", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.background.service_worker, "extension-worker.js");
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("debugger"));
  assert.match(read("popup.html"), /id="collect"/);
  assert.match(read("popup.js"), /janeCollectTabs/);
  assert.match(read("popup.js"), /files: \["media-utils\.js", "collect\.js"\]/);
  assert.match(read("service-worker.js"), /jane-collect-media/);
  assert.match(read("service-worker.js"), /captureMode: "collect"/);
  assert.match(read("collect.js"), /MediaRecorder/);
  assert.match(read("collect.js"), /canvas\.toBlob/);
  assert.match(read("collect.js"), /isPrimary/);
});

test("collect mode skips a repeated image after its CDN URL changes", async () => {
  const uploads = [];
  let control;
  let tick;
  const image = {
    tagName: "IMG", src: "https://cdn.example/first.jpg?token=old",
    naturalWidth: 1080, naturalHeight: 1920, width: 400, height: 700,
    pattern: 1,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 700, width: 400, height: 700 }),
    querySelector: () => null,
    closest: () => null
  };
  const document = {
    title: "Story", documentElement: {},
    querySelectorAll: (selector) => selector === "video, img, canvas" ? [image] : [],
    createElement: () => {
      const canvas = { width: 0, height: 0, pattern: 1 };
      canvas.getContext = () => ({
        drawImage: (source) => { canvas.pattern = source.pattern; },
        getImageData: () => {
          const pixels = new Uint8Array(9 * 8 * 4);
          for (let row = 0; row < 8; row += 1) {
            for (let column = 0; column < 9; column += 1) {
              const value = canvas.pattern === 1 ? column * 20 : (8 - column) * 20;
              pixels.fill(value, (row * 9 + column) * 4, (row * 9 + column) * 4 + 3);
            }
          }
          return { data: pixels };
        }
      });
      canvas.toBlob = (callback) => callback(new Blob([String(canvas.pattern)], { type: "image/png" }));
      return canvas;
    }
  };
  const context = {
    crypto: require("node:crypto").webcrypto, setTimeout, clearTimeout,
    window: {}, document, location: { href: "https://example.test/stories", hostname: "example.test" },
    innerWidth: 1200, innerHeight: 900, Uint8Array, Blob, btoa,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
    chrome: { runtime: {
      lastError: null,
      onMessage: { addListener: (callback) => { control = callback; } },
      sendMessage: (message, callback) => {
        if (message.type === "jane-collect-media") uploads.push(message.payload);
        if (callback) callback({ ok: true });
      }
    } }
  };
  vm.runInNewContext(read("media-utils.js"), context);
  vm.runInNewContext(read("collect.js"), context);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  control({ type: "jane-collect-control", enabled: true }, null, () => {});
  await settle();
  assert.equal(uploads.length, 1);

  image.src = "https://cdn.example/second.jpg?token=new";
  tick();
  await settle();
  assert.equal(uploads.length, 1);

  image.pattern = 2;
  image.src = "https://cdn.example/third.jpg?token=other";
  tick();
  await settle();
  assert.equal(uploads.length, 2);
  // Changed bytes can share a perceptual hash and a reused CDN URL.
  image.pattern = 3;
  tick();
  await settle();
  assert.equal(uploads.length, 3);
});
