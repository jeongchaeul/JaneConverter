import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { expect, test } from "vitest";

const candidatePaths = [
  resolve(process.cwd(), "src-tauri/scripts/social_photo_capture.js"),
  resolve(process.cwd(), "desktop-ui/src-tauri/scripts/social_photo_capture.js"),
  resolve(process.cwd(), "src-tauri/src/social_photo_capture.rs"),
  resolve(process.cwd(), "desktop-ui/src-tauri/src/social_photo_capture.rs"),
];
const scriptPath = candidatePaths.find(existsSync) ?? candidatePaths[0];
const rawContent = readFileSync(scriptPath, "utf8");
let script;
if (scriptPath.endsWith(".js")) {
  script = rawContent
    .replace("__NONCE_JSON__", '"fixture"')
    .replace("__PLATFORM_JSON__", '"twitter"')
    .replace("__TARGET_URL_JSON__", '"https://x.com/jane/status/123"');
} else {
  const start = rawContent.indexOf('r#"(() => {{');
  script = rawContent.slice(start + 3, rawContent.indexOf('"#', start))
    .replace("{nonce_json}", '"fixture"')
    .replace("{platform_json}", '"twitter"')
    .replace("{target_url_json}", '"https://x.com/jane/status/123"')
    .replaceAll("{{", "{").replaceAll("}}", "}");
}

async function replay(expected, declaredUrl = "https://x.com/jane/status/123") {
  const metadata = expected === null ? "" : `<script type="application/ld+json">${JSON.stringify({ "@type": "SocialMediaPosting", url: declaredUrl, image: Array(expected).fill("https://pbs.twimg.com/media/a.jpg") })}</script>`;
  const dom = new JSDOM(`<title>Original post title</title>${metadata}<article><a href="/jane/status/123">post</a><img src="https://pbs.twimg.com/media/a.jpg"></article>`, { url: "https://x.com/jane/status/123", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  const image = w.document.querySelector("img");
  image.getBoundingClientRect = () => ({ width: 600, height: 600, top: 0, left: 0, bottom: 600, right: 600 });
  Object.defineProperty(image, "naturalWidth", { value: 1200 });
  Object.defineProperty(image, "naturalHeight", { value: 1200 });
  let callbacks = [];
  w.setTimeout = (callback) => { callbacks.push(callback); return callbacks.length; };
  w.eval(script);
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  let message;
  for (let tick = 0; tick < 20; tick++) {
    const next = callbacks.splice(0);
    next.forEach((callback) => callback());
    await Promise.resolve();
    if (w.document.title.startsWith("__JANE_SOCIAL_PHOTO_CAPTURE__fixture__")) {
      message = JSON.parse(Buffer.from(w.document.title.split("__fixture__")[1], "base64url").toString());
      if (message.kind === "photos") w.__JANE_SOCIAL_PHOTO_ACK__fixture = message.sequence;
      if (message.kind === "done") break;
    }
  }
  dom.window.close();
  return message;
}

test("a quiet page with one of two declared photos is incomplete", async () => {
  expect(await replay(2)).toMatchObject({ kind: "done", count: 1, expectedCount: 2, completion: "incomplete", endConfirmed: false });
});
test("acknowledged photos and an exact post count can prove completion", async () => {
  expect(await replay(1)).toMatchObject({ kind: "done", count: 1, expectedCount: 1, completion: "complete", title: "Original post title" });
});
test("recommendation counts cannot certify this post", async () => {
  expect(await replay(1, "https://x.com/other/status/456")).toMatchObject({ kind: "done", completion: "unknown" });
  expect(await replay(null)).toMatchObject({ kind: "done", completion: "unknown" });
});
