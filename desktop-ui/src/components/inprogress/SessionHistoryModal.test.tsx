import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionHistoryModal } from "./SessionHistoryModal";
import type { ConversionHistoryItem } from "../../bridge";
import type { SessionSummary } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SessionHistoryModal", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("does not render when open is false", () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <SessionHistoryModal
          open={false}
          onClose={vi.fn()}
          sessionSummaries={[]}
          onSelectSession={vi.fn()}
          catalogSessions={[]}
        />
      );
    });
    expect(container.innerHTML).toBe("");
  });

  it("paginates past conversions to 20 items per page with navigation controls", () => {
    const mockSessions: SessionSummary[] = [
      {
        id: "active-1",
        sessionNumber: 1,
        title: "Active Session 1",
        total: 10,
        completed: 5,
        failed: 0,
        active: 1,
        mediaKind: "audio",
        format: "mp3",
        isLive: true,
        isCurrent: true,
        overallProgress: 0.5,
      },
    ];

    const mockCatalog: ConversionHistoryItem[] = Array.from({ length: 25 }, (_, i) => ({
      id: `hist-${i + 1}`,
      fileName: `Item Title &#064;${i + 1}`,
      source: `https://example.com/item_${i + 1}`,
      exportPath: `D:\\path\\item_${i + 1}.png`,
      presetName: "Lossless Image",
      formatLabel: "Lossless Image",
      qualityLabel: "Lossless",
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      status: "succeeded",
      elapsedMs: 5000,
    }));

    const onSelectSession = vi.fn();
    const onRestoreSession = vi.fn();
    const onClose = vi.fn();

    const root = createRoot(container);
    act(() => {
      root.render(
        <SessionHistoryModal
          open={true}
          onClose={onClose}
          sessionSummaries={mockSessions}
          onSelectSession={onSelectSession}
          onRemoveSession={vi.fn()}
          catalogSessions={mockCatalog}
          onRestoreSession={onRestoreSession}
        />
      );
    });

    // Check Active Workspace Sessions
    expect(container.textContent).toContain("Active Workspace Sessions (1)");
    expect(container.textContent).toContain("Active Session 1");

    // Check Past Conversions header
    expect(container.textContent).toContain("Past Conversions from Library (25)");
    expect(container.textContent).toContain("Page 1 of 2");

    // HTML entities decoded
    expect(container.textContent).toContain("Item Title @1");

    // Page 1 should contain items 1 to 20, but not 21
    expect(container.textContent).toContain("Item Title @20");
    expect(container.textContent).not.toContain("Item Title @21");

    // Check pagination bar
    expect(container.textContent).toContain("Showing 1–20 of 25");

    // Find and click the 'Next' button
    const nextBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Next")
    );
    expect(nextBtn).toBeDefined();

    act(() => {
      nextBtn?.click();
    });

    // Now on Page 2
    expect(container.textContent).toContain("Page 2 of 2");
    expect(container.textContent).toContain("Showing 21–25 of 25");
    expect(container.textContent).toContain("Item Title @21");
    expect(container.textContent).toContain("Item Title @25");
    expect(container.textContent).not.toContain("Item Title @1");

    // Test restoring session from page 2
    const openRackBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Open in Rack")
    );
    expect(openRackBtn).toBeDefined();

    act(() => {
      openRackBtn?.click();
    });

    expect(onRestoreSession).toHaveBeenCalledWith(expect.objectContaining({ id: "hist-21" }));
    expect(onSelectSession).toHaveBeenCalledWith("hist-21");
    expect(onClose).toHaveBeenCalled();
  });
});
