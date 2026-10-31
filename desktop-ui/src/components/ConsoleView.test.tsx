import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleView } from "./ConsoleView";
import { bridge, type ConverterEvent } from "../bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const exportLogMock = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("../bridge", () => ({
  bridge: {
    exportLogFile: exportLogMock.run,
    getThumbnail: vi.fn().mockResolvedValue(null),
    openPath: vi.fn().mockResolvedValue(undefined),
    openFile: vi.fn().mockResolvedValue(undefined),
    dragLibraryFile: vi.fn().mockResolvedValue(undefined),
    deleteLibraryEntry: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("ConsoleView", () => {
  const sampleEvents: ConverterEvent[] = [
    { jobId: "j1", kind: "started", message: "[*] Starting conversion batch..." },
    { jobId: "j1", kind: "progress", message: "Transcoding MP3: 25%" },
    { jobId: "j1", kind: "progress", message: "Transcoding MP3: 50%" },
    { jobId: "j1", kind: "progress", message: "Transcoding MP3: 100%" },
    { jobId: "j1", kind: "finished", message: "[+] Converted: track1.mp3" },
    { jobId: "j1", kind: "failed", message: "[!] Error converting track2: Video unavailable" },
  ];

  beforeEach(() => {
    exportLogMock.run.mockReset();
    exportLogMock.run.mockResolvedValue("C:\\Exports\\janeconverter-session.txt");
  });

  it("renders log lines and filters errors properly", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ConsoleView
          events={sampleEvents}
          initialMode="raw"
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("Starting conversion batch...");
    expect(container.textContent).toContain("Converted: track1.mp3");

    // Click "Errors" filter
    const errorBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Errors"
    );
    expect(errorBtn).toBeDefined();

    await act(async () => {
      errorBtn?.click();
    });

    expect(container.textContent).toContain("Error converting track2");
    expect(container.textContent).not.toContain("Converted: track1.mp3");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("calls exportLogFile when clicking Export logs", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onStatus = vi.fn();

    await act(async () => {
      root.render(
        <ConsoleView
          events={sampleEvents}
          initialMode="raw"
          onClear={vi.fn()}
          onStatus={onStatus}
        />
      );
    });

    const exportBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Export logs")
    );
    expect(exportBtn).toBeDefined();

    await act(async () => {
      exportBtn?.click();
      await Promise.resolve();
    });

    expect(exportLogMock.run).toHaveBeenCalledTimes(1);
    const [content, defaultName] = exportLogMock.run.mock.calls[0];
    expect(content).toContain("JaneConverter Diagnostics Log");
    expect(content).toContain("Starting conversion batch...");
    expect(defaultName).toMatch(/^janeconverter-session-.*\.txt$/);
    expect(onStatus).toHaveBeenCalledWith(
      "Exported logs to: C:\\Exports\\janeconverter-session.txt"
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("copies logs to clipboard when clicking Copy logs", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onStatus = vi.fn();

    await act(async () => {
      root.render(
        <ConsoleView
          events={sampleEvents}
          initialMode="raw"
          onClear={vi.fn()}
          onStatus={onStatus}
        />
      );
    });

    const copyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Copy logs")
    );
    expect(copyBtn).toBeDefined();

    await act(async () => {
      copyBtn?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith("Console copied to clipboard.");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders In Progress View by default and toggles between grid, list, and raw console", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const playlistEvents: ConverterEvent[] = [
      { jobId: "j2", kind: "started", message: "[*] Found 3 tracks in 'Dariacore EP'. Converting 3..." },
      { jobId: "j2", kind: "progress", message: "[1/3] #1: hyperpoop 2026 — Transcoding MP3: 90% (speed 85.0x)" },
      { jobId: "j2", kind: "finished", message: "[+] Converted: 1. hyperpoop 2026.mp3" },
      { jobId: "j2", kind: "progress", message: "[2/3] #2: runaway with peace — [download]  50.0% of 4.0MiB at 4.2MiB/s ETA 00:01" },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={playlistEvents}
          initialMode="in_progress"
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    // In Progress View should be active
    expect(container.textContent).toContain("In Progress View.");
    expect(container.textContent).toContain("Dariacore EP");
    expect(container.textContent).toContain("hyperpoop 2026");
    expect(container.textContent).toContain("runaway with peace");

    // Toggle to List mode
    const listBtn = container.querySelector<HTMLButtonElement>('button[aria-label="List layout"]');
    expect(listBtn).not.toBeNull();
    await act(async () => {
      listBtn?.click();
    });

    // Check list view renders rows
    expect(container.textContent).toContain("#1");
    expect(container.textContent).toContain("#2");

    // Click Raw Console switch button
    const rawConsoleBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Raw Console")
    );
    expect(rawConsoleBtn).toBeDefined();

    await act(async () => {
      rawConsoleBtn?.click();
    });

    // Should now be on Raw Console
    expect(container.textContent).toContain("Raw console.");
    expect(container.textContent).toContain("Clean");
    expect(container.textContent).toContain("Transcoding MP3: 90%");

    // Click back to In Progress View
    const backBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("In Progress View")
    );
    expect(backBtn).toBeDefined();

    await act(async () => {
      backBtn?.click();
    });

    expect(container.textContent).toContain("In Progress View.");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("calls onClear and renders photo album batches properly", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClearMock = vi.fn();

    const photoEvents: ConverterEvent[] = [
      { jobId: "j2", kind: "started", message: "[*] Starting conversion batch..." },
      { jobId: "j2", kind: "log", message: "Found 4 photos in 'Summer 2026 Trip'. Starting download..." },
      { jobId: "j2", kind: "progress", message: "Downloading Facebook photo 1 of 4..." },
      { jobId: "j2", kind: "log", message: "[+] Saved photo: 1. Summer 2026 Trip_001.jpg" },
      { jobId: "j2", kind: "progress", message: "Downloading Facebook photo 2 of 4..." },
      { jobId: "j2", kind: "finished", message: "DONE! Exported: C:\\Photos\\Summer 2026 Trip" },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={photoEvents}
          jobId="j2"
          running={false}
          initialMode="in_progress"
          onClear={onClearMock}
          onStatus={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("Summer 2026 Trip");
    expect(container.textContent).toContain("Photo #1");
    expect(container.textContent).toContain("Photo #2");

    // Click Clear button
    const clearBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().includes("Clear")
    );
    expect(clearBtn).toBeDefined();

    await act(async () => {
      clearBtn?.click();
    });

    expect(onClearMock).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders live source media thumbnails without batch cover cross-contamination", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const liveEvents: ConverterEvent[] = [
      { jobId: "j3", kind: "started", message: "[*] Starting conversion batch..." },
      { jobId: "j3", kind: "log", message: "[*] Track #1 Manifest: Donut's New Groove\tKotomi\thttps://cdn.example.com/donut.jpg" },
      { jobId: "j3", kind: "log", message: "[*] Track #2 Manifest: Angel\tKotomi\thttps://cdn.example.com/angel.jpg" },
      { jobId: "j3", kind: "log", message: "[*] Playlist Cover Art: C:\\Exports\\cover.jpg" },
      { jobId: "j3", kind: "progress", message: "[1/2] Fetching #1: Donut's New Groove..." },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={liveEvents}
          jobId="j3"
          running={true}
          initialMode="in_progress"
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("Donut's New Groove");
    expect(container.textContent).toContain("Angel");

    // Images should point to their individual live thumbnails
    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
    const donutImg = images.find((img) => img.src === "https://cdn.example.com/donut.jpg");
    const angelImg = images.find((img) => img.src === "https://cdn.example.com/angel.jpg");

    expect(donutImg).toBeDefined();
    expect(angelImg).toBeDefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("transitions single media conversion from transcoding to ready when operation finishes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const singleEvents: ConverterEvent[] = [
      { jobId: "j4", kind: "started", message: "[*] Starting conversion..." },
      { jobId: "j4", kind: "progress", message: "Transcoding MP4: 50% (speed 14.7x)" },
      { jobId: "j4", kind: "log", message: "Ready! File exported to: Japanese Food Review.mp4" },
      { jobId: "j4", kind: "log", message: "DONE! Exported: D:\\Exports\\Japanese Food Review.mp4" },
      { jobId: "j4", kind: "finished", message: "Conversion finished. Your media is ready.", output: "D:\\Exports\\Japanese Food Review.mp4" },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={singleEvents}
          jobId="j4"
          running={false}
          initialMode="in_progress"
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("Japanese Food Review");
    expect(container.textContent).toContain("1 of 1 completed");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).not.toContain("Transcoding");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shuffles through past and live conversion sessions via carousel controls", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onNavigateToHistory = vi.fn();
    const onClear = vi.fn();

    const multiSessionEvents: ConverterEvent[] = [
      // Session 1: Music playlist
      { jobId: "session-1", kind: "started", message: "[*] Found 2 tracks in 'Hyperpop EP'. Converting 2..." },
      { jobId: "session-1", kind: "progress", message: "[1/2] #1: Track One — Transcoding MP3: 100%" },
      { jobId: "session-1", kind: "finished", message: "[+] Converted: 1. Track One.mp3" },
      { jobId: "session-1", kind: "progress", message: "[2/2] #2: Track Two — Transcoding MP3: 100%" },
      { jobId: "session-1", kind: "finished", message: "[+] Converted: 2. Track Two.mp3" },

      // Session 2: Facebook photo album
      { jobId: "session-2", kind: "started", message: "[*] Starting conversion batch..." },
      { jobId: "session-2", kind: "log", message: "Found 2 photos in 'Summer Trip'. Starting download..." },
      { jobId: "session-2", kind: "progress", message: "Downloading Facebook photo 1 of 2..." },
      { jobId: "session-2", kind: "log", message: "[+] Saved photo: 1. Summer Trip_001.jpg" },
      { jobId: "session-2", kind: "progress", message: "Downloading Facebook photo 2 of 2..." },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={multiSessionEvents}
          jobId="session-2"
          running={true}
          initialMode="in_progress"
          onClear={onClear}
          onStatus={vi.fn()}
          onNavigateToHistory={onNavigateToHistory}
        />
      );
    });

    // Default view is on active session-2 (Session 2 / 2, Live)
    expect(container.textContent).toContain("Session 2 / 2");
    expect(container.textContent).toContain("Live");
    expect(container.textContent).toContain("Summer Trip");
    expect(container.textContent).toContain("Photo #1");

    // Click previous session button (<)
    const prevBtn = container.querySelector<HTMLButtonElement>("button[aria-label='Previous session']");
    expect(prevBtn).toBeDefined();

    await act(async () => {
      prevBtn?.click();
    });

    // Now viewing session-1 (Session 1 / 2, History)
    expect(container.textContent).toContain("Session 1 / 2");
    expect(container.textContent).toContain("History");
    expect(container.textContent).toContain("Hyperpop EP");
    expect(container.textContent).toContain("Track One");
    expect(container.textContent).not.toContain("Summer Trip");

    // Because session-2 is currently running in background, "Jump to Live" button appears
    const jumpToLiveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Jump to Live")
    );
    expect(jumpToLiveBtn).toBeDefined();

    // Click Jump to Live
    await act(async () => {
      jumpToLiveBtn?.click();
    });

    // Returns to active live session
    expect(container.textContent).toContain("Session 2 / 2");
    expect(container.textContent).toContain("Live");
    expect(container.textContent).toContain("Summer Trip");

    // Click History button to open session history modal
    const historyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("History") && b.getAttribute("title")?.includes("conversion session history")
    );
    expect(historyBtn).toBeDefined();
    await act(async () => {
      historyBtn?.click();
    });

    // Modal is opened
    expect(container.textContent).toContain("Conversion Sessions");
    expect(container.textContent).toContain("Active Workspace Sessions (2)");

    // Click on Session 1 in modal to switch rack
    const session1Row = Array.from(container.querySelectorAll("div")).find(
      (d) => d.textContent?.includes("Hyperpop EP") && d.textContent?.includes("View in Rack")
    );
    expect(session1Row).toBeDefined();
    const viewBtn = session1Row?.querySelector("button");
    await act(async () => {
      viewBtn?.click();
    });

    // Switched to Session 1
    expect(container.textContent).toContain("Session 1 / 2");
    expect(container.textContent).toContain("Hyperpop EP");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("ensures a brand new conversion starts with a fresh blank page without leaking previous items", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const pastEvents: ConverterEvent[] = [
      { jobId: "old-session", kind: "started", message: "[*] Found 40 tracks in 'Massive Album'..." },
      { jobId: "old-session", kind: "finished", message: "[+] Converted: 1. Track.mp3" },
    ];

    // New conversion starts for a facebook album link
    await act(async () => {
      root.render(
        <ConsoleView
          events={pastEvents}
          jobId="new-facebook-session"
          running={true}
          sourceTitle="https://www.facebook.com/share/p/1KB8BpDr8r/"
          initialMode="in_progress"
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    // Content should show the new source and fresh blank/starting state, NOT the 40 tracks from old-session
    expect(container.textContent).toContain("https://www.facebook.com/share/p/1KB8BpDr8r/");
    expect(container.textContent).not.toContain("Massive Album");
    expect(container.textContent).not.toContain("Track #1");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders carousel arrow buttons even on single session and keeps photo thumbnails alive upon finish", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const photoEvents: ConverterEvent[] = [
      { jobId: "single-photo-batch", kind: "started", message: "[*] Starting conversion batch..." },
      { jobId: "single-photo-batch", kind: "log", message: "Found 2 photos in 'AHYEON_BABYMONSTER'. Starting download..." },
      { jobId: "single-photo-batch", kind: "log", message: "[*] Photo #1 Source: https://scontent.example.com/photo1.jpg" },
      { jobId: "single-photo-batch", kind: "log", message: "[*] Photo #2 Source: https://scontent.example.com/photo2.jpg" },
      { jobId: "single-photo-batch", kind: "progress", message: "Downloading Facebook photo 1 of 2..." },
      { jobId: "single-photo-batch", kind: "log", message: "[*] Photo #1 Saved: D:\\Exports\\AHYEON_BABYMONSTER\\1. AHYEON_BABYMONSTER_001.png" },
      { jobId: "single-photo-batch", kind: "log", message: "[+] Saved photo: 1. AHYEON_BABYMONSTER_001.png" },
      { jobId: "single-photo-batch", kind: "progress", message: "Downloading Facebook photo 2 of 2..." },
      { jobId: "single-photo-batch", kind: "log", message: "[*] Photo #2 Saved: D:\\Exports\\AHYEON_BABYMONSTER\\2. AHYEON_BABYMONSTER_002.png" },
      { jobId: "single-photo-batch", kind: "log", message: "[+] Saved photo: 2. AHYEON_BABYMONSTER_002.png" },
      { jobId: "single-photo-batch", kind: "finished", message: "DONE! Exported: D:\\Exports\\AHYEON_BABYMONSTER" },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={photoEvents}
          jobId="single-photo-batch"
          running={false}
          initialMode="in_progress"
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    // 1. Carousel arrow buttons (< and >) must be visible even for a single session
    const prevBtn = container.querySelector<HTMLButtonElement>("button[aria-label='Previous session']");
    const nextBtn = container.querySelector<HTMLButtonElement>("button[aria-label='Next session']");
    expect(prevBtn).toBeDefined();
    expect(nextBtn).toBeDefined();
    expect(prevBtn?.disabled).toBe(true);
    expect(nextBtn?.disabled).toBe(true);
    expect(container.textContent).toContain("Session 1 / 1");

    // 2. Photos must keep their live CDN thumbnails intact and NOT die or revert to placeholder icons
    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
    const photo1 = images.find((img) => img.src === "https://scontent.example.com/photo1.jpg");
    const photo2 = images.find((img) => img.src === "https://scontent.example.com/photo2.jpg");
    expect(photo1).toBeDefined();
    expect(photo2).toBeDefined();

    // Verify ready badges are active
    expect(container.textContent).toContain("2 of 2 completed");
    expect(container.textContent).toContain("Ready");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows clean empty state without ghost downloading card when events only have UI messages", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onNavigateToConverter = vi.fn();
    // Only UI status events remain after clearing conversion jobs
    const uiOnlyEvents: ConverterEvent[] = [
      { jobId: "ui", kind: "status", message: "Applied Fast MP3 preset: High-bitrate 320k MP3 without loudness normalization for faster conversion." },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={uiOnlyEvents}
          jobId={undefined}
          running={false}
          initialMode="in_progress"
          onClear={vi.fn()}
          onStatus={vi.fn()}
          onNavigateToConverter={onNavigateToConverter}
        />
      );
    });

    // Must show empty state, not a ghost "Downloading 0%" or "Media file" card
    expect(container.textContent).toContain("No active conversions");
    expect(container.textContent).not.toContain("Downloading 0%");

    // Close Page button must be rendered in empty state header and disabled/blacked out when <= 1 page
    const closePageBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Close Page")
    );
    expect(closePageBtn).toBeDefined();
    expect(closePageBtn?.disabled).toBe(true);
    expect(closePageBtn?.className).toContain("opacity-25");
    expect(closePageBtn?.className).toContain("cursor-not-allowed");
    await act(async () => {
      closePageBtn?.click();
    });
    expect(onNavigateToConverter).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders Close Page button, card action buttons (drag, play, folder), and right click context menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onNavigateToConverter = vi.fn();
    const readyEvents: ConverterEvent[] = [
      { jobId: "test-job-ready", kind: "started", message: "[*] Starting conversion..." },
      { jobId: "test-job-ready", kind: "log", message: "[+] Converted: Summer Hit.mp3" },
      { jobId: "test-job-ready", kind: "finished", message: "Conversion finished.", output: "D:\\Exports\\Summer Hit.mp3" },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={readyEvents}
          jobId="test-job-ready"
          running={false}
          initialMode="in_progress"
          outputDir="D:\\Exports"
          conversionTimings={{ "d:/exports/summer hit.mp3": 2400 }}
          onClear={vi.fn()}
          onStatus={vi.fn()}
          onNavigateToConverter={onNavigateToConverter}
        />
      );
    });

    // 1. Close Page button in active header is blacked out & disabled when only 1 session page exists
    const closePageBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Close Page")
    );
    expect(closePageBtn).toBeDefined();
    expect(closePageBtn?.disabled).toBe(true);
    expect(closePageBtn?.className).toContain("opacity-25");
    expect(closePageBtn?.className).toContain("cursor-not-allowed");

    // 2. Conversion time badge on card
    expect(container.textContent).toContain("2.4s");

    // 3. Small icon action buttons: Drag, Play, Show in folder
    const dragBtn = container.querySelector<HTMLButtonElement>("button[aria-label='Drag Summer Hit']");
    const openBtn = container.querySelector<HTMLButtonElement>("button[aria-label='Open Summer Hit']");
    const folderBtn = container.querySelector<HTMLButtonElement>("button[aria-label='Show in folder for Summer Hit']");
    expect(dragBtn).toBeDefined();
    expect(openBtn).toBeDefined();
    expect(folderBtn).toBeDefined();

    // 4. Right click context menu on the card
    const card = container.querySelector(".group.relative.flex.flex-col");
    expect(card).toBeDefined();

    await act(async () => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 200,
      });
      card?.dispatchEvent(event);
    });

    // Context menu is visible with status, time, and action options
    expect(container.textContent).toContain("Open / Play file");
    expect(container.textContent).toContain("Show in File Explorer");
    expect(container.textContent).toContain("Copy full path");
    expect(container.textContent).toContain("Conversion time");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("handles Close Page enablement across multiple sessions and ongoing status, and tests drag file handler", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClear = vi.fn();
    const onStatus = vi.fn();

    const multiSessionEvents: ConverterEvent[] = [
      { jobId: "session-1", kind: "started", message: "[*] Starting session 1..." },
      { jobId: "session-1", kind: "finished", message: "Finished session 1.", output: "D:\\Music\\Track1.mp3" },
      { jobId: "session-2", kind: "started", message: "[*] Starting session 2..." },
      { jobId: "session-2", kind: "finished", message: "Finished session 2.", output: "D:\\Music\\Track2.mp3" },
    ];

    // 1. With 2 finished sessions and running=false: Close Page MUST be enabled
    await act(async () => {
      root.render(
        <ConsoleView
          events={multiSessionEvents}
          jobId="session-2"
          running={false}
          initialMode="in_progress"
          outputDir="D:\\Music"
          onClear={onClear}
          onStatus={onStatus}
        />
      );
    });

    let closePageBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Close Page")
    );
    expect(closePageBtn).toBeDefined();
    expect(closePageBtn?.disabled).toBe(false);

    // Clicking Close Page closes the session
    await act(async () => {
      closePageBtn?.click();
    });
    expect(onClear).toHaveBeenCalled();

    // 2. When ongoing (running=true) even with 2 sessions: Close Page MUST be disabled & blacked out
    await act(async () => {
      root.render(
        <ConsoleView
          events={multiSessionEvents}
          jobId="session-2"
          running={true}
          initialMode="in_progress"
          outputDir="D:\\Music"
          onClear={onClear}
          onStatus={onStatus}
        />
      );
    });

    closePageBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Close Page")
    );
    expect(closePageBtn?.disabled).toBe(true);
    expect(closePageBtn?.className).toContain("opacity-25");

    // 3. When paused=true: Close Page MUST also be disabled (ongoing unless aborted)
    await act(async () => {
      root.render(
        <ConsoleView
          events={multiSessionEvents}
          jobId="session-2"
          running={false}
          paused={true}
          initialMode="in_progress"
          outputDir="D:\\Music"
          onClear={onClear}
          onStatus={onStatus}
        />
      );
    });

    closePageBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Close Page")
    );
    expect(closePageBtn?.disabled).toBe(true);
    expect(closePageBtn?.className).toContain("opacity-25");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("triggers open file, show in folder, and drag with verified resolved path", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const openFileSpy = vi.spyOn(bridge, "openFile").mockResolvedValue();
    const openPathSpy = vi.spyOn(bridge, "openPath").mockResolvedValue();
    const dragSpy = vi.spyOn(bridge, "dragLibraryFile").mockResolvedValue();

    const events: ConverterEvent[] = [
      { jobId: "job-album-1", kind: "started", message: "[*] JANECONVERTER PLAYLIST BATCH PIPELINE" },
      { jobId: "job-album-1", kind: "log", message: "Target Directory: I:\\Music\\Album" },
      { jobId: "job-album-1", kind: "log", message: "[*] Track #1 Manifest: Donut's New Groove" },
      { jobId: "job-album-1", kind: "log", message: "[+] Converted: 1. Donut's New Groove.mp3" },
      { jobId: "job-album-1", kind: "finished", message: "DONE! Exported: I:\\Music\\Album", output: "I:\\Music\\Album" },
    ];

    const historyItems = [
      {
        id: "hist-1",
        timestamp: "2026-10-30T00:00:00Z",
        source: "https://youtube.com/playlist?list=xyz",
        fileName: "Album",
        exportPath: "I:\\Music\\Album",
        presetName: "Studio Master",
        formatLabel: "MP3",
        qualityLabel: "320k",
        elapsedMs: 2500,
        status: "succeeded" as const,
      },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={events}
          jobId="job-album-1"
          running={false}
          initialMode="in_progress"
          outputDir="I:\\Music\\Album"
          historyItems={historyItems}
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    // 1. Play button
    const playBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label")?.includes("Open Donut's New Groove")
    );
    expect(playBtn).toBeDefined();
    await act(async () => {
      playBtn?.click();
    });
    expect(openFileSpy).toHaveBeenCalledWith("I:\\Music\\Album\\1. Donut's New Groove.mp3");

    // 2. Folder button
    const folderBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label")?.includes("Show in folder for Donut's New Groove")
    );
    expect(folderBtn).toBeDefined();
    await act(async () => {
      folderBtn?.click();
    });
    expect(openPathSpy).toHaveBeenCalledWith("I:\\Music\\Album\\1. Donut's New Groove.mp3");

    // 3. Drag button
    const dragBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label")?.includes("Drag Donut's New Groove")
    );
    expect(dragBtn).toBeDefined();
    await act(async () => {
      dragBtn?.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    });
    expect(dragSpy).toHaveBeenCalledWith("I:\\Music\\Album\\1. Donut's New Groove.mp3");

    openFileSpy.mockRestore();
    openPathSpy.mockRestore();
    dragSpy.mockRestore();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not display a phantom downloading card when events are cleared and not running", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // Only UI status events (no job events) and running=false
    const events: ConverterEvent[] = [
      { jobId: "ui", kind: "status", message: "Applied Fast MP3 preset: High-bitrate 320k MP3 without loudness normalization for faster conversion." },
    ];

    await act(async () => {
      root.render(
        <ConsoleView
          events={events}
          running={false}
          initialMode="in_progress"
          sourceTitle="Media file"
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    // Should display empty state ("No active conversions"), NOT "Downloading 0%" or "1 converting"
    expect(container.textContent).toContain("No active conversions");
    expect(container.textContent).not.toContain("Downloading 0%");
    expect(container.textContent).not.toContain("1 converting");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders the 4 action buttons in order (Drag - Delete - Open - Open File path), deletes item when clicked, and displays conversion settings preset", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const deleteSpy = vi.spyOn(bridge, "deleteLibraryEntry").mockResolvedValue();

    const events: ConverterEvent[] = [
      { jobId: "job-album-1", kind: "started", message: "[*] JANECONVERTER PLAYLIST BATCH PIPELINE" },
      { jobId: "job-album-1", kind: "log", message: "Target Directory: I:\\Music\\Album" },
      { jobId: "job-album-1", kind: "log", message: "[*] Track #1 Manifest: Donut's New Groove" },
      { jobId: "job-album-1", kind: "log", message: "[+] Converted: 1. Donut's New Groove.mp3" },
      { jobId: "job-album-1", kind: "finished", message: "DONE! Exported: I:\\Music\\Album", output: "I:\\Music\\Album" },
    ];

    const settings = {
      outputDir: "I:\\Music\\Album",
      fetchedDir: "fetched",
      tempDir: "",
      category: "Music" as const,
      format: "mp3",
      bitrate: "320k",
      sampleRate: 48000,
      resolution: "original",
      normalize: false,
      useGpu: false,
      saveCover: true,
      saveMetadata: true,
      allowPngFallback: false,
      reconstructFrequencyLoss: false,
      retries: 2,
      startTime: "",
    };

    await act(async () => {
      root.render(
        <ConsoleView
          events={events}
          jobId="job-album-1"
          running={false}
          initialMode="in_progress"
          outputDir="I:\\Music\\Album"
          settings={settings}
          onClear={vi.fn()}
          onStatus={vi.fn()}
        />
      );
    });

    // Verify preset and conversion settings in hero batch summary
    expect(container.textContent).toContain("MP3");
    expect(container.textContent).toContain("320 kbps • 48kHz");
    expect(container.textContent).toContain("Preset: Fast MP3");
    expect(container.textContent).toContain("1 of 1 completed");

    // Verify the 4 action buttons order: Drag - Delete - Open - Open File path
    const dragBtn = container.querySelector('button[aria-label="Drag Donut\'s New Groove"]');
    const deleteBtn = container.querySelector('button[aria-label="Delete Donut\'s New Groove"]');
    const playBtn = container.querySelector('button[aria-label="Open Donut\'s New Groove"]');
    const folderBtn = container.querySelector('button[aria-label="Show in folder for Donut\'s New Groove"]');

    expect(dragBtn).not.toBeNull();
    expect(deleteBtn).not.toBeNull();
    expect(playBtn).not.toBeNull();
    expect(folderBtn).not.toBeNull();

    const buttonContainer = dragBtn!.parentElement!;
    const buttons = Array.from(buttonContainer.querySelectorAll("button"));
    expect(buttons).toHaveLength(4);
    expect(buttons[0]).toBe(dragBtn);
    expect(buttons[1]).toBe(deleteBtn);
    expect(buttons[2]).toBe(playBtn);
    expect(buttons[3]).toBe(folderBtn);

    // Click delete
    await act(async () => {
      deleteBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(deleteSpy).toHaveBeenCalledWith("I:\\Music\\Album", "I:\\Music\\Album\\1. Donut's New Groove.mp3");

    // Item card is removed from view and count is 0 of 0
    expect(container.querySelector('button[aria-label="Delete Donut\'s New Groove"]')).toBeNull();
    expect(container.textContent).toContain("0 of 0 completed");

    deleteSpy.mockRestore();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
