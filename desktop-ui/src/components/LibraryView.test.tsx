import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryView } from "./LibraryView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeBridge = vi.hoisted(() => ({
  scanLibrary: vi.fn(),
  openPath: vi.fn(),
  openFile: vi.fn(),
  dragLibraryFile: vi.fn(),
  chooseFolder: vi.fn(),
  moveLibrary: vi.fn(),
  getThumbnail: vi.fn(),
  recentConversions: vi.fn(),
  deleteLibraryEntry: vi.fn(),
  clearConversionTimings: vi.fn(),
}));

vi.mock("../bridge", () => ({ bridge: fakeBridge }));

const settings = {
  outputDir: "D:\\JaneConverter\\converted",
  fetchedDir: "fetched",
  category: "Music" as const,
  format: "mp3",
  bitrate: "320k",
  sampleRate: 48000,
  resolution: "original",
  normalize: false,
  useGpu: false,
  saveCover: true,
  saveMetadata: true,
  retries: 2,
};

describe("Converted library", () => {
  beforeEach(() => {
    fakeBridge.scanLibrary.mockReset();
    fakeBridge.openPath.mockReset();
    fakeBridge.openFile.mockReset();
    fakeBridge.dragLibraryFile.mockReset();
    fakeBridge.dragLibraryFile.mockResolvedValue(undefined);
    fakeBridge.chooseFolder.mockReset();
    fakeBridge.moveLibrary.mockReset();
    fakeBridge.getThumbnail.mockReset();
    fakeBridge.recentConversions.mockReset();
    fakeBridge.deleteLibraryEntry.mockReset();
    fakeBridge.clearConversionTimings.mockReset();
    fakeBridge.scanLibrary.mockResolvedValue([
      {
        path: "D:\\JaneConverter\\converted\\Music",
        name: "Music",
        isDirectory: true,
        isPlaylist: false,
        mediaCount: 1,
        totalBytes: 1024,
        extension: "",
      },
      {
        path: "D:\\JaneConverter\\converted\\song.mp3",
        name: "song.mp3",
        isDirectory: false,
        isPlaylist: false,
        mediaCount: 1,
        totalBytes: 1024,
        extension: "MP3",
        conversionMs: 2450,
      },
    ]);
    fakeBridge.recentConversions.mockResolvedValue([]);
    fakeBridge.getThumbnail.mockResolvedValue("data:image/jpeg;base64,preview");
  });

  it("keeps navigation inside the library and shows root actions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LibraryView settings={settings} onSettings={vi.fn()} onStatus={vi.fn()} />);
    });

    const back = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Back"));
    expect(back).toBeDefined();
    expect(back).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Open folder");
    expect(container.textContent).toContain("Move library");
    expect(container.querySelector('img[alt=""]')).not.toBeNull();

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Open")?.click();
      await Promise.resolve();
    });
    expect(fakeBridge.scanLibrary).toHaveBeenLastCalledWith("D:\\JaneConverter\\converted\\Music");

    const nestedBack = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Back"));
    expect(nestedBack).toHaveProperty("disabled", false);
    await act(async () => {
      nestedBack?.click();
      await Promise.resolve();
    });
    expect(fakeBridge.scanLibrary).toHaveBeenLastCalledWith("D:\\JaneConverter\\converted");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("moves the root library through the native bridge", async () => {
    const onSettings = vi.fn();
    const onStatus = vi.fn();
    fakeBridge.chooseFolder.mockResolvedValue("E:\\Media");
    fakeBridge.moveLibrary.mockResolvedValue({ destination: "E:\\Media\\converted" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LibraryView settings={settings} onSettings={onSettings} onStatus={onStatus} />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Move library"))?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Move converted library?");
    expect(fakeBridge.moveLibrary).not.toHaveBeenCalled();
    const confirmButton = Array.from(container.querySelectorAll("button"))
      .filter((button) => button.textContent?.trim() === "Move library")
      .pop();
    expect(confirmButton).toBeDefined();
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(fakeBridge.moveLibrary).toHaveBeenCalledWith(settings.outputDir, "E:\\Media");
    expect(onSettings).toHaveBeenCalledWith({ ...settings, outputDir: "E:\\Media\\converted" });
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("Library moved"));
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("offers separate open and reveal actions for media files and displays conversion elapsed time in context menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LibraryView settings={settings} onSettings={vi.fn()} onStatus={vi.fn()} />);
    });

    expect(container.textContent).toContain("Converted in 2.5s");

    const fileRow = container.querySelector<HTMLElement>('[title="Drag this file into another app"]');
    await act(async () => {
      fileRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    });
    const menu = container.querySelector(".context-menu");
    expect(menu?.textContent).toContain("Conversion time");
    expect(menu?.textContent).toContain("2.5s");

    await act(async () => {
      container.querySelector('button[aria-label="Open song.mp3"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('button[aria-label="Show song.mp3 in folder"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fakeBridge.openFile).toHaveBeenCalledWith("D:\\JaneConverter\\converted\\song.mp3");
    expect(fakeBridge.openPath).toHaveBeenCalledWith("D:\\JaneConverter\\converted\\song.mp3");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("hands a dragged library file to the native bridge without opening it", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LibraryView settings={settings} onSettings={vi.fn()} onStatus={vi.fn()} />);
    });

    const fileRow = container.querySelector<HTMLElement>('[title="Drag this file into another app"]');
    expect(fileRow?.draggable).toBe(true);
    await act(async () => {
      fileRow?.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(fakeBridge.dragLibraryFile).toHaveBeenCalledWith("D:\\JaneConverter\\converted\\song.mp3");
    expect(fakeBridge.openFile).not.toHaveBeenCalled();

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("shows recent conversions from every library folder", async () => {
    fakeBridge.recentConversions.mockResolvedValue([
      {
        path: "D:\\JaneConverter\\converted\\Videos\\Facebook\\recent.mp4",
        name: "recent.mp4",
        isDirectory: false,
        isPlaylist: false,
        mediaCount: 1,
        totalBytes: 2048,
        extension: "MP4",
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LibraryView settings={settings} onSettings={vi.fn()} onStatus={vi.fn()} />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Recents")?.click();
      await Promise.resolve();
    });

    expect(fakeBridge.recentConversions).toHaveBeenCalledWith(settings.outputDir, 100);
    expect(container.textContent).toContain("recent.mp4");
    expect(container.textContent).toContain("D:\\JaneConverter\\converted\\Videos\\Facebook");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("shows conversion history, deletes individual entries, and flushes all via Clear Temp History", async () => {
    const onClearHistory = vi.fn();
    const onRemoveHistoryItem = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LibraryView
          settings={settings}
          onSettings={vi.fn()}
          onStatus={vi.fn()}
          onClearHistory={onClearHistory}
          onRemoveHistoryItem={onRemoveHistoryItem}
          history={[
            {
              id: "hist-1",
              timestamp: "2026-10-01T10:00:00.000Z",
              source: "https://www.instagram.com/p/ABC123/",
              fileName: "photo_01.jpg",
              exportPath: "D:\\JaneConverter\\converted\\Images\\Instagram\\photo_01.jpg",
              presetName: "Preserve Quality",
              formatLabel: "JPG (Source)",
              qualityLabel: "Source Quality",
              elapsedMs: 1800,
              status: "succeeded",
              fallbackNote: null,
            },
          ]}
        />,
      );
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "History")?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Succeeded");
    expect(container.textContent).toContain("photo_01.jpg");
    expect(container.textContent).toContain("https://www.instagram.com/p/ABC123/");
    expect(container.textContent).toContain("Preset: Preserve Quality");
    expect(container.textContent).toContain("JPG (Source)");
    expect(container.textContent).toContain("Source Quality");
    expect(container.textContent).toContain("1.8s");

    const deleteItemBtn = container.querySelector('button[aria-label="Delete history entry for photo_01.jpg"]');
    expect(deleteItemBtn).not.toBeNull();
    await act(async () => {
      deleteItemBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onRemoveHistoryItem).toHaveBeenCalledWith("hist-1");

    const clearBtn = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clear Temp History"));
    expect(clearBtn).toBeDefined();
    await act(async () => {
      clearBtn?.click();
      await Promise.resolve();
    });
    expect(onClearHistory).toHaveBeenCalledTimes(1);

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("copies the source media path from conversion history to clipboard", async () => {
    const onStatus = vi.fn();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LibraryView
          settings={settings}
          onSettings={vi.fn()}
          onStatus={onStatus}
          history={[
            {
              id: "hist-copy",
              timestamp: "2026-10-01T10:00:00.000Z",
              source: "https://soundcloud.com/project-aspyr/test-track",
              fileName: "test-track.mp3",
              exportPath: "D:\\JaneConverter\\converted\\test-track.mp3",
              presetName: "Preserve Quality",
              formatLabel: "MP3",
              qualityLabel: "320 kbps",
              elapsedMs: 1200,
              status: "succeeded",
            },
          ]}
        />,
      );
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "History")?.click();
      await Promise.resolve();
    });

    const copyBtn = container.querySelector('button[aria-label="Copy source path for test-track.mp3"]');
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      (copyBtn as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenCalledWith("https://soundcloud.com/project-aspyr/test-track");
    expect(onStatus).toHaveBeenCalledWith("Copied source path to clipboard.");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("paginates conversion history to 20 items per page", async () => {
    const manyHistory = Array.from({ length: 25 }, (_, i) => ({
      id: `hist-item-${i + 1}`,
      timestamp: "2026-10-01T10:00:00.000Z",
      source: `https://example.com/item-${i + 1}`,
      fileName: `song_${String(i + 1).padStart(2, "0")}.mp3`,
      exportPath: `D:\\JaneConverter\\converted\\song_${String(i + 1).padStart(2, "0")}.mp3`,
      presetName: "Preserve Quality",
      formatLabel: "MP3",
      qualityLabel: "320 kbps",
      elapsedMs: 1000,
      status: "succeeded" as const,
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LibraryView
          settings={settings}
          onSettings={vi.fn()}
          onStatus={vi.fn()}
          history={manyHistory}
        />,
      );
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "History")?.click();
      await Promise.resolve();
    });

    // Page 1: song_01.mp3 to song_20.mp3 should be present, song_21.mp3 should not
    expect(container.textContent).toContain("song_01.mp3");
    expect(container.textContent).toContain("song_20.mp3");
    expect(container.textContent).not.toContain("song_21.mp3");
    expect(container.textContent).toContain("Showing 1–20 of 25 entries");
    expect(container.textContent).toContain("1 / 2");

    const nextBtn = container.querySelector('button[aria-label="Next history page"]');
    expect(nextBtn).not.toBeNull();

    await act(async () => {
      (nextBtn as HTMLButtonElement).click();
      await Promise.resolve();
    });

    // Page 2: song_21.mp3 to song_25.mp3 should be present, song_01.mp3 should not
    expect(container.textContent).toContain("song_21.mp3");
    expect(container.textContent).toContain("song_25.mp3");
    expect(container.textContent).not.toContain("song_01.mp3");
    expect(container.textContent).toContain("Showing 21–25 of 25 entries");
    expect(container.textContent).toContain("2 / 2");

    const prevBtn = container.querySelector('button[aria-label="Previous history page"]');
    expect(prevBtn).not.toBeNull();

    await act(async () => {
      (prevBtn as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("song_01.mp3");
    expect(container.textContent).toContain("Showing 1–20 of 25 entries");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("filters library files by audio, video, image, and metadata type", async () => {
    fakeBridge.scanLibrary.mockResolvedValue([
      {
        path: "D:\\JaneConverter\\converted\\Albums",
        name: "Albums",
        isDirectory: true,
        isPlaylist: false,
        mediaCount: 3,
        totalBytes: 3072,
        extension: "",
      },
      {
        path: "D:\\JaneConverter\\converted\\song.mp3",
        name: "song.mp3",
        isDirectory: false,
        isPlaylist: false,
        mediaCount: 1,
        totalBytes: 1024,
        extension: "MP3",
      },
      {
        path: "D:\\JaneConverter\\converted\\clip.mp4",
        name: "clip.mp4",
        isDirectory: false,
        isPlaylist: false,
        mediaCount: 1,
        totalBytes: 1024,
        extension: "MP4",
      },
      {
        path: "D:\\JaneConverter\\converted\\photo.jpg",
        name: "photo.jpg",
        isDirectory: false,
        isPlaylist: false,
        mediaCount: 1,
        totalBytes: 1024,
        extension: "JPG",
      },
      {
        path: "D:\\JaneConverter\\converted\\Albums\\metadata\\manifest.json",
        name: "manifest.json",
        isDirectory: false,
        isPlaylist: false,
        mediaCount: 1,
        totalBytes: 100,
        extension: "JSON",
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LibraryView settings={settings} onSettings={vi.fn()} onStatus={vi.fn()} />);
    });
    const selectFilter = async (label: string) => {
      await act(async () => {
        Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === label)?.click();
        await Promise.resolve();
      });
    };

    expect(container.querySelector('[aria-label="Open song.mp3"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open clip.mp4"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open photo.jpg"]')).not.toBeNull();

    await selectFilter("Images");
    expect(container.querySelector('[aria-label="Open photo.jpg"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open song.mp3"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open clip.mp4"]')).toBeNull();

    await selectFilter("Audios");
    expect(container.querySelector('[aria-label="Open song.mp3"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open photo.jpg"]')).toBeNull();

    await selectFilter("Videos");
    expect(container.querySelector('[aria-label="Open clip.mp4"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open song.mp3"]')).toBeNull();

    await selectFilter("Metadata");
    expect(container.querySelector('[aria-label="Open manifest.json"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open photo.jpg"]')).toBeNull();

    await selectFilter("All");
    expect(container.querySelector('[aria-label="Open song.mp3"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open clip.mp4"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open photo.jpg"]')).not.toBeNull();

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
