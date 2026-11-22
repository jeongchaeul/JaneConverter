import type { Category, ConverterSettings, PlaylistCatalog } from "../../bridge";
import { detectCategoryFromPath, formatsFor, qualitiesFor } from "../../options";

export interface QueueItem {
  id: string;
  source: string;
  name: string;
  category: Category;
  status: "queued" | "converting" | "completed" | "failed";
  progress: number;
  outputPath?: string;
  errorMessage?: string;
  playlistIndexes?: string;
  playlistCatalog?: PlaylistCatalog;
  presetName?: string;
  settingsSnapshot?: ConverterSettings;
}

export function createQueueItems(
  paths: string[],
  fallbackCategory: Category,
  idPrefix: string = `${Date.now()}`,
  baseSettings?: ConverterSettings
): QueueItem[] {
  return paths.map((p, idx) => {
    const clean = p.trim();
    const detected = detectCategoryFromPath(clean);
    const category = detected || fallbackCategory;
    let settingsSnapshot: ConverterSettings | undefined;
    if (baseSettings) {
      const normalizedBaseCat = baseSettings.category === "Music" ? "Audio" : baseSettings.category;
      if (detected && detected !== normalizedBaseCat) {
        const formats = formatsFor(detected);
        const nextFormat = formats.includes(baseSettings.format) ? baseSettings.format : formats[0];
        const nextBitrate = qualitiesFor(nextFormat, detected)[0];
        settingsSnapshot = {
          ...baseSettings,
          category: detected,
          format: nextFormat,
          bitrate: nextBitrate,
        };
      } else {
        settingsSnapshot = { ...baseSettings };
      }
    }
    return {
      id: `${idPrefix}-${idx}`,
      source: clean,
      name: clean.replace(/^.*[\\/]/, "") || clean,
      category,
      status: "queued",
      progress: 0,
      ...(settingsSnapshot ? { settingsSnapshot } : {}),
    };
  });
}
