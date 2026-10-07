import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlpConverterView } from "./FlpConverterView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bridge = vi.hoisted(() => ({
  chooseFlpFile: vi.fn(),
  flpInspect: vi.fn(),
  flpDowngrade: vi.fn(),
  openPath: vi.fn(),
  openFile: vi.fn(),
}));

vi.mock("../bridge", () => ({ bridge }));

describe("FlpConverterView", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  it("renders dropzone and browse button", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<FlpConverterView onStatus={vi.fn()} />);
    });

    expect(container.textContent).toContain("Drag & drop an FL Studio project (.flp)");
    expect(container.textContent).toContain("Browse .flp file");
  });

  it("inspects project and renders project details", async () => {
    bridge.chooseFlpFile.mockResolvedValue("D:\\Projects\\TestProject.flp");
    bridge.flpInspect.mockResolvedValue({
      filePath: "D:\\Projects\\TestProject.flp",
      fileName: "TestProject.flp",
      fileSize: 1048576,
      version: "25.1.0.4000",
      majorVersion: 25,
      title: "Test Track",
      bpm: 175.0,
      ppq: 96,
      channels: 24,
      registered: true,
      registrationName: "Jane Cerys",
      eventsCount: 1500,
    });

    const root = createRoot(container);
    act(() => {
      root.render(<FlpConverterView onStatus={vi.fn()} />);
    });

    const browseBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Browse .flp file"),
    );
    expect(browseBtn).toBeDefined();

    await act(async () => {
      browseBtn?.click();
    });

    expect(bridge.chooseFlpFile).toHaveBeenCalled();
    expect(bridge.flpInspect).toHaveBeenCalledWith("D:\\Projects\\TestProject.flp");
    expect(container.textContent).toContain("Test Track");
    expect(container.textContent).toContain("175 BPM");
    expect(container.textContent).toContain("96 PPQ");
    expect(container.textContent).toContain("24 Channels");
    expect(container.textContent).toContain("Producer Licensed");
  });

  it("downgrades project and displays result card", async () => {
    bridge.chooseFlpFile.mockResolvedValue("D:\\Projects\\TestProject.flp");
    bridge.flpInspect.mockResolvedValue({
      filePath: "D:\\Projects\\TestProject.flp",
      fileName: "TestProject.flp",
      fileSize: 1048576,
      version: "25.1.0.4000",
      majorVersion: 25,
      title: "Test Track",
      bpm: 140.0,
      ppq: 96,
      channels: 12,
      registered: true,
      registrationName: "Jane Cerys",
      eventsCount: 1200,
    });
    bridge.flpDowngrade.mockResolvedValue({
      success: true,
      sourcePath: "D:\\Projects\\TestProject.flp",
      outputPath: "D:\\Projects\\TestProject_downgraded_FL24.flp",
      sourceVersion: "25.1.0.4000",
      sourceMajor: 25,
      targetVersion: "24.1.2.4398",
      targetProfile: "24",
      targetLabel: "FL Studio 24 (24.1.2)",
      recordsAdjusted: 10,
      eventsCount: 1200,
      outputSizeBytes: 1047000,
    });

    const root = createRoot(container);
    act(() => {
      root.render(<FlpConverterView onStatus={vi.fn()} />);
    });

    const browseBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Browse .flp file"),
    );

    await act(async () => {
      browseBtn?.click();
    });

    const downgradeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Downgrade to FL Studio"),
    );
    expect(downgradeBtn).toBeDefined();

    await act(async () => {
      downgradeBtn?.click();
    });

    expect(bridge.flpDowngrade).toHaveBeenCalledWith("D:\\Projects\\TestProject.flp", "24");
    expect(container.textContent).toContain("Downgraded to FL Studio 24 (24.1.2)");
    expect(container.textContent).toContain("Open in FL Studio");
    expect(container.textContent).toContain("Show in Folder");
  });
});
