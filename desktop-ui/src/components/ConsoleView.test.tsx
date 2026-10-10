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
});
