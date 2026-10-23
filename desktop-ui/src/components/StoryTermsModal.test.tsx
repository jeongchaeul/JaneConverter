import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { StoryTermsModal } from "./StoryTermsModal";
import { ConverterView, isEphemeralStoryUrl } from "./ConverterView";
import { SettingsView } from "./SettingsView";
import type { AccessStatus, ConverterSettings, RuntimeInfo } from "../bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dummySettings: ConverterSettings = {
  outputDir: "converted",
  fetchedDir: "fetched",
  category: "Music",
  format: "mp3",
  bitrate: "320k",
  sampleRate: 48000,
  resolution: "original",
  normalize: false,
  useGpu: false,
  saveCover: true,
  saveMetadata: true,
  retries: 2,
  readBrowserCookies: true,
  browserSession: "vivaldi",
  openInBrowser: false,
  allowStoryExtraction: false,
};

const dummyRuntime: RuntimeInfo = {
  mode: "tauri",
  pythonReady: true,
  ffmpegReady: true,
  ffmpegPath: "ffmpeg.exe",
  pythonPath: "python.exe",
  dataRoot: "C:/MockData",
  projectRoot: "C:/MockProject",
  gpuAvailable: true,
  gpuLabel: "NVIDIA GeForce RTX 5060",
  packaged: false,
};

const dummyAccess: AccessStatus = {
  active: false,
  link: "",
  browser: "",
  bridgeConnected: false,
};

describe("isEphemeralStoryUrl helper", () => {
  it("identifies Instagram stories correctly", () => {
    expect(isEphemeralStoryUrl("https://www.instagram.com/stories/shinchewieeee/4013374841222675452/")).toBe(true);
    expect(isEphemeralStoryUrl("https://instagram.com/stories/user_name/1234567890/")).toBe(true);
    expect(isEphemeralStoryUrl("https://www.instagram.com/p/DF31abc123/")).toBe(false);
    expect(isEphemeralStoryUrl("https://www.instagram.com/reel/DF31abc123/")).toBe(false);
  });

  it("identifies Facebook stories correctly", () => {
    expect(isEphemeralStoryUrl("https://www.facebook.com/stories/1552803711464154/UzpfSVNDOjE2NjYyNDYxOTE4ODMxMjY=/?view_single=1")).toBe(true);
    expect(isEphemeralStoryUrl("https://m.facebook.com/stories/987654321/abc123xyz")).toBe(true);
    expect(isEphemeralStoryUrl("https://www.facebook.com/photo/?fbid=12345")).toBe(false);
    expect(isEphemeralStoryUrl("https://www.facebook.com/share/p/xyz/")).toBe(false);
  });

  it("rejects non-story platforms and invalid URLs", () => {
    expect(isEphemeralStoryUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isEphemeralStoryUrl("https://www.tiktok.com/@user/video/123456")).toBe(false);
    expect(isEphemeralStoryUrl("not a url")).toBe(false);
    expect(isEphemeralStoryUrl("")).toBe(false);
  });
});

describe("StoryTermsModal component", () => {
  it("renders correctly and requires checkbox acknowledgement to enable", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <StoryTermsModal
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );
    });

    expect(container.textContent).toContain("Ephemeral Stories & Legal Agreement");
    expect(container.textContent).toContain("Acceptable Use Policy");
    expect(container.textContent).toContain("RA 10173");

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("I Agree & Enable")
    ) as HTMLButtonElement | undefined;
    expect(submitBtn).toBeDefined();
    expect(submitBtn?.disabled).toBe(true);

    // Clicking while disabled should not trigger confirm
    await act(async () => {
      submitBtn?.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    // Check acknowledgement checkbox
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).toBeDefined();

    await act(async () => {
      checkbox?.click();
    });
    expect(submitBtn?.disabled).toBe(false);

    // Click confirm
    await act(async () => {
      submitBtn?.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("closes cleanly when Cancel is clicked", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <StoryTermsModal
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );
    });

    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Cancel")
    );
    expect(cancelBtn).toBeDefined();

    await act(async () => {
      cancelBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("Ephemeral Story Extraction integration in SettingsView", () => {
  it("renders story extraction toggle and opens modal on opt-in click", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSettings = vi.fn();
    const onStatus = vi.fn();

    await act(async () => {
      root.render(
        <SettingsView
          runtime={dummyRuntime}
          settings={{ ...dummySettings, allowStoryExtraction: false }}
          onSettings={onSettings}
          onStatus={onStatus}
          initialTab="browser"
        />
      );
    });

    expect(container.textContent).toContain("Ephemeral Stories Extraction");
    expect(container.textContent).toContain("Disabled (Protected)");

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Ephemeral Stories Extraction"]'
    );
    expect(toggle).toBeDefined();

    // Clicking toggle when disabled opens the terms modal
    await act(async () => {
      toggle?.click();
    });

    expect(container.textContent).toContain("Ephemeral Stories & Legal Agreement");

    // Agree in the modal
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      checkbox?.click();
    });

    const agreeBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("I Agree & Enable")
    );
    await act(async () => {
      agreeBtn?.click();
    });

    expect(onSettings).toHaveBeenCalledWith(
      expect.objectContaining({ allowStoryExtraction: true })
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("disables story extraction immediately when already active", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSettings = vi.fn();
    const onStatus = vi.fn();

    await act(async () => {
      root.render(
        <SettingsView
          runtime={dummyRuntime}
          settings={{ ...dummySettings, allowStoryExtraction: true }}
          onSettings={onSettings}
          onStatus={onStatus}
          initialTab="browser"
        />
      );
    });

    expect(container.textContent).toContain("Active (Opt-In Acknowledged)");
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Ephemeral Stories Extraction"]'
    );

    await act(async () => {
      toggle?.click();
    });

    expect(onSettings).toHaveBeenCalledWith(
      expect.objectContaining({ allowStoryExtraction: false })
    );
    expect(onStatus).toHaveBeenCalledWith(
      expect.stringContaining("Ephemeral stories extraction disabled")
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("Ephemeral Story Extraction integration in ConverterView", () => {
  it("shows warning banner when story URL is entered and extraction is disabled", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onStatus = vi.fn();
    const onStart = vi.fn().mockResolvedValue(true);

    await act(async () => {
      root.render(
        <ConverterView
          settings={{ ...dummySettings, allowStoryExtraction: false }}
          runtime={dummyRuntime}
          events={[]}
          access={dummyAccess}
          running={false}
          progress={0}
          status="Idle"
          onSettings={vi.fn()}
          onStart={onStart}
          onCancel={vi.fn()}
          onCreateAccess={vi.fn()}
          onClearAccess={vi.fn()}
          onStatus={onStatus}
          onError={vi.fn()}
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Source media URL or local path"]'
    );
    expect(input).toBeDefined();

    // Type Instagram story URL
    await act(async () => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "https://www.instagram.com/stories/shinchewieeee/4013374841222675452/");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    expect(container.textContent).toContain("Ephemeral Story Link Detected");
    expect(container.textContent).toContain("Review Terms & Enable");

    // Click "Convert media" button while disabled
    const convertBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Convert media")
    );
    expect(convertBtn).toBeDefined();

    await act(async () => {
      convertBtn?.click();
    });

    // onStart should NOT be called
    expect(onStart).not.toHaveBeenCalled();
    // Modal should be opened
    expect(container.textContent).toContain("Ephemeral Stories & Legal Agreement");
    expect(onStatus).toHaveBeenCalledWith(
      expect.stringContaining("Ephemeral story extraction requires accepting the Terms of Usage")
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
