const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classify,
  isSocialMediaImage,
  isStreamSegment,
  isAllowedSessionMediaUrl,
  isExpectedMediaResponse,
  networkCaptureDisposition,
  networkMediaCandidate,
  normalizeMediaUrl,
  sameStoryFingerprint,
  sessionPlatformForPage,
  selectCaptureItems,
  visualHashFromPixels
} = require("../media-utils.js");

test("classifies CDN video responses even when the URL has no video extension", () => {
  assert.equal(
    classify("https://video-cdn.example/media?id=story-1", "video/mp4"),
    "video"
  );
});

test("normalizes Facebook-style byte-range URLs to one canonical media URL", () => {
  const result = normalizeMediaUrl(
    "https://scontent.example/video.mp4?bytestart=0&byteend=1048575&token=abc"
  );

  assert.equal(result.wasRanged, true);
  assert.equal(result.url, "https://scontent.example/video.mp4?token=abc");
});

test("exact content identifies repeated bytes despite rotated CDN URLs", () => {
  const pixels = new Uint8Array(9 * 8 * 4);
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      const offset = (row * 9 + column) * 4;
      pixels.fill(column * 20, offset, offset + 3);
      pixels[offset + 3] = 255;
    }
  }
  const hash = visualHashFromPixels(pixels);
  assert.equal(hash, "0000000000000000505050");
  const first = {
    site: "example.test", kind: "image", width: 1080, height: 1920,
    surface: "0:0:12:21", duration: 0, sequenceIndex: null,
    contentHash: "a".repeat(64), visualHash: hash, url: "https://cdn.example.test/one.jpg?token=old"
  };
  assert.equal(sameStoryFingerprint(first, { ...first, url: "https://cdn.example.test/two.jpg?token=new" }), true);
  assert.equal(sameStoryFingerprint(first, { ...first, contentHash: "b".repeat(64), visualHash: "ffffffffffffffff505050" }), false);
  assert.equal(sameStoryFingerprint(first, { ...first, contentHash: "b".repeat(64), visualHash: "0000000000000000ffffff" }), false);
  assert.equal(sameStoryFingerprint(first, { ...first, surface: "1:0:12:21" }), false);
  assert.equal(sameStoryFingerprint(first, { ...first, sequenceIndex: 2 }), true);
  assert.equal(sameStoryFingerprint({ ...first, sequenceIndex: 1 }, { ...first, sequenceIndex: 2 }), false);
});

test("URL equality alone cannot discard a mutable story", () => {
  const first = {
    site: "example.test", kind: "video", width: 720, height: 1280,
    surface: "0:0:12:21", duration: 12, sequenceIndex: null,
    visualHash: null, url: "https://cdn.example.test/one.mp4?token=old"
  };
  assert.equal(sameStoryFingerprint(first, { ...first, url: "https://cdn.example.test/two.mp4?token=new" }), false);
  assert.equal(sameStoryFingerprint(first, { ...first, url: first.url }), false);
  assert.equal(sameStoryFingerprint(first, { ...first, duration: 13 }), false);
});

test("rejects stream fragments and social thumbnails as capture candidates", () => {
  assert.equal(isStreamSegment("https://cdn.example/segment-12.m4s", "video/iso.segment"), true);
  assert.equal(isSocialMediaImage("https://scontent.fbcdn.net/v/t1.6435-9/p320x320/photo.jpg"), true);
  assert.equal(classify("https://cdn.example/stream.m3u8", "application/vnd.apple.mpegurl"), "stream");
});

