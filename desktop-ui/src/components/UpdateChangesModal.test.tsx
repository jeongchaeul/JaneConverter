import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { UpdateChangesModal } from "./UpdateChangesModal";
import type { UpdateCheckResult } from "../bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("UpdateChangesModal", () => {
  it("displays brief changes with commit hashes and messages", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onClose = vi.fn();
    const onInstall = vi.fn();

    const mockResult: UpdateCheckResult = {
      message: "Update available",
      repo: {
        has_update: true,
        current_commit: "1111111",
        latest_commit: "4328840",
        commits_behind: 2,
        installer_available: true,
        commits: [
          "4328840 fix(desktop-ui): prevent browse dialog loop",
          "de813ce feat(theme): add dynamic highlight glow",
        ],
      },
      engine: {
        has_update: true,
        current_version: "2026.08.19",
        latest_version: "2026.09.01",
      },
    };

    await act(async () => {
      root.render(
        <UpdateChangesModal
          open={true}
          onClose={onClose}
          updateResult={mockResult}
          onInstall={onInstall}
        />
      );
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Push updates & changes");
    expect(dialog?.textContent).toContain("4328840");
    expect(dialog?.textContent).toContain("prevent browse dialog loop");
    expect(dialog?.textContent).toContain("de813ce");
    expect(dialog?.textContent).toContain("add dynamic highlight glow");
    expect(dialog?.textContent).toContain("Extractor engine upgrade ready");

    const updateBtn = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Update now")
    );
    expect(updateBtn).toBeDefined();
    await act(async () => {
      updateBtn?.click();
    });
    expect(onInstall).toHaveBeenCalledTimes(1);

    const closeBtn = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.trim() === "Close"
    );
    await act(async () => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
