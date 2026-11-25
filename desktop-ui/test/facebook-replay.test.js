import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, expect, test } from "vitest";

const candidatePaths = [
  resolve(process.cwd(), "src-tauri/scripts/facebook_capture.js"),
  resolve(process.cwd(), "desktop-ui/src-tauri/scripts/facebook_capture.js"),
  resolve(process.cwd(), "src-tauri/src/facebook_capture.rs"),
  resolve(process.cwd(), "desktop-ui/src-tauri/src/facebook_capture.rs"),
];
const scriptPath = candidatePaths.find(existsSync) ?? candidatePaths[0];
const rawContent = readFileSync(scriptPath, "utf8");
let captureScript;
if (scriptPath.endsWith(".js")) {
  captureScript = rawContent
    .replace("__NONCE_JSON__", '"fixture"')
    .replaceAll("location.replace(target.href);", "window.__JANE_NAVIGATE__(target.href);")
    .replaceAll("location.replace(startPhoto.url);", "window.__JANE_NAVIGATE__(startPhoto.url);")
    .replaceAll("location.replace(nextPhotoUrl);", "window.__JANE_NAVIGATE__(nextPhotoUrl);");
} else {
  const start = rawContent.indexOf('r#"(() => {{');
  const end = rawContent.indexOf('"#', start);
  captureScript = rawContent.slice(start + 3, end)
    .replace("{nonce_json}", '"fixture"')
    .replaceAll("{{", "{")
    .replaceAll("}}", "}")
    .replaceAll("location.replace(target.href);", "window.__JANE_NAVIGATE__(target.href);")
    .replaceAll("location.replace(startPhoto.url);", "window.__JANE_NAVIGATE__(startPhoto.url);")
    .replaceAll("location.replace(nextPhotoUrl);", "window.__JANE_NAVIGATE__(nextPhotoUrl);");
}
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
  Object.defineProperty(image, "naturalHeight", { value: 900 });
  image.getBoundingClientRect = () => ({ width: 640, height: 480 });
  session.window.document.body.append(image);
  await session.advance(300);

  expect(session.message()).toMatchObject({
    kind: "refresh",
    requestId,
    photos: [{ id: "111111", url: "https://scontent.fbcdn.net/refreshed.jpg" }],
  });
});

test("public group permalink navigates directly to photo viewer and walks currMedia JSON", async () => {
  const groupHtml = `<!doctype html><html><head><title>Public Group Post</title></head><body>
    <script type="application/json">{"mediaset_token":"pcb.1846379669854104","all_subattachments":{"count":2,"nodes":[{"media":{"__typename":"Photo","id":"111111111"}},{"media":{"__typename":"Photo","id":"222222222"}}]}}</script>
  </body></html>`;
  const session = replay(groupHtml, "/groups/678282096663873/permalink/1846379669854104/");
  sessions.push(session);
  await session.advance(150);

  expect(session.window.location.pathname).toBe("/photo/");
  expect(session.window.location.search).toBe("?fbid=111111111&set=pcb.1846379669854104");
  expect(session.window.sessionStorage.getItem("janeFacebookCaptureMode")).toBe("viewer");

  const viewer1Html = `<!doctype html><html><head><title>Public Group Post</title></head><body>
    <script type="application/json">{"currMedia":{"__typename":"Photo","container_story":{"id":"story1","nested":{"a":1}},"__isNode":"Photo","id":"111111111","image":{"uri":"https:\\/\\/scontent.fbcdn.net\\/photo1.jpg","width":1080,"height":1080},"creation_story":{"id":"story2","deep":{"b":2}},"nextMediaAfterNodeId":{"__typename":"Photo","id":"222222222"}}}</script>
  </body></html>`;
  const viewer1 = replay(viewer1Html, "/photo/?fbid=111111111&set=pcb.1846379669854104", "viewer");
  sessions.push(viewer1);
  viewer1.window.sessionStorage.setItem("janeFacebookExpectedCount", "2");
  viewer1.window.sessionStorage.setItem("janeFacebookAlbumSet", "pcb.1846379669854104");
  await viewer1.advance(150);

  expect(viewer1.message()).toMatchObject({
    kind: "photos",
    sequence: 1,
    photos: [{ id: "111111111", url: "https://scontent.fbcdn.net/photo1.jpg" }],
  });
  viewer1.window.__JANE_FACEBOOK_ACK__fixture = 1;
  await viewer1.advance(350);
  expect(viewer1.window.location.search).toBe("?fbid=222222222&set=pcb.1846379669854104");
});
test("direct photo viewer landing from redirected share link transitions to viewer and completes", async () => {
  const viewerHtml = `<!doctype html><html><head><title>Single Photo Post</title></head><body>
    <script type="application/json">{"currMedia":{"__typename":"Photo","id":"3761044804047089","image":{"uri":"https:\\/\\/scontent.fbcdn.net\\/photo_single.jpg","width":1040,"height":2048}}}</script>
  </body></html>`;
  const viewer = replay(viewerHtml, "/photo/?fbid=3761044804047089&set=a.105543729597233");
  sessions.push(viewer);
  await viewer.advance(150);

  expect(viewer.window.sessionStorage.getItem("janeFacebookCaptureMode")).toBe("viewer");
  await viewer.advance(350);

  expect(viewer.message()).toMatchObject({
    kind: "photos",
    sequence: 1,
    photos: [{ id: "3761044804047089", url: "https://scontent.fbcdn.net/photo_single.jpg" }],
  });
  viewer.window.__JANE_FACEBOOK_ACK__fixture = 1;
  await viewer.advance(3000);

  expect(viewer.message()).toMatchObject({
    kind: "done",
    count: 1,
    expectedCount: 1,
    endConfirmed: true,
    countConflict: false,
  });
});

