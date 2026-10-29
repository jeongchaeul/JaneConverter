import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleView } from "./ConsoleView";
import type { ConverterEvent } from "../bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const exportLogMock = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("../bridge", () => ({
  bridge: {
    exportLogFile: exportLogMock.run,
    getThumbnail: vi.fn().mockResolvedValue(null),
    openPath: vi.fn().mockResolvedValue(undefined),
    openFile: vi.fn().mockResolvedValue(undefined),
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
});
