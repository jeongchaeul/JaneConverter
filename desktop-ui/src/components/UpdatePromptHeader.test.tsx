import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { UpdatePromptHeader } from "./UpdatePromptHeader";
import type { UpdateCheckResult } from "../bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("UpdatePromptHeader", () => {
  it("renders when an update is available and not dismissed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onOpenChanges = vi.fn();
    const onDismiss = vi.fn();

    const mockResult: UpdateCheckResult = {
      message: "Update available",
      repo: {
        has_update: true,
        current_commit: "1111111",
        latest_commit: "4328840",
        commits_behind: 3,
        commits: ["4328840 fix: update header", "2222222 fix: browse loop"],
      },
    };

    await act(async () => {
      root.render(
        <UpdatePromptHeader
          updateResult={mockResult}
          dismissed={false}
          onOpenChanges={onOpenChanges}
          onDismiss={onDismiss}
        />
      );
    });

    expect(container.textContent).toContain("Update available");
    expect(container.textContent).toContain("build 4328840");
    expect(container.textContent).toContain("3 new commits pushed");

    const viewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("View brief changes")
    );
    expect(viewBtn).toBeDefined();

    await act(async () => {
      viewBtn?.click();
    });
    expect(onOpenChanges).toHaveBeenCalledTimes(1);

    const dismissBtn = container.querySelector('button[aria-label="Dismiss update notice"]');
    expect(dismissBtn).toBeDefined();
    await act(async () => {
      (dismissBtn as HTMLButtonElement)?.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("does not render when dismissed or when no update exists", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const mockResultNoUpdate: UpdateCheckResult = {
      message: "Up to date",
      repo: { has_update: false },
    };

    await act(async () => {
      root.render(
        <UpdatePromptHeader
          updateResult={mockResultNoUpdate}
          dismissed={false}
          onOpenChanges={vi.fn()}
          onDismiss={vi.fn()}
        />
      );
    });
    expect(container.textContent).toBe("");

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
