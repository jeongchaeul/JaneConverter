import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const updateCheck = vi.hoisted(() => ({ run: vi.fn() }));
const installUpdate = vi.hoisted(() => ({ run: vi.fn() }));
const relaunch = vi.hoisted(() => ({ run: vi.fn() }));
const chooseFolder = vi.hoisted(() => ({ run: vi.fn() }));
const setDataRoot = vi.hoisted(() => ({ run: vi.fn() }));
const sourceRuntime = { mode: "tauri", pythonReady: true, ffmpegReady: true, ffmpegPath: "/usr/bin/ffmpeg", pythonPath: ".venv/bin/python3", dataRoot: ".", projectRoot: ".", gpuAvailable: false, gpuLabel: "CPU mode", packaged: false } as const;
vi.mock("../bridge", () => ({
  bridge: {
    checkUpdates: updateCheck.run,
    installUpdate: installUpdate.run,
    relaunch: relaunch.run,
    chooseFolder: chooseFolder.run,
    setDataRoot: setDataRoot.run,
    getChromiumCookiePolicy: vi.fn().mockResolvedValue(false),
    setChromiumCookiePolicy: vi.fn().mockImplementation(async (v) => v),
  },
}));

describe("Settings updates", () => {
  beforeEach(() => {
    updateCheck.run.mockReset();
    installUpdate.run.mockReset();
    updateCheck.run.mockResolvedValue({ message: "Update check complete. JaneConverter is up to date." });
    relaunch.run.mockResolvedValue(undefined);
    chooseFolder.run.mockReset();
    setDataRoot.run.mockReset();
  });

  it("shows the update result inside Settings", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView runtime={sourceRuntime} onStatus={vi.fn()} initialTab="system" />);
    });

    const check = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Check now"));
    expect(check).toBeDefined();
    await act(async () => {
      check?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Update check complete");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("lets the user dismiss an application update and check again", async () => {
    const available = {
      message: "Update check complete. JaneConverter update available: v2.2.0 -> v2.3.0.",
      repo: {
        has_update: true,
        current_version: "2.2.0",
        latest_version: "2.3.0",
        installer_available: true,
        release_url: "https://github.com/janecerys/JaneConverter/releases/tag/v2.3.0",
      },
    };
    updateCheck.run.mockReset();
    updateCheck.run.mockResolvedValue(available);
    installUpdate.run.mockResolvedValue(undefined);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<SettingsView runtime={sourceRuntime} onStatus={vi.fn()} initialTab="system" />); });

    const check = () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Check now"));
    await act(async () => { check()?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain("JaneConverter v2.3.0 is available");
    expect(container.textContent).toContain("Update now");
    expect(container.textContent).toContain("Not now");

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Not now")?.click();
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("JaneConverter v2.3.0 is available");

    await act(async () => { check()?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain("Update now");
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Update now")?.click();
      await Promise.resolve();
    });
    expect(installUpdate.run).toHaveBeenCalledWith();

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("offers a relaunch action for the current desktop application", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView runtime={sourceRuntime} onStatus={vi.fn()} initialTab="hardware" />);
    });

    const relaunchButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Relaunch now"));
    expect(relaunchButton).toBeDefined();
    await act(async () => {
      relaunchButton?.click();
      await Promise.resolve();
    });

    expect(relaunch.run).toHaveBeenCalled();

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("changes the application data root and relaunches", async () => {
    chooseFolder.run.mockResolvedValue("E:/JaneConverterData");
    setDataRoot.run.mockResolvedValue("E:/JaneConverterData");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView runtime={{ ...sourceRuntime, dataRoot: "C:/Users/User/AppData/Local/JaneConverter" }} onStatus={vi.fn()} initialTab="hardware" />);
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Browse")?.click();
      await Promise.resolve();
    });
    expect(chooseFolder.run).toHaveBeenCalled();

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Apply and relaunch"))?.click();
      await Promise.resolve();
    });

    expect(setDataRoot.run).toHaveBeenCalledWith("E:/JaneConverterData");
    expect(relaunch.run).toHaveBeenCalled();
    expect(container.textContent).toContain("Data root changed to E:/JaneConverterData.");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("identifies production packages and keeps relaunch available", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView runtime={{ mode: "tauri", pythonReady: true, ffmpegReady: true, ffmpegPath: "resources/runtime/bin/ffmpeg", pythonPath: "resources/runtime/engine/JaneConverterEngine", dataRoot: "/home/user/.local/share/JaneConverter", projectRoot: "resources/runtime", gpuAvailable: false, gpuLabel: "CPU mode", packaged: true }} onStatus={vi.fn()} initialTab="hardware" />);
    });

    expect(container.textContent).toContain("Running from a production package");
    expect(container.textContent).toContain("Relaunch now");
    expect(container.textContent).toContain("OS user-data directory");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("triggers accent and background color changes from pickers and reset button", async () => {
    const onAccentColorChange = vi.fn();
    const onBgColorChange = vi.fn();
    const onResetColors = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SettingsView
          runtime={sourceRuntime}
          accentColor="#c52b68"
          bgColor="#02000a"
          onAccentColorChange={onAccentColorChange}
          onBgColorChange={onBgColorChange}
          onResetColors={onResetColors}
          onStatus={vi.fn()}
          initialTab="theme"
        />,
      );
    });

    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    const accentPicker = container.querySelector<HTMLInputElement>('input[aria-label="Accent color picker"]');
    expect(accentPicker).toBeDefined();
    await act(async () => {
      if (accentPicker) {
        setNativeValue?.call(accentPicker, "#06b6d4");
        accentPicker.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await Promise.resolve();
    });
    expect(onAccentColorChange).toHaveBeenCalledWith("#06b6d4");

    const bgPicker = container.querySelector<HTMLInputElement>('input[aria-label="Theme background color picker"]');
    expect(bgPicker).toBeDefined();
    await act(async () => {
      if (bgPicker) {
        setNativeValue?.call(bgPicker, "#09090b");
        bgPicker.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await Promise.resolve();
    });
    expect(onBgColorChange).toHaveBeenCalledWith("#09090b");

    // Also test swatch click
    const cyanSwatch = Array.from(container.querySelectorAll("button")).find((button) => button.getAttribute("title")?.includes("Cyber Cyan"));
    expect(cyanSwatch).toBeDefined();
    await act(async () => {
      cyanSwatch?.click();
      await Promise.resolve();
    });
    expect(onAccentColorChange).toHaveBeenCalledWith("#06b6d4");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Appearance"));
    expect(saveButton).toBeDefined();

    const resetButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Reset Appearance"));
    expect(resetButton).toBeDefined();
    await act(async () => {
      resetButton?.click();
      await Promise.resolve();
    });
    expect(onResetColors).toHaveBeenCalled();

    await act(async () => { root.unmount(); });
    container.remove();
  });
  it("toggles Adaptive GPU Acceleration and shows the foolproof explanation", async () => {
    const onSettings = vi.fn();
    const onStatus = vi.fn();
    const initialSettings = {
      category: "Audio" as const,
      format: "MP3",
      bitrate: "320k",
      sampleRate: 48000,
      resolution: "original",
      outputDir: "./converted",
      fetchedDir: "./fetched",
      retries: 2,
      useGpu: false,
      saveCover: false,
      saveMetadata: true,
      normalize: false,
      cookiesBrowser: "none",
      cookiesFile: "",
      cookies: "",
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SettingsView
          runtime={{ ...sourceRuntime, gpuAvailable: true, gpuLabel: "NVIDIA GeForce RTX 5060" }}
          settings={initialSettings}
          onSettings={onSettings}
          onStatus={onStatus}
          initialTab="hardware"
        />,
      );
    });

    expect(container.textContent).toContain("Adaptive GPU Acceleration");
    expect(container.textContent).toContain("1. Speeds up video encoding");
    expect(container.textContent).toContain("2. Skips when not needed");
    expect(container.textContent).toContain("3. Automatic CPU safety net");

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Adaptive GPU Acceleration"]');
    expect(toggle).toBeDefined();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(onSettings).toHaveBeenCalledWith({ ...initialSettings, useGpu: true });
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("Adaptive GPU Acceleration enabled"));

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("toggles readBrowserCookies and shows detailed explanations for ON and OFF states", async () => {
    const onSettings = vi.fn();
    const onStatus = vi.fn();
    const initialSettings = {
      category: "Audio" as const,
      format: "MP3",
      bitrate: "320k",
      sampleRate: 48000,
      resolution: "original",
      outputDir: "./converted",
      fetchedDir: "./fetched",
      retries: 2,
      useGpu: false,
      saveCover: false,
      saveMetadata: true,
      normalize: false,
      readBrowserCookies: false,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SettingsView
          runtime={sourceRuntime}
          settings={initialSettings}
          onSettings={onSettings}
          onStatus={onStatus}
        />,
      );
    });

    expect(container.textContent).toContain("Read Browser Cookies (Session Recovery)");
    expect(container.textContent).toContain("Disabled (Air-Gap Mode)");
    expect(container.textContent).toContain("What works when disabled");
    expect(container.textContent).toContain("What won't work when disabled");
    expect(container.textContent).toContain("Friends-only Facebook Reels & posts");

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Read browser cookies for session recovery"]');
    expect(toggle).toBeDefined();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(onSettings).toHaveBeenCalledWith({ ...initialSettings, readBrowserCookies: true });
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("Browser session cookie reading enabled"));

    // Now render with readBrowserCookies: true
    await act(async () => {
      root.render(
        <SettingsView
          runtime={sourceRuntime}
          settings={{ ...initialSettings, readBrowserCookies: true }}
          onSettings={onSettings}
          onStatus={onStatus}
        />,
      );
    });

    expect(container.textContent).toContain("Enabled (Session Recovery)");
    expect(container.textContent).toContain("What works when enabled");
    expect(container.textContent).toContain("Local-only privacy guarantees");
    expect(container.textContent).toContain("RAM only (ephemeral)");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('toggles Direct Edge and Chrome Cookie Access policy', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onStatus = vi.fn();

    await act(async () => {
      root.render(<SettingsView runtime={sourceRuntime} onStatus={onStatus} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Direct Edge & Chrome Cookie Access');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Direct Edge & Chrome Cookie Access"]');
    expect(toggle).toBeDefined();
    expect(toggle?.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Direct Edge & Chrome cookie access enabled'));

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('renders the User Manual guide and allows tab navigation', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<SettingsView runtime={sourceRuntime} onStatus={vi.fn()} initialTab="guide" />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('User Manual & Quick Reference');
    expect(container.textContent).toContain('Quick Start: Convert in 3 Steps');
    expect(container.textContent).toContain('Supported Platforms & What They Do');
    expect(container.textContent).toContain('Getting Started');
    expect(container.textContent).toContain('Story Capturer');

    // Navigate to FL Studio Downgrader sub-page
    const flpTab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('FL Studio Downgrader'));
    expect(flpTab).toBeTruthy();
    await act(async () => {
      flpTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('FL Studio (.flp) Project Downgrader');

    // Navigate to Presets & FAQ sub-page
    const faqTab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Presets & FAQ'));
    expect(faqTab).toBeTruthy();
    await act(async () => {
      faqTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Presets & Format Cheat Sheet');
    expect(container.textContent).toContain('Quick Troubleshooting & FAQ');

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('manages custom wallpaper, blur slider, color mask, and mask opacity in appearance settings', async () => {
    const onBgModeChange = vi.fn();
    const onWallpaperChange = vi.fn();
    const onWallpaperBlurChange = vi.fn();
    const onWallpaperMaskColorChange = vi.fn();
    const onWallpaperMaskOpacityChange = vi.fn();
    const onSaveAppearance = vi.fn();
    const onResetAppearance = vi.fn();
    const onStatus = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SettingsView
          runtime={sourceRuntime}
          accentColor="#c52b68"
          bgColor="#02000a"
          bgMode="wallpaper"
          wallpaper="data:image/svg+xml;utf8,<svg></svg>"
          wallpaperBlur={35}
          wallpaperMaskColor="#12071a"
          wallpaperMaskOpacity={65}
          onBgModeChange={onBgModeChange}
          onWallpaperChange={onWallpaperChange}
          onWallpaperBlurChange={onWallpaperBlurChange}
          onWallpaperMaskColorChange={onWallpaperMaskColorChange}
          onWallpaperMaskOpacityChange={onWallpaperMaskOpacityChange}
          onSaveAppearance={onSaveAppearance}
          onResetAppearance={onResetAppearance}
          onStatus={onStatus}
          initialTab="theme"
        />,
      );
      await Promise.resolve();
    });

    // 1. Verify Wallpaper mode is active and elements exist
    expect(container.textContent).toContain('Custom Wallpaper Image');
    expect(container.textContent).toContain('Blur Effect');
    expect(container.textContent).toContain('35%');
    expect(container.textContent).toContain('Color Mask Overlay');
    expect(container.textContent).toContain('Mask Opacity');
    expect(container.textContent).toContain('65%');

    // 2. Test switching to Solid Colors
    const solidButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Solid Colors'));
    expect(solidButton).toBeDefined();
    await act(async () => {
      solidButton?.click();
      await Promise.resolve();
    });
    expect(onBgModeChange).toHaveBeenCalledWith('color');

    // 3. Test Blur Slider
    const blurSlider = container.querySelector<HTMLInputElement>('input[aria-label="Wallpaper blur slider"]');
    expect(blurSlider).toBeDefined();
    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      if (blurSlider) {
        setNativeValue?.call(blurSlider, '80');
        blurSlider.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
    });
    expect(onWallpaperBlurChange).toHaveBeenCalledWith(80);

    // 4. Test Mask Opacity Slider
    const opacitySlider = container.querySelector<HTMLInputElement>('input[aria-label="Color mask opacity slider"]');
    expect(opacitySlider).toBeDefined();
    await act(async () => {
      if (opacitySlider) {
        setNativeValue?.call(opacitySlider, '40');
        opacitySlider.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
    });
    expect(onWallpaperMaskOpacityChange).toHaveBeenCalledWith(40);

    // 5. Test Color Mask Picker
    const maskPicker = container.querySelector<HTMLInputElement>('input[aria-label="Color mask picker"]');
    expect(maskPicker).toBeDefined();
    await act(async () => {
      if (maskPicker) {
        setNativeValue?.call(maskPicker, '#070b19');
        maskPicker.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
    });
    expect(onWallpaperMaskColorChange).toHaveBeenCalledWith('#070b19');

    // 6. Test Preset Wallpaper selection
    const presetBtn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('title')?.includes('Deep Nebula'));
    expect(presetBtn).toBeDefined();
    await act(async () => {
      presetBtn?.click();
      await Promise.resolve();
    });
    expect(onWallpaperChange).toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Applied preset wallpaper: Deep Nebula'));

    // 7. Test Save Appearance button
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save Appearance'));
    expect(saveBtn).toBeDefined();
    await act(async () => {
      saveBtn?.click();
      await Promise.resolve();
    });
    expect(onSaveAppearance).toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Appearance settings saved'));

    // 8. Test Reset Appearance button
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Reset Appearance'));
    expect(resetBtn).toBeDefined();
    await act(async () => {
      resetBtn?.click();
      await Promise.resolve();
    });
    expect(onResetAppearance).toHaveBeenCalled();

    // 9. Verify helper text is placed directly under accent swatches
    expect(container.textContent).toContain('Accent highlight applies to progress bars');

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
