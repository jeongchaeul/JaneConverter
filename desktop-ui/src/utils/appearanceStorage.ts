export interface AppearanceSettings {
  theme: "dark" | "light";
  accentColor: string;
  bgColor: string;
  bgMode: "color" | "wallpaper";
  wallpaper: string;
  wallpaperBlur: number;
  wallpaperMaskColor: string;
  wallpaperMaskOpacity: number;
  sidebarColor?: string;
  sidebarOpacity?: number;
}

export function hexToRgba(hex: string, alpha: number): string {
  if (!hex) return `rgba(5, 4, 13, ${alpha})`;
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length !== 6) {
    return `rgba(5, 4, 13, ${alpha})`;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return `rgba(5, 4, 13, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const DB_NAME = "janeconverter_appearance_db";
const DB_VERSION = 1;
const STORE_NAME = "appearance_store";
const SETTINGS_KEY = "current_appearance";

function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Persists appearance settings both to IndexedDB (for large wallpaper data without quota limits)
 * and to localStorage (for fast synchronous retrieval on startup).
 * Returns true if both storage tiers succeeded, or false if storage quota/error occurred.
 */
export async function saveAppearanceToStorage(settings: AppearanceSettings): Promise<boolean> {
  let localStorageSuccess = true;
  if (typeof window !== "undefined") {
    // Save small configuration values safely with individual try/catches
    try { window.localStorage.setItem("janeconverter.theme", settings.theme); } catch { localStorageSuccess = false; }
    try { window.localStorage.setItem("janeconverter.accentColor", settings.accentColor); } catch { localStorageSuccess = false; }
    try { window.localStorage.setItem("janeconverter.bgColor", settings.bgColor); } catch { localStorageSuccess = false; }
    try { window.localStorage.setItem("janeconverter.bgMode", settings.bgMode); } catch { localStorageSuccess = false; }
    try { window.localStorage.setItem("janeconverter.wallpaperBlur", String(settings.wallpaperBlur)); } catch { localStorageSuccess = false; }
    try { window.localStorage.setItem("janeconverter.wallpaperMaskColor", settings.wallpaperMaskColor); } catch { localStorageSuccess = false; }
    try { window.localStorage.setItem("janeconverter.wallpaperMaskOpacity", String(settings.wallpaperMaskOpacity)); } catch { localStorageSuccess = false; }
    try { window.localStorage.setItem("janeconverter.sidebarColor", settings.sidebarColor ?? "#05040d"); } catch { localStorageSuccess = false; }
    try { window.localStorage.setItem("janeconverter.sidebarOpacity", String(settings.sidebarOpacity ?? 45)); } catch { localStorageSuccess = false; }

    // Clean up legacy typo keys if present
    try {
      window.localStorage.removeItem("janecoverter.wallpaper");
      window.localStorage.removeItem("janecoverter.bgMode");
    } catch {}

    // Only save wallpaper to localStorage if it fits; if it exceeds quota, IndexedDB will maintain it
    try {
      window.localStorage.setItem("janeconverter.wallpaper", settings.wallpaper);
    } catch {
      // Quota exceeded for large image in localStorage - IndexedDB is primary backing store
    }
  }

  const db = await getDB();
  if (!db) return localStorageSuccess;

  const idbSuccess = await new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(settings, SETTINGS_KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });

  return idbSuccess;
}

/**
 * Loads appearance settings from IndexedDB, falling back to localStorage if IndexedDB is empty.
 */
export async function loadAppearanceFromStorage(): Promise<Partial<AppearanceSettings> | null> {
  const db = await getDB();
  if (db) {
    const fromIdb = await new Promise<AppearanceSettings | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(SETTINGS_KEY);
        req.onsuccess = () => resolve((req.result as AppearanceSettings) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    if (fromIdb) {
      return fromIdb;
    }
  }

  // Fallback to localStorage (supports both modern janeconverter.* and legacy janecoverter.* keys)
  if (typeof window !== "undefined") {
    try {
      const getPref = (key: string) => window.localStorage.getItem(`janeconverter.${key}`) ?? window.localStorage.getItem(`janecoverter.${key}`);
      const wallpaper = getPref("wallpaper") || "";
      const bgMode = (getPref("bgMode") as "color" | "wallpaper") || "color";
      const accentColor = getPref("accentColor") || undefined;
      const bgColor = getPref("bgColor") || undefined;
      const theme = (getPref("theme") as "dark" | "light") || undefined;
      const rawBlur = getPref("wallpaperBlur");
      const wallpaperBlur = rawBlur !== null && rawBlur !== undefined ? parseInt(rawBlur, 10) : undefined;
      const wallpaperMaskColor = getPref("wallpaperMaskColor") || undefined;
      const rawOpacity = getPref("wallpaperMaskOpacity");
      const wallpaperMaskOpacity = rawOpacity !== null && rawOpacity !== undefined ? parseInt(rawOpacity, 10) : undefined;
      const sidebarColor = getPref("sidebarColor") || undefined;
      const rawSidebarOpacity = getPref("sidebarOpacity");
      const sidebarOpacity = rawSidebarOpacity !== null && rawSidebarOpacity !== undefined ? parseInt(rawSidebarOpacity, 10) : undefined;

      return {
        theme,
        accentColor,
        bgColor,
        bgMode,
        wallpaper,
        wallpaperBlur: wallpaperBlur !== undefined && !isNaN(wallpaperBlur) ? wallpaperBlur : undefined,
        wallpaperMaskColor,
        wallpaperMaskOpacity: wallpaperMaskOpacity !== undefined && !isNaN(wallpaperMaskOpacity) ? wallpaperMaskOpacity : undefined,
        sidebarColor,
        sidebarOpacity: sidebarOpacity !== undefined && !isNaN(sidebarOpacity) ? sidebarOpacity : undefined,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Clears persisted appearance settings from both storage tiers.
 */
export async function clearAppearanceStorage(): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      for (const prefix of ["janeconverter", "janecoverter"]) {
        window.localStorage.removeItem(`${prefix}.wallpaper`);
        window.localStorage.setItem(`${prefix}.bgMode`, "color");
        window.localStorage.setItem(`${prefix}.wallpaperBlur`, "20");
        window.localStorage.setItem(`${prefix}.wallpaperMaskColor`, "#000000");
        window.localStorage.setItem(`${prefix}.wallpaperMaskOpacity`, "50");
        window.localStorage.setItem(`${prefix}.sidebarColor`, "#05040d");
        window.localStorage.setItem(`${prefix}.sidebarOpacity`, "45");
      }
    } catch {}
  }

  const db = await getDB();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(SETTINGS_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
