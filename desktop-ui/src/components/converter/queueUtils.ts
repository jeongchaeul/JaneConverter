import type { Category, ConverterSettings, PlaylistCatalog } from "../../bridge";
import { detectCategoryFromPath } from "../../options";

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
  idPrefix: string = `${Date.now()}`
): QueueItem[] {
  return paths.map((p, idx) => {
    const clean = p.trim();
    return {
      id: `${idPrefix}-${idx}`,
      source: clean,
      name: clean.replace(/^.*[\\/]/, "") || clean,
      category: detectCategoryFromPath(clean) || fallbackCategory,
      status: "queued",
      progress: 0,
    };
  });
}
