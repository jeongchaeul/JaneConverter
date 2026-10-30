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
 */
export async function saveAppearanceToStorage(settings: AppearanceSettings): Promise<void> {
  if (typeof window !== "undefined") {
    // Save small configuration values safely with individual try/catches
    try { window.localStorage.setItem("janecoverter.theme", settings.theme); } catch {}
    try { window.localStorage.setItem("janecoverter.accentColor", settings.accentColor); } catch {}
    try { window.localStorage.setItem("janecoverter.bgColor", settings.bgColor); } catch {}
    try { window.localStorage.setItem("janecoverter.bgMode", settings.bgMode); } catch {}
    try { window.localStorage.setItem("janecoverter.wallpaperBlur", String(settings.wallpaperBlur)); } catch {}
    try { window.localStorage.setItem("janecoverter.wallpaperMaskColor", settings.wallpaperMaskColor); } catch {}
    try { window.localStorage.setItem("janecoverter.wallpaperMaskOpacity", String(settings.wallpaperMaskOpacity)); } catch {}
    try { window.localStorage.setItem("janecoverter.sidebarColor", settings.sidebarColor ?? "#05040d"); } catch {}
    try { window.localStorage.setItem("janecoverter.sidebarOpacity", String(settings.sidebarOpacity ?? 45)); } catch {}

    // Only save wallpaper to localStorage if it fits; if it exceeds quota, IndexedDB will maintain it
    try {
      window.localStorage.setItem("janecoverter.wallpaper", settings.wallpaper);
    } catch {
      // Ignored: quota exceeded for large image in localStorage
    }
  }

  const db = await getDB();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(settings, SETTINGS_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
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

  // Fallback to localStorage
  if (typeof window !== "undefined") {
    try {
      const wallpaper = window.localStorage.getItem("janecoverter.wallpaper") || "";
      const bgMode = (window.localStorage.getItem("janecoverter.bgMode") as "color" | "wallpaper") || "color";
      const accentColor = window.localStorage.getItem("janecoverter.accentColor") || undefined;
      const bgColor = window.localStorage.getItem("janecoverter.bgColor") || undefined;
      const theme = (window.localStorage.getItem("janecoverter.theme") as "dark" | "light") || undefined;
      const rawBlur = window.localStorage.getItem("janecoverter.wallpaperBlur");
      const wallpaperBlur = rawBlur !== null ? parseInt(rawBlur, 10) : undefined;
      const wallpaperMaskColor = window.localStorage.getItem("janecoverter.wallpaperMaskColor") || undefined;
      const rawOpacity = window.localStorage.getItem("janecoverter.wallpaperMaskOpacity");
      const wallpaperMaskOpacity = rawOpacity !== null ? parseInt(rawOpacity, 10) : undefined;
      const sidebarColor = window.localStorage.getItem("janecoverter.sidebarColor") || undefined;
      const rawSidebarOpacity = window.localStorage.getItem("janecoverter.sidebarOpacity");
      const sidebarOpacity = rawSidebarOpacity !== null ? parseInt(rawSidebarOpacity, 10) : undefined;

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
      window.localStorage.removeItem("janecoverter.wallpaper");
      window.localStorage.setItem("janecoverter.bgMode", "color");
      window.localStorage.setItem("janecoverter.wallpaperBlur", "20");
      window.localStorage.setItem("janecoverter.wallpaperMaskColor", "#000000");
      window.localStorage.setItem("janecoverter.wallpaperMaskOpacity", "50");
      window.localStorage.setItem("janecoverter.sidebarColor", "#05040d");
      window.localStorage.setItem("janecoverter.sidebarOpacity", "45");
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
