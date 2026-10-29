import { describe, expect, it, beforeEach } from "vitest";
import {
  clearAppearanceStorage,
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
});
