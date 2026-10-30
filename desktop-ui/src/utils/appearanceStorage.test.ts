import { describe, expect, it, beforeEach } from "vitest";
import {
  clearAppearanceStorage,
  hexToRgba,
  loadAppearanceFromStorage,
  saveAppearanceToStorage,
  type AppearanceSettings,
} from "./appearanceStorage";

describe("appearanceStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves and loads appearance settings from storage", async () => {
    const mockSettings: AppearanceSettings = {
      theme: "dark",
      accentColor: "#f43f5e",
      bgColor: "#09090b",
      bgMode: "wallpaper",
      wallpaper: "data:image/webp;base64,mockwallpaperdata",
      wallpaperBlur: 45,
      wallpaperMaskColor: "#12071a",
      wallpaperMaskOpacity: 75,
      sidebarColor: "#110b1a",
      sidebarOpacity: 40,
    };

    await saveAppearanceToStorage(mockSettings);

    const loaded = await loadAppearanceFromStorage();
    expect(loaded).toBeDefined();
    expect(loaded?.accentColor).toBe("#f43f5e");
    expect(loaded?.bgMode).toBe("wallpaper");
    expect(loaded?.wallpaper).toBe("data:image/webp;base64,mockwallpaperdata");
    expect(loaded?.wallpaperBlur).toBe(45);
    expect(loaded?.wallpaperMaskColor).toBe("#12071a");
    expect(loaded?.wallpaperMaskOpacity).toBe(75);
    expect(loaded?.sidebarColor).toBe("#110b1a");
    expect(loaded?.sidebarOpacity).toBe(40);
  });

  it("handles clearing appearance storage back to defaults", async () => {
    const mockSettings: AppearanceSettings = {
      theme: "light",
      accentColor: "#06b6d4",
      bgColor: "#ffffff",
      bgMode: "wallpaper",
      wallpaper: "data:image/png;base64,somecustomimage",
      wallpaperBlur: 30,
      wallpaperMaskColor: "#000000",
      wallpaperMaskOpacity: 50,
    };

    await saveAppearanceToStorage(mockSettings);
    await clearAppearanceStorage();

    const loaded = await loadAppearanceFromStorage();
    // After clearing, wallpaper should be empty and bgMode back to color
    expect(loaded?.wallpaper).toBe("");
    expect(loaded?.bgMode).toBe("color");
  });

  it("converts hex colors to rgba strings with alpha", () => {
    expect(hexToRgba("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
    expect(hexToRgba("#05040d", 0.45)).toBe("rgba(5, 4, 13, 0.45)");
    expect(hexToRgba("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
    expect(hexToRgba("invalid", 0.5)).toBe("rgba(5, 4, 13, 0.5)");
  });
});
