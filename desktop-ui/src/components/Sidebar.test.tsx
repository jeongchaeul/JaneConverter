import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Sidebar layout", () => {
  it("places the workspace note directly below the navigation", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Sidebar activeView="converter" onChange={vi.fn()} />);
    });

    const nav = container.querySelector("nav");
    expect(nav?.nextElementSibling?.textContent).toContain("Project-local workspace");
    expect(nav?.nextElementSibling?.className).toContain("mt-4");
    expect(nav?.nextElementSibling?.className).not.toContain("mt-auto");

    // The compressed utility dock contains Hardware, Settings, and Collapse sidebar
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    const toolbarButtons = toolbar?.querySelectorAll("button");
    expect(toolbarButtons?.item(0)?.getAttribute("aria-label")).toBe("Hardware & Pipeline");
    expect(toolbarButtons?.item(1)?.getAttribute("aria-label")).toBe("Settings");
    expect(toolbarButtons?.item(2)?.getAttribute("aria-label")).toBe("Collapse sidebar");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("collapses to an icon rail and restores the full navigation", async () => {
    window.localStorage.removeItem("janecoverter.sidebar.collapsed");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Sidebar activeView="converter" onChange={vi.fn()} />);
    });

    const aside = container.querySelector("aside");
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]');
    expect(aside?.dataset.collapsed).toBe("false");
    expect(toggle).not.toBeNull();

    await act(async () => { toggle?.click(); });
    expect(aside?.dataset.collapsed).toBe("true");
    expect(container.querySelector('button[aria-label="Expand sidebar"]')).not.toBeNull();
    expect(container.querySelector('button[title="Converted library"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Project-local workspace");

    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]')?.click(); });
    expect(aside?.dataset.collapsed).toBe("false");
    expect(container.textContent).toContain("Project-local workspace");
    expect(window.localStorage.getItem("janecoverter.sidebar.collapsed")).toBe("false");

    await act(async () => { root.unmount(); });
    window.localStorage.removeItem("janecoverter.sidebar.collapsed");
    container.remove();
  });

  it("handles clicking compressed utility buttons and applies glass styling", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <Sidebar
          activeView="hardware"
          onChange={handleChange}
          sidebarColor="#12071a"
          sidebarOpacity={50}
        />
      );
    });

    const aside = container.querySelector("aside");
    expect(aside?.getAttribute("style")).toContain("rgba(18, 7, 26, 0.5)");

    const hardwareBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Hardware & Pipeline"]');
    const settingsBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    expect(hardwareBtn?.getAttribute("aria-current")).toBe("page");
    expect(settingsBtn?.getAttribute("aria-current")).toBeNull();

    await act(async () => {
      settingsBtn?.click();
    });
    expect(handleChange).toHaveBeenCalledWith("settings");

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
