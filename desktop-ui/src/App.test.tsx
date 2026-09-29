import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { bridge, type ConverterEvent } from "./bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Application shell", () => {
  afterEach(() => { vi.restoreAllMocks(); });

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

  it("shows an engine failure and the image preset suggestion without opening Console", async () => {
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
    expect(dialog?.textContent).toContain("Image → Lossless Image");

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
