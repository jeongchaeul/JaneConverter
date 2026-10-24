import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistCatalog } from "../bridge";
import { PlaylistDialog } from "./PlaylistDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalog: PlaylistCatalog = {
  title: "Test playlist",
  items: [
    { index: 1, title: "First track", artist: "Artist", duration: "1:00", url: "https://example.test/1" },
    { index: 2, title: "Second track", artist: "Artist", duration: "2:00", url: "https://example.test/2" },
  ],
};

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

describe("PlaylistDialog", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }),
    });
  });

  afterEach(() => {
    if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  });

  it("opens as a native modal and restores focus when closed", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PlaylistDialog catalog={catalog} onClose={vi.fn()} onConfirm={vi.fn()} />);
    });

    const dialog = container.querySelector("dialog");
    expect(dialog?.open).toBe(true);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();

    await act(async () => { root.unmount(); });

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
    opener.remove();
    container.remove();
  });

  it("routes Escape through the close callback without leaving stale dialog state", async () => {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PlaylistDialog catalog={catalog} onClose={onClose} onConfirm={vi.fn()} />);
    });

    const dialog = container.querySelector("dialog");
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => { dialog?.dispatchEvent(cancel); });

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("calls onQueue when Add playlist to queue is clicked", async () => {
    const onQueue = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PlaylistDialog catalog={catalog} onClose={vi.fn()} onQueue={onQueue} />);
    });

    const queueButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent?.includes("Add playlist to queue"));
    expect(queueButton).toBeDefined();

    await act(async () => {
      queueButton?.click();
    });

    expect(onQueue).toHaveBeenCalledWith("1,2", catalog);
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("displays Save track selection and respects initialIndexes when isQueuedItem is true", async () => {
    const onQueue = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PlaylistDialog
          catalog={catalog}
          onClose={vi.fn()}
          onQueue={onQueue}
          initialIndexes="2"
          isQueuedItem={true}
        />
      );
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent?.includes("Save track selection"));
    expect(saveButton).toBeDefined();

    await act(async () => {
      saveButton?.click();
    });

    expect(onQueue).toHaveBeenCalledWith("2", catalog);
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("adapts labels for story collections and passes selected preset on confirm", async () => {
    const onConfirm = vi.fn();
    const storyCatalog: PlaylistCatalog = {
      title: "Story by shinchewieeee",
      items: [
        { index: 1, title: "Story 1", artist: "shinchewieeee", duration: "0:15", url: "https://example.test/s1" },
        { index: 2, title: "Story 2", artist: "shinchewieeee", duration: "0:15", url: "https://example.test/s2" },
      ],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PlaylistDialog
          catalog={storyCatalog}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />
      );
    });

    expect(container.textContent).toContain("2 of 2 items selected");
    const convertBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Convert selected stories")
    );
    expect(convertBtn).toBeDefined();

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Target conversion preset"]');
    expect(select).toBeDefined();
    await act(async () => {
      if (select) {
        select.value = "universal-video";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    await act(async () => {
      convertBtn?.click();
    });

    expect(onConfirm).toHaveBeenCalledWith(
      "1,2",
      expect.objectContaining({ id: "universal-video", format: "mp4" })
    );
    await act(async () => { root.unmount(); });
    container.remove();
  });
});
