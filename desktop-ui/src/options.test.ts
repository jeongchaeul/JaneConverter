import { describe, expect, it } from "vitest";
import { isFacebookPostLink } from "./components/converter/routeUtils";
import { parseConversionEvents } from "./components/inprogress/parser";
import {
  formatsFor,
  qualitiesFor,
  intentPresets,
  detectCategoryFromPath,
  resolutionLabel,
  videoQualityLabel,
  videoAudioBitrates,
  videoAudioBitrateLabel,
  formatBytes,
} from "./options";

describe("converter option parity", () => {
  it("keeps the legacy category format families", () => {
    expect(formatsFor("Music")).toContain("mp3");
    expect(formatsFor("Audio")).toContain("mp3");
    expect(formatsFor("Video")).toContain("mp4");
    expect(formatsFor("Video")).toContain("source");
    expect(formatsFor("Image")).toContain("png");
  });

  it("offers dedicated image formats", () => {
    expect(formatsFor("Image")).toContain("png");
    expect(qualitiesFor("png")).toEqual(["best"]);
  });

  it("keeps legacy quality controls mapped by output format", () => {
    expect(qualitiesFor("mp3")).toContain("320k");
    expect(qualitiesFor("mp4")).toContain("balanced");
    expect(qualitiesFor("mp4")[0]).toBe("original");
  });

  it("offers audio bitrates for video conversion", () => {
    expect(videoAudioBitrates).toContain("original");
    expect(videoAudioBitrates).toContain("320k");
    expect(videoAudioBitrateLabel("original")).toContain("untouched");
  });

  it("explains video quality choices in consumer language", () => {
    expect(videoQualityLabel("best")).toBe("Highest quality / least compression");
    expect(videoQualityLabel("balanced")).toBe("Balanced quality / recommended");
    expect(videoQualityLabel("small")).toBe("Smaller file / more compression / less detail");
    expect(resolutionLabel("original")).toBe("Keep original size — do not resize");
    expect(resolutionLabel("1080p")).toBe("Full HD — 1080p");
  });

  it("provides intent-based presets matching their target categories", () => {
    expect(intentPresets.length).toBeGreaterThanOrEqual(5);
    const studio = intentPresets.find((p) => p.id === "studio-master");
    expect(studio).toBeDefined();
    expect(studio?.format).toBe("wav");
    expect(studio?.bitrate).toBe("32-bit");

    const music = intentPresets.find((p) => p.id === "universal-music");
    expect(music?.format).toBe("mp3");
    expect(music?.normalize).toBe(true);

    const video = intentPresets.find((p) => p.id === "universal-video");
    expect(video?.format).toBe("mp4");
    expect(video?.bitrate).toBe("original");
    expect(video?.audioBitrate).toBe("original");
    expect(video?.useGpu).toBe(true);

    const image = intentPresets.find((p) => p.id === "lossless-image");
    expect(image?.format).toBe("png");
    expect(image?.bitrate).toBe("best");

    const preserve = intentPresets.find((p) => p.id === "preserve-quality");
    expect(preserve?.name).toBe("Preserve Quality");
    expect(preserve?.preserveQuality).toBe(true);
  });

  it("detects media category accurately from file extensions", () => {
    expect(detectCategoryFromPath("song.mp3")).toBe("Audio");
    expect(detectCategoryFromPath("audio.wav")).toBe("Audio");
    expect(detectCategoryFromPath("video.mp4")).toBe("Video");
    expect(detectCategoryFromPath("clip.mkv")).toBe("Video");
    expect(detectCategoryFromPath("photo.png")).toBe("Image");
    expect(detectCategoryFromPath("picture.webp")).toBe("Image");
    expect(detectCategoryFromPath("unknown_no_extension")).toBeNull();
  });

  it("formats file sizes cleanly across bytes, KB, MB, and GB", () => {
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(26214400)).toBe("25.0 MB");
    expect(formatBytes(1073741824)).toBe("1.0 GB");
    expect(formatBytes(2684354560)).toBe("2.5 GB");
  });

  it("identifies Facebook post and photostream links across formats", () => {
    expect(isFacebookPostLink("https://www.facebook.com/profile.php?id=61557058889808&sk=photos_by")).toBe(true);
    expect(isFacebookPostLink("https://www.facebook.com/people/artist/61557058889808/?sk=photos_by")).toBe(true);
    expect(isFacebookPostLink("https://www.facebook.com/user/photos_by")).toBe(true);
    expect(isFacebookPostLink("https://www.facebook.com/user/photos")).toBe(true);
    expect(isFacebookPostLink("https://www.facebook.com/share/p/1FfgatjfC9/")).toBe(true);
    expect(isFacebookPostLink("https://www.facebook.com/groups/123/permalink/456/")).toBe(true);
    expect(isFacebookPostLink("https://example.com/not-facebook")).toBe(false);
  });

  it("preserves source URL on single in-progress items for retry", () => {
    const testUrl = "https://www.facebook.com/profile.php?id=61557058889808&sk=photos_by";
    const parsed = parseConversionEvents(
      [{ kind: "progress", jobId: "job-1", message: "Downloading...", progress: 0.5 }],
      "Image",
      "png",
      testUrl,
      "job-1",
      true
    );
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].url).toBe(testUrl);
  });
});