test("selects the visible playing item for one-click capture and filters adaptive streams", () => {
  const selected = selectCaptureItems([
    { mediaUrl: "https://cdn.example/stream.m3u8", mediaKind: "video", captureable: false },
    { mediaUrl: "blob:https://example.test/1", mediaKind: "video", playing: true, visible: true },
    { mediaUrl: "https://cdn.example/preview.mp4", mediaKind: "video", visible: false }
  ], "current", 24);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].mediaUrl, "blob:https://example.test/1");
});
test("keeps story sequences focused on story surfaces instead of social thumbnails", () => {
  const selected = selectCaptureItems([
    {
      mediaUrl: "https://scontent.fbcdn.net/profile-small.jpg",
      mediaKind: "image",
      source: "page-network",
      visible: true,
      storyCandidate: false
    },
    {
      mediaUrl: "https://scontent.fbcdn.net/story-one.jpg",
      mediaKind: "image",
      source: "page-dom",
      visible: true,
      storyCandidate: true,
      surfaceScore: 900
    },
    {
      mediaUrl: "https://scontent.fbcdn.net/story-two.jpg",
      mediaKind: "image",
      source: "page-dom",
      visible: true,
      storyCandidate: true,
      surfaceScore: 800
    },
    {
      mediaUrl: "https://scontent.fbcdn.net/story-list-avatar.jpg",
      mediaKind: "image",
      source: "page-dom",
      visible: true,
      storyCandidate: false,
      surfaceScore: 20
    }
  ], "sequence", 24);

  assert.deepEqual(selected.map((item) => item.mediaUrl), [
    "https://scontent.fbcdn.net/story-one.jpg",
    "https://scontent.fbcdn.net/story-two.jpg"
  ]);
});

test("allows a direct story image as a fallback when no page surface is available", () => {
  const selected = selectCaptureItems([
    {
      mediaUrl: "https://cdn.example/story-image.jpg",
      mediaKind: "image",
      source: "page-network",
      storyCandidate: true,
      captureable: true
    }
  ], "current", 24);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].mediaUrl, "https://cdn.example/story-image.jpg");
});

test("allows only registered HTTPS media hosts for authenticated browser fetches", () => {
  assert.equal(sessionPlatformForPage("https://www.facebook.com/stories/123").id, "facebook");
  assert.equal(isAllowedSessionMediaUrl("https://www.facebook.com/stories/123", "https://scontent.fhan2-4.fna.fbcdn.net/v/t42.1/video.mp4"), true);
  assert.equal(isAllowedSessionMediaUrl("https://www.facebook.com/stories/123", "https://evil.example/private.mp4"), false);
  assert.equal(isAllowedSessionMediaUrl("https://www.facebook.com/stories/123", "http://scontent.fhan2-4.fna.fbcdn.net/video.mp4"), false);
});

test("requires the browser response to be actual media of the requested kind", () => {
  assert.equal(isExpectedMediaResponse("video", "video/mp4; charset=binary"), true);
  assert.equal(isExpectedMediaResponse("image", "image/jpeg"), true);
  assert.equal(isExpectedMediaResponse("video", "text/html"), false);
  assert.equal(isExpectedMediaResponse("audio", "video/mp4"), false);
});

test("accepts allowlisted network media and rejects adaptive manifests", () => {
  assert.deepEqual(
    networkMediaCandidate(
      "https://scontent.fhan2-4.fna.fbcdn.net/video.mp4?token=temporary",
      "video/mp4",
      "Media"
    ),
    { accepted: true, mediaKind: "video", contentType: "video/mp4" }
  );
  assert.equal(
    networkMediaCandidate(
      "https://scontent.fhan2-4.fna.fbcdn.net/story.m3u8",
      "application/vnd.apple.mpegurl",
      "Media"
    ).accepted,
    false
  );
});

test("discards tiny network assets that are likely avatars or interface chrome", () => {
  assert.equal(networkCaptureDisposition("image", 7 * 1024).accepted, false);
  assert.equal(networkCaptureDisposition("image", 8 * 1024).accepted, true);
  assert.equal(networkCaptureDisposition("video", 31 * 1024).accepted, false);
  assert.equal(networkCaptureDisposition("video", 32 * 1024).accepted, true);
});
