import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { bridge, type ConverterEvent } from "./bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Application shell", () => {
  it("shows a failed history save and retries without clearing legacy data", async () => {
    const history = [{ id: "legacy", timestamp: "2026-10-04", source: "local", fileName: "song", exportPath: "out", presetName: "music", formatLabel: "MP3", qualityLabel: "high", elapsedMs: 1, status: "succeeded" }];
    window.localStorage.setItem("janecoverter.conversionHistory", JSON.stringify(history));
    const save = vi.spyOn(bridge, "conversionHistory").mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce({ history: [] });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => { root.render(<App />); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("disk full");
    expect(window.localStorage.getItem("janecoverter.conversionHistory")).not.toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[role="alert"] button')?.click(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem("janecoverter.conversionHistory")).toBeNull();
    await act(async () => { root.unmount(); });
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("suppresses the native webview context menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.firstElementChild?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("shows a photo download failure with time elapsed without suggesting another preset", async () => {
    let deliverEvent: ((event: ConverterEvent) => void) | undefined;
    vi.spyOn(bridge, "settingsGet").mockResolvedValue({
      outputDir: "converted", fetchedDir: "fetched", category: "Image", format: "source",
      bitrate: "best", sampleRate: 48000, resolution: "original", normalize: false,
      useGpu: false, saveCover: true, saveMetadata: true, retries: 2,
    });
    vi.spyOn(bridge, "subscribe").mockImplementation(async (listener) => {
      deliverEvent = listener;
      return () => {};
    });
    vi.spyOn(bridge, "startConversion").mockResolvedValue("test-job");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => { root.render(<App />); });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Source media URL or local path"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "C:\\photos\\example.jpg");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const convert = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Convert media"));
    await act(async () => { convert?.click(); await Promise.resolve(); });
    await act(async () => {
      deliverEvent?.({ jobId: "test-job", kind: "failed", message: "Conversion failed: Facebook returned an unsupported image type for photo 21." });
    });

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Conversion failed");
    expect(dialog?.textContent).toContain("unsupported image type for photo 21");
    expect(dialog?.textContent).toContain("Time elapsed:");
    expect(dialog?.textContent).toContain("photo download failed before conversion");
    expect(dialog?.textContent).not.toContain("Image → Lossless Image");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("shows the Success modal with file details, fallback note, elapsed time, and Open File / Open Path / Close actions", async () => {
    let deliverEvent: ((event: ConverterEvent) => void) | undefined;
    vi.spyOn(bridge, "settingsGet").mockResolvedValue({
      outputDir: "D:\\JaneConverter\\converted", fetchedDir: "fetched", category: "Image", format: "source",
      bitrate: "best", sampleRate: 48000, resolution: "original", normalize: false,
      useGpu: false, saveCover: true, saveMetadata: true, retries: 2,
    });
    vi.spyOn(bridge, "subscribe").mockImplementation(async (listener) => {
      deliverEvent = listener;
      return () => {};
    });
    vi.spyOn(bridge, "startConversion").mockResolvedValue("job-success");
    const openFileSpy = vi.spyOn(bridge, "openFile").mockResolvedValue();
    const openPathSpy = vi.spyOn(bridge, "openPath").mockResolvedValue();
    const notifyAttentionSpy = vi.spyOn(bridge, "notifyAttention").mockResolvedValue();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => { root.render(<App />); });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Source media URL or local path"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "C:\\photos\\sample.avif");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const convert = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Convert media"));
    await act(async () => { convert?.click(); await Promise.resolve(); });
    await act(async () => {
      deliverEvent?.({
        jobId: "job-success",
        kind: "log",
        message: "[!] Recovered from AVIF as PNG using Lossless Image fallback.",
      });
      deliverEvent?.({
        jobId: "job-success",
        kind: "finished",
        message: "Conversion finished. Your media is ready.",
        output: "\\\\?\\D:\\JaneConverter\\converted\\Images\\Local Files\\sample.png",
      });
    });

    expect(notifyAttentionSpy).toHaveBeenCalledTimes(1);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Success");
    expect(dialog?.textContent).toContain("sample.png");
    expect(dialog?.textContent).toContain("PNG (Fallback)");
    expect(dialog?.textContent).toContain("Lossless Image Fallback");
    expect(dialog?.textContent).toContain("Forced fallback to PNG");
    expect(dialog?.textContent).toContain("Time elapsed:");
    expect(dialog?.textContent).toContain("D:\\JaneConverter\\converted\\Images\\Local Files\\sample.png");

    const dragLibraryFileSpy = vi.spyOn(bridge, "dragLibraryFile").mockResolvedValue();
    const openFileBtn = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) => b.textContent?.includes("Open File"));
    const openPathBtn = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) => b.textContent?.includes("Open Path"));
    const dragFileBtn = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) => b.textContent?.includes("Drag File"));
    const closeBtn = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) => b.textContent?.trim() === "Close");

    expect(dragFileBtn?.draggable).toBe(true);
    const exportedCard = dialog?.querySelector('[title*="Drag this file into another app"]');
    expect(exportedCard?.getAttribute("draggable")).toBe("true");

    await act(async () => {
      dragFileBtn?.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
      openFileBtn?.click();
      openPathBtn?.click();
      await Promise.resolve();
    });
    expect(dragLibraryFileSpy).toHaveBeenCalledWith("D:\\JaneConverter\\converted\\Images\\Local Files\\sample.png");
    expect(openFileSpy).toHaveBeenCalledWith("D:\\JaneConverter\\converted\\Images\\Local Files\\sample.png");
    expect(openPathSpy).toHaveBeenCalledWith("D:\\JaneConverter\\converted\\Images\\Local Files\\sample.png");

    await act(async () => {
      closeBtn?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("keeps Convert media disabled across tab switches and supports Pause/Resume and Abort while a Facebook photo capture is running", async () => {
    let rejectCapture: ((err: Error) => void) | undefined;
    vi.spyOn(bridge, "settingsGet").mockResolvedValue({
      outputDir: "converted", fetchedDir: "fetched", category: "Image", format: "png",
      bitrate: "best", sampleRate: 48000, resolution: "original", normalize: false,
      useGpu: false, saveCover: true, saveMetadata: true, retries: 2,
    });
    vi.spyOn(bridge, "subscribe").mockResolvedValue(() => {});
    vi.spyOn(bridge, "captureFacebookAlbum").mockImplementation(
      () => new Promise((_resolve, reject) => { rejectCapture = reject; }),
    );
    const cancelFbSpy = vi.spyOn(bridge, "cancelFacebookAlbum").mockImplementation(async () => {
      rejectCapture?.(new Error("Facebook photo capture cancelled."));
    });
    const pauseSpy = vi.spyOn(bridge, "pauseConversion").mockResolvedValue();
    const resumeSpy = vi.spyOn(bridge, "resumeConversion").mockResolvedValue();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => { root.render(<App />); });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Source media URL or local path"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "https://www.facebook.com/share/p/1CM6D95MyA/");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const convertBtn = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Convert media"));
    await act(async () => {
      convertBtn?.click();
      await Promise.resolve();
    });

    expect(convertBtn?.disabled).toBe(true);

    // Switch to Console tab and back to Converter tab
    const consoleNav = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Console"));
    await act(async () => { consoleNav?.click(); await Promise.resolve(); });

    const converterNav = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Converter"));
    await act(async () => { converterNav?.click(); await Promise.resolve(); });

    // Convert button must still be disabled after switching tabs
    expect(convertBtn?.disabled).toBe(true);

    // Pause and Resume
    const pauseBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Pause operation"]');
    expect(pauseBtn).not.toBeNull();
    await act(async () => { pauseBtn?.click(); await Promise.resolve(); });
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    const resumeBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Resume operation"]');
    expect(resumeBtn).not.toBeNull();
    await act(async () => { resumeBtn?.click(); await Promise.resolve(); });
    expect(resumeSpy).toHaveBeenCalledTimes(1);

    // Abort operation
    const abortBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Abort operation"]');
    expect(abortBtn).not.toBeNull();
    await act(async () => { abortBtn?.click(); await Promise.resolve(); });
    expect(cancelFbSpy).toHaveBeenCalledTimes(1);

    // Once aborted, Convert media becomes clickable again
    expect(convertBtn?.disabled).toBe(false);

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
