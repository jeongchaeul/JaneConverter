import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, expect, test } from "vitest";

const rust = readFileSync(resolve(process.cwd(), "src-tauri/src/facebook_capture.rs"), "utf8");
const start = rust.indexOf('r#"(() => {{');
const end = rust.indexOf('"#', start);
const captureScript = rust.slice(start + 3, end)
  .replace("{nonce_json}", '"fixture"')
  .replaceAll("{{", "{")
  .replaceAll("}}", "}")
  .replaceAll("location.replace(target.href);", "window.__JANE_NAVIGATE__(target.href);");
const prefix = "__JANE_FACEBOOK_CAPTURE__fixture__";

function replay(html, path, mode = "") {
  const dom = new JSDOM(html, {
    url: `https://www.facebook.com${path}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.__JANE_NAVIGATE__ = (href) => window.history.replaceState({}, "", href);
  Object.defineProperty(window.document.documentElement, "scrollHeight", { value: 768 });
  window.scrollTo = () => {};
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  class ReplayDate extends window.Date {
    static now() { return now; }
  }
  window.Date = ReplayDate;
  window.TextEncoder = TextEncoder;
  window.setTimeout = (callback, delay = 0) => {
    const id = ++timerId;
    timers.set(id, { at: now + delay, callback, repeat: 0 });
    return id;
  };
  window.setInterval = (callback, delay = 0) => {
    const id = ++timerId;
    timers.set(id, { at: now + delay, callback, repeat: delay });
    return id;
  };
  if (mode) window.sessionStorage.setItem("janeFacebookCaptureMode", mode);
  window.eval(captureScript);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

  async function advance(milliseconds) {
    const until = now + milliseconds;
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      now = next[1].at;
      timers.delete(next[0]);
      if (next[1].repeat) {
        timers.set(next[0], { ...next[1], at: now + next[1].repeat });
      }
      next[1].callback();
      await Promise.resolve();
    }
    now = until;
  }

  function message() {
    const title = window.document.title;
    if (!title.startsWith(prefix)) return null;
    return JSON.parse(Buffer.from(title.slice(prefix.length), "base64url").toString("utf8"));
  }
  return { window, advance, message, close: () => dom.window.close() };
}

const sessions = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
});

test("sanitized video post routes to the existing extractor", async () => {
  const html = readFileSync(resolve(process.cwd(), "test/fixtures/facebook-video.html"), "utf8");
  const session = replay(html, "/share/p/sample/");
  sessions.push(session);
  await session.advance(2600);
  expect(session.message()).toMatchObject({ kind: "video", title: "Public sample video" });
});

test("sanitized photo grid waits for batch acknowledgments and end evidence", async () => {
  const html = readFileSync(resolve(process.cwd(), "test/fixtures/facebook-grid.html"), "utf8");
  const session = replay(html, "/media/set/?set=pcb.999999", "grid");
  sessions.push(session);
  await session.advance(150);
  expect(session.message()).toMatchObject({ kind: "photos", sequence: 1 });
  await session.advance(1000);
  expect(session.message()).toMatchObject({ kind: "photos", sequence: 1 });
  session.window.__JANE_FACEBOOK_ACK__fixture = 1;
  await session.advance(1100);
  expect(session.message()).toMatchObject({ kind: "photos", sequence: 2 });
  session.window.__JANE_FACEBOOK_ACK__fixture = 2;
  await session.advance(5000);
  expect(session.message()).toMatchObject({
    kind: "done", count: 3, expectedCount: 3,
    countSource: "page-count", endConfirmed: true, countConflict: false,
  });
});

test("conflicting album counts never declare completion", async () => {
  const base = readFileSync(resolve(process.cwd(), "test/fixtures/facebook-grid.html"), "utf8");
  const html = base.replace("</head>", '<meta property="og:description" content="Photo 1 of 4"></head>');
  const session = replay(html, "/media/set/?set=pcb.999999", "grid");
  sessions.push(session);
  await session.advance(150);
  session.window.__JANE_FACEBOOK_ACK__fixture = 1;
  await session.advance(1100);
  session.window.__JANE_FACEBOOK_ACK__fixture = 2;
  await session.advance(6000);
  expect(session.window.sessionStorage.getItem("janeFacebookCountConflict")).toBe("true");
  expect(session.message()?.kind).not.toBe("done");
});

test("sign-in redirect fails without publishing a partial album", async () => {
  const session = replay("<!doctype html><html><head><title>Log in</title></head><body></body></html>", "/login/", "grid");
  sessions.push(session);
  await session.advance(150);
  expect(session.message()).toMatchObject({ kind: "error" });
  expect(session.message().error).toMatch(/sign-in page/);
});

test("dynamic page changes trigger another scan before the safety interval", async () => {
  const session = replay("<!doctype html><html><head><title>Dynamic public post</title></head><body><main></main></body></html>", "/share/p/sample/");
  sessions.push(session);
  await session.advance(150);
  const video = session.window.document.createElement("video");
  video.poster = "https://scontent.fbcdn.net/preview.jpg";
  video.getBoundingClientRect = () => ({ width: 640, height: 360 });
  session.window.document.querySelector("main").append(video);
  await Promise.resolve();
  await session.advance(1100);
  expect(session.message()).toMatchObject({ kind: "video", title: "Dynamic public post" });
});

test("rendition refresh reads the requested photo again in the same guest page", async () => {
  const html = readFileSync(resolve(process.cwd(), "test/fixtures/facebook-grid.html"), "utf8");
  const session = replay(html, "/media/set/?set=pcb.999999", "grid");
  sessions.push(session);
  await session.advance(150);

  const requestId = "0123456789abcdef0123456789abcdef";
  expect(session.window.__JANE_FACEBOOK_REFRESH__fixture(requestId, "111111")).toBe(true);
  expect(JSON.parse(session.window.sessionStorage.getItem("janeFacebookPendingRenditionRefresh")))
    .toEqual({ requestId, photoId: "111111" });

  const image = session.window.document.createElement("img");
  image.src = "https://scontent.fbcdn.net/refreshed.jpg";
  Object.defineProperty(image, "complete", { value: true });
  Object.defineProperty(image, "naturalWidth", { value: 1200 });
  image.getBoundingClientRect = () => ({ width: 640, height: 480 });
  session.window.document.body.append(image);
  await session.advance(300);

  expect(session.message()).toMatchObject({
    kind: "refresh",
    requestId,
    photos: [{ id: "111111", url: "https://scontent.fbcdn.net/refreshed.jpg" }],
  });
});