test("single photo post navigates to viewer and completes with single photo", async () => {
  const singlePhotoHtml = `<!doctype html><html><head><title>Single Photo Post</title></head><body>
    <script type="application/json">{"attachment":{"media":{"__typename":"Photo","id":"987654321","image":{"uri":"https:\\/\\/scontent.fbcdn.net\\/photo_single.jpg","width":1040,"height":2048}}}}</script>
  </body></html>`;
  const session = replay(singlePhotoHtml, "/share/p/1FfgatjfC9/");
  sessions.push(session);
  await session.advance(150);

  expect(session.window.location.pathname).toBe("/photo/");
  expect(session.window.location.search).toBe("?fbid=987654321");
  expect(session.window.sessionStorage.getItem("janeFacebookCaptureMode")).toBe("viewer");

  const viewerHtml = `<!doctype html><html><head><title>Single Photo Post</title></head><body>
    <script type="application/json">{"currMedia":{"__typename":"Photo","id":"987654321","image":{"uri":"https:\\/\\/scontent.fbcdn.net\\/photo_single.jpg","width":1040,"height":2048}}}</script>
  </body></html>`;
  const viewer = replay(viewerHtml, "/photo/?fbid=987654321", "viewer");
  sessions.push(viewer);
  viewer.window.sessionStorage.setItem("janeFacebookExpectedCount", "1");
  await viewer.advance(350);

  expect(viewer.message()).toMatchObject({
    kind: "photos",
    sequence: 1,
    photos: [{ id: "987654321", url: "https://scontent.fbcdn.net/photo_single.jpg" }],
  });
  viewer.window.__JANE_FACEBOOK_ACK__fixture = 1;
  await viewer.advance(3000);

  expect(viewer.message()).toMatchObject({
    kind: "done",
    count: 1,
    expectedCount: 1,
    endConfirmed: true,
    countConflict: false,
  });
});


test("profile photostream enters grid mode and captures uncategorized photos", async () => {
  const profileHtml = `<!doctype html><html><head><title>Artist Profile - Facebook</title></head><body>
    <div role="main">
      <a href="https://www.facebook.com/photo/?fbid=888111222&set=pb.61557058889808.-2207520000"><img src="https://scontent.fbcdn.net/p1.jpg"></a>
      <a href="https://www.facebook.com/photo/?fbid=888333444&set=pb.61557058889808.-2207520000"><img src="https://scontent.fbcdn.net/p2.jpg"></a>
    </div>
  </body></html>`;
  const session = replay(profileHtml, "/profile.php?id=61557058889808&sk=photos_by");
  sessions.push(session);
  await session.advance(150);
  expect(session.window.sessionStorage.getItem("janeFacebookCaptureMode")).toBe("grid");

  await session.advance(350);
  expect(session.message()).toMatchObject({
    kind: "photos",
    sequence: 1,
    photos: [
      { id: "888111222", url: "https://scontent.fbcdn.net/p1.jpg" },
      { id: "888333444", url: "https://scontent.fbcdn.net/p2.jpg" },
    ],
  });
  session.window.__JANE_FACEBOOK_ACK__fixture = 1;
  await session.advance(5000);

  expect(session.message()).toMatchObject({
    kind: "done",
    count: 2,
    countSource: "grid-end",
    endConfirmed: true,
  });
});

