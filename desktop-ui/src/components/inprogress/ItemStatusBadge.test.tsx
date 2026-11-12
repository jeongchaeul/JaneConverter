import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ItemStatusBadge, formatBriefError } from "./ItemStatusBadge";
import type { InProgressItem } from "./types";

describe("formatBriefError", () => {
  it("formats unavailable and dead videos", () => {
    expect(formatBriefError("ERROR: [youtube] lmjDIUDNyDE: This video is not available")).toBe("Failed: Unavailable");
    expect(formatBriefError("Video is dead or unavailable on YouTube")).toBe("Failed: Unavailable");
    expect(formatBriefError("No matching streams returned from search")).toBe("Failed: Unavailable");
  });

  it("formats 403 Forbidden errors", () => {
    expect(formatBriefError("unable to download video data: HTTP Error 403: Forbidden")).toBe("Failed: 403 Forbidden");
    expect(formatBriefError("YouTube CDN stream forbidden (HTTP 403 - token expired)")).toBe("Failed: 403 Forbidden");
  });

  it("formats private videos", () => {
    expect(formatBriefError("Private video: Sign in to view if you are allowed")).toBe("Failed: Private Video");
  });

  it("formats bot verification challenges", () => {
    expect(formatBriefError("Sign in to confirm you're not a bot")).toBe("Failed: Bot Challenge");
  });

  it("formats region blocking", () => {
    expect(formatBriefError("This video is not available in your country")).toBe("Failed: Region Blocked");
  });

  it("formats network timeouts", () => {
    expect(formatBriefError("Connection timed out after 30s")).toBe("Failed: Network Error");
  });

  it("defaults to Failed for unknown errors or undefined", () => {
    expect(formatBriefError(undefined)).toBe("Failed");
    expect(formatBriefError("Unexpected parsing exception")).toBe("Failed");
  });
});

describe("ItemStatusBadge rendering", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renders brief failure reason directly on the badge", async () => {
    const item: InProgressItem = {
      id: "test-1",
      index: 1,
      total: 10,
      title: "Can't Understand",
      mediaKind: "audio",
      status: "failed",
      progress: 0,
      errorMessage: "ERROR: [youtube] lmjDIUDNyDE: This video is not available",
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<ItemStatusBadge item={item} />);
    });

    expect(container.textContent).toContain("Failed: Unavailable");
    const badge = container.querySelector("[title]");
    expect(badge?.getAttribute("title")).toBe("ERROR: [youtube] lmjDIUDNyDE: This video is not available");
  });

  it("renders 403 Forbidden brief reason", async () => {
    const item: InProgressItem = {
      id: "test-2",
      index: 2,
      total: 10,
      title: "pop shi _",
      mediaKind: "audio",
      status: "failed",
      progress: 0,
      errorMessage: "HTTP Error 403: Forbidden",
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<ItemStatusBadge item={item} />);
    });

    expect(container.textContent).toContain("Failed: 403 Forbidden");
  });

  it("does not display transcode x-speed under Downloading status", async () => {
    const item: InProgressItem = {
      id: "test-3",
      index: 3,
      total: 10,
      title: "Shaboozey - A Bar Song",
      mediaKind: "audio",
      status: "downloading",
      progress: 0.75,
      speed: "74.9x",
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<ItemStatusBadge item={item} />);
    });

    expect(container.textContent).toContain("Downloading 75%");
    expect(container.textContent).not.toContain("74.9x");
  });
});