test("single-photo page permalink strips parent set=a. album, ignores comment photos, and stops after 1 photo", async () => {
  const permalinkHtml = `<!doctype html><html><head><title>Spicy Gimbap II - Post | Facebook</title></head><body>
    <div role="article">
      <a href="https://www.facebook.com/photo/?fbid=1463914419286187&set=a.1400784518932511&__tn__=EH-R">
        <img src="https://scontent.fbcdn.net/thumb_main.jpg">
      </a>
      <a href="https://www.facebook.com/photo.php?fbid=3274205172919118&set=p.3274205172919118&type=3&comment_id=949038901475734">
        <img src="https://scontent.fbcdn.net/comment_photo.jpg">
      </a>
    </div>
  </body></html>`;
  const session = replay(permalinkHtml, "/permalink.php?story_fbid=pfbid0QVWSe&id=100070029286462");
  sessions.push(session);
  await session.advance(150);

  expect(session.window.location.pathname).toBe("/photo/");
  expect(session.window.location.search).toBe("?fbid=1463914419286187");
  expect(session.window.sessionStorage.getItem("janeFacebookCaptureMode")).toBe("viewer");
  expect(session.window.sessionStorage.getItem("janeFacebookSinglePhotoId")).toBe("1463914419286187");
  expect(session.window.sessionStorage.getItem("janeFacebookAlbumSet")).toBeNull();
  expect(session.window.sessionStorage.getItem("janeFacebookExpectedPhotoCount")).toBe("1");

  const viewerHtml = `<!doctype html><html><head><title>Facebook</title></head><body>
    <a href="https://www.facebook.com/photo/?fbid=1462863632724599" aria-label="Next photo">Next photo</a>
    <script type="application/json">{"currMedia":{"__typename":"Photo","id":"1463914419286187","image":{"uri":"https:\\/\\/scontent.fbcdn.net\\/full_main.jpg","width":1529,"height":2048}},"nextMediaAfterNodeId":{"__typename":"Photo","id":"1462863632724599"}}</script>
  </body></html>`;
  const viewer = replay(viewerHtml, "/photo/?fbid=1463914419286187", "viewer");
  sessions.push(viewer);
  viewer.window.sessionStorage.setItem("janeFacebookSinglePhotoId", "1463914419286187");
  viewer.window.sessionStorage.setItem("janeFacebookExpectedPhotoCount", "1");
  viewer.window.sessionStorage.setItem("janeFacebookCountSource", "post-single");
  await viewer.advance(350);

  expect(viewer.message()).toMatchObject({
    kind: "photos",
    sequence: 1,
    photos: [{ id: "1463914419286187", url: "https://scontent.fbcdn.net/full_main.jpg" }],
  });
  viewer.window.__JANE_FACEBOOK_ACK__fixture = 1;
  await viewer.advance(350);

  expect(viewer.window.location.search).toBe("?fbid=1463914419286187");
  expect(viewer.message()).toMatchObject({
    kind: "done",
    count: 1,
    expectedCount: 1,
    countSource: "viewer-end",
    endConfirmed: true,
    countConflict: false,
  });
});

test("stale capture nonce resets previous sessionStorage keys and ACK wakes next scan quickly", async () => {
  const html = readFileSync(resolve(process.cwd(), "test/fixtures/facebook-grid.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "https://www.facebook.com/media/set/?set=pcb.999999",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.sessionStorage.setItem("janeFacebookCaptureNonce", "old-nonce-from-previous-run");
  window.sessionStorage.setItem("janeFacebookScannedPhotoIds", JSON.stringify(["999999999"]));
  window.sessionStorage.setItem("janeFacebookExpectedPhotoCount", "99");
  window.sessionStorage.setItem("janeFacebookCaptureMode", "viewer");
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
  const advance = async (milliseconds) => {
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
  };
  const readMsg = () => {
    const title = window.document.title;
    if (!title.startsWith(prefix)) return null;
    return JSON.parse(Buffer.from(title.slice(prefix.length), "base64url").toString("utf8"));
  };

  try {
    window.eval(captureScript);
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

    expect(window.sessionStorage.getItem("janeFacebookCaptureNonce")).toBe("fixture");
    expect(window.sessionStorage.getItem("janeFacebookScannedPhotoIds")).toBeNull();

    await advance(150);
    expect(window.sessionStorage.getItem("janeFacebookCaptureMode")).toBe("grid");

    await advance(260);
    expect(readMsg()).toMatchObject({ kind: "photos", sequence: 1, expectedCount: 3 });

    window.__JANE_FACEBOOK_ACK__fixture = 1;
    await advance(25);
    expect(readMsg()).toMatchObject({ kind: "photos", sequence: 2, expectedCount: 3 });
  } finally {
    dom.window.close();
  }
});
