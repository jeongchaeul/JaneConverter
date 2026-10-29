import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileAudio,
  Film,
  FolderOpen,
  GripVertical,
  History,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Music,
  Pause,
  Play,
  RefreshCw,
  Search,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { bridge, type Category, type ConverterEvent, type ConversionHistoryItem } from "../bridge";
import { formatElapsedMs } from "../options";

export type MediaKind = "audio" | "video" | "image";
export type InProgressItemStatus = "queued" | "downloading" | "transcoding" | "ready" | "failed";

export interface InProgressItem {
  id: string;
  index: number;
  total: number;
  title: string;
  artist?: string;
  mediaKind: MediaKind;
  status: InProgressItemStatus;
  progress: number; // 0 to 1
  speed?: string;
  eta?: string;
  detailMessage?: string;
  outputPath?: string;
  coverPath?: string;
  thumbnail?: string;
  errorMessage?: string;
  elapsedMs?: number;
}

export interface InProgressBatchSummary {
  title: string;
  total: number;
  completed: number;
  active: number;
  failed: number;
  queued: number;
  overallProgress: number;
  mediaKind: MediaKind;
  format?: string;
  outputDir?: string;
  coverArtPath?: string;
}

// Regex matchers for engine output streams
const PLAYLIST_ITEM_RE = /\[(\d+)\/(\d+)\]\s*(?:(?:#(\d+)|Fetching\s*#(\d+)):\s*)?(.*?)(?:\s*(?:—|-)\s*(.*))?$/;
const CONVERTED_RE = /\[\+\]\s*(?:Adapted & )?(?:Converted|Saved photo):\s*(?:(\d+)\.\s*)?(.*)/i;
const READY_RE = /Ready:\s*(?:(\d+)\.\s*)?(.*)/i;
const ERROR_RE = /\[\!\]\s*Error converting track\s*#(\d+)\s*'(.*?)':\s*(.*)/i;
const PLAYLIST_HEADER_RE = /(?:Playlist:\s*(.*)|\[\*\]\s*Found\s*(\d+)\s*tracks\s*in\s*'(.*?)')/i;
const PHOTO_ALBUM_HEADER_RE = /Found\s*(\d+)\s*photos\s*in\s*['"]?(.*?)['"]?\.\s*Starting/i;
const PHOTO_PROGRESS_RE = /Downloading\s*(?:Facebook|Instagram|Pinterest|social)?\s*photo\s*(\d+)\s*of\s*(\d+)/i;
const PHOTO_COMPLETED_RE = /(?:Downloaded|Saved)\s*(?:all\s*)?(\d+)\s*(?:public\s*)?(?:Facebook|Instagram|Pinterest)?\s*photo/i;
const COVER_ART_RE = /\[\*\]\s*Playlist Cover Art:\s*(.*)/i;
const TRACK_MANIFEST_RE = /\[\*\]\s*Track\s*#(\d+)\s*Manifest:\s*(.*?)(?:\t(.*?))?(?:\t(.*?))?$/i;
const TRACK_THUMBNAIL_RE = /\[\*\]\s*Track\s*#(\d+)\s*(?:Thumbnail|Source):\s*(.*)/i;
const TRACK_COVER_RE = /\[\*\]\s*Track\s*#(\d+)\s*Cover:\s*(.*)/i;
const PHOTO_SOURCE_RE = /\[\*\]\s*Photo\s*#(\d+)\s*Source:\s*(.*)/i;
const PHOTO_SAVED_RE = /\[\*\]\s*Photo\s*#(\d+)\s*Saved:\s*(.*)/i;
const MEDIA_THUMBNAIL_RE = /\[\*\]\s*Media\s*Thumbnail(?:\s*URL)?:\s*(.*)/i;
const TARGET_DIR_RE = /(?:Target Directory:\s*(.*)|Export Directory:\s*(.*)|DONE! Exported:\s*(.*))/i;
const SINGLE_READY_RE = /(?:Ready!\s*File exported to:\s*(.*)|DONE!\s*Exported:\s*(.*))/i;

export function extractYouTubeThumbnail(urlOrId?: string): string | undefined {
  if (!urlOrId) return undefined;
  const trimmed = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://i.ytimg.com/vi/${trimmed}/hqdefault.jpg`;
  }
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  if (match) {
    return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
  }
  return undefined;
}

export function inferMediaKind(category?: Category, format?: string, filename?: string): MediaKind {
  const target = `${category || ""} ${format || ""} ${filename || ""}`.toLowerCase();
  if (target.includes("video") || target.includes("mp4") || target.includes("mkv") || target.includes("webm") || target.includes("mov")) {
    return "video";
  }
  if (target.includes("image") || target.includes("png") || target.includes("jpg") || target.includes("jpeg") || target.includes("webp") || target.includes("photo")) {
    return "image";
  }
  return "audio";
}

export function parseConversionEvents(
  events: ConverterEvent[],
  defaultCategory?: Category,
  defaultFormat?: string,
  initialSource?: string,
  targetJobId?: string,
  isRunning = false,
): { items: InProgressItem[]; summary: InProgressBatchSummary; latestLogLine: string } {
  // 1. Filter events by active job so multiple jobs never mix together
  let scopedEvents: ConverterEvent[];
  if (targetJobId) {
    scopedEvents = events.filter((e) => e.jobId === targetJobId);
  } else {
    const jobEvents = events.filter((e) => e.jobId && e.jobId !== "ui" && e.jobId !== "browser-session");
    if (jobEvents.length > 0) {
      const lastJobId = jobEvents[jobEvents.length - 1].jobId;
      scopedEvents = jobEvents.filter((e) => e.jobId === lastJobId);
    } else {
      scopedEvents = [];
    }
  }

  let detectedTitle = initialSource || "";
  let detectedTotal = 0;
  let detectedOutputDir = "";
  let detectedCoverArt: string | undefined;
  let detectedKind: MediaKind = inferMediaKind(defaultCategory, defaultFormat, initialSource);
  const itemsMap = new Map<number, InProgressItem>();
  let latestLogLine = "";

  // Single file fallback state
  let isSingleMedia = false;
  let singleTitle = initialSource || "Media file";
  let singleThumbnail: string | undefined = extractYouTubeThumbnail(initialSource);
  let singleProgress = 0;
  let singleStatus: InProgressItemStatus = "downloading";
  let singleSpeed: string | undefined;
  let singleEta: string | undefined;
  let singleDetail = "";
  let singleError: string | undefined;
  let singleOutputPath: string | undefined;

  for (const event of scopedEvents) {
    const rawMsg = event.message.trim();
    if (!rawMsg) continue;
    latestLogLine = rawMsg;

    // 1. Detect target directory: Target Directory: <path> or Export Directory: <path> or DONE! Exported: <path>
    const dirMatch = TARGET_DIR_RE.exec(rawMsg);
    if (dirMatch) {
      const matched = (dirMatch[1] || dirMatch[2] || dirMatch[3] || "").trim();
      if (matched) {
        if (/\.[a-zA-Z0-9]{2,5}$/.test(matched)) {
          const idx = Math.max(matched.lastIndexOf("\\"), matched.lastIndexOf("/"));
          detectedOutputDir = idx > 0 ? matched.slice(0, idx) : matched;
        } else {
          detectedOutputDir = matched;
        }
      }
    }

    // 2. Detect cover art and manifest tags
    const coverMatch = COVER_ART_RE.exec(rawMsg);
    if (coverMatch) {
      detectedCoverArt = coverMatch[1].trim();
    }

    const manifestMatch = TRACK_MANIFEST_RE.exec(rawMsg);
    if (manifestMatch) {
      const mIdx = parseInt(manifestMatch[1], 10);
      const mTitle = (manifestMatch[2] || "").trim();
      const mArtist = (manifestMatch[3] || "").trim();
      const mThumb = (manifestMatch[4] || "").trim();
      if (mIdx > detectedTotal) detectedTotal = mIdx;
      let item = itemsMap.get(mIdx);
      if (!item) {
        item = {
          id: `item-${mIdx}`,
          index: mIdx,
          total: detectedTotal || mIdx,
          title: mTitle || `Track #${mIdx}`,
          artist: mArtist || undefined,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, mTitle),
          status: "queued",
          progress: 0,
          thumbnail: mThumb || undefined,
        };
        itemsMap.set(mIdx, item);
      } else {
        if (mTitle) item.title = mTitle;
        if (mArtist) item.artist = mArtist;
        if (mThumb) item.thumbnail = mThumb;
      }
      continue;
    }

    const photoSrcMatch = PHOTO_SOURCE_RE.exec(rawMsg);
    if (photoSrcMatch) {
      const pIdx = parseInt(photoSrcMatch[1], 10);
      const pUrl = photoSrcMatch[2].trim();
      if (pIdx > detectedTotal) detectedTotal = pIdx;
      detectedKind = "image";
      let item = itemsMap.get(pIdx);
      if (!item) {
        item = {
          id: `item-${pIdx}`,
          index: pIdx,
          total: detectedTotal || pIdx,
          title: `Photo #${pIdx}`,
          mediaKind: "image",
          status: "queued",
          progress: 0,
          thumbnail: pUrl,
        };
        itemsMap.set(pIdx, item);
      } else {
        item.thumbnail = pUrl;
      }
      continue;
    }

    const photoSavedMatch = PHOTO_SAVED_RE.exec(rawMsg);
    if (photoSavedMatch) {
      const pIdx = parseInt(photoSavedMatch[1], 10);
      const pPath = photoSavedMatch[2].trim();
      let item = itemsMap.get(pIdx);
      if (!item) {
        item = {
          id: `item-${pIdx}`,
          index: pIdx,
          total: detectedTotal || pIdx,
          title: `Photo #${pIdx}`,
          mediaKind: "image",
          status: "ready",
          progress: 1,
          coverPath: pPath,
          outputPath: pPath,
        };
        itemsMap.set(pIdx, item);
      } else {
        item.coverPath = pPath;
        item.outputPath = pPath;
        item.status = "ready";
        item.progress = 1;
      }
      continue;
    }

    const trackThumbMatch = TRACK_THUMBNAIL_RE.exec(rawMsg);
    if (trackThumbMatch) {
      const tIdx = parseInt(trackThumbMatch[1], 10);
      const tThumb = trackThumbMatch[2].trim();
      let item = itemsMap.get(tIdx);
      if (item) {
        item.thumbnail = tThumb;
      }
      continue;
    }

    const mediaThumbMatch = MEDIA_THUMBNAIL_RE.exec(rawMsg);
    if (mediaThumbMatch) {
      const mThumb = mediaThumbMatch[1].trim();
      if (mThumb) {
        singleThumbnail = mThumb;
        if (!detectedCoverArt) detectedCoverArt = mThumb;
      }
      continue;
    }

    const trackCoverMatch = TRACK_COVER_RE.exec(rawMsg);
    if (trackCoverMatch) {
      const tIdx = parseInt(trackCoverMatch[1], 10);
      const tPath = trackCoverMatch[2].trim();
      let item = itemsMap.get(tIdx);
      if (item) {
        item.coverPath = tPath;
      }
      continue;
    }

    // 3. Detect playlist header: Playlist: <title> or Found <n> tracks in '<title>'
    const headerMatch = PLAYLIST_HEADER_RE.exec(rawMsg);
    if (headerMatch) {
      if (headerMatch[1]) detectedTitle = headerMatch[1].trim();
      if (headerMatch[2] && headerMatch[3]) {
        detectedTotal = parseInt(headerMatch[2], 10);
        detectedTitle = headerMatch[3].trim();
      }
    }

    // 4. Detect Facebook or Social Photo Album header: Found <n> photos in '<title>'. Starting download...
    const photoHeaderMatch = PHOTO_ALBUM_HEADER_RE.exec(rawMsg);
    if (photoHeaderMatch) {
      detectedTotal = parseInt(photoHeaderMatch[1], 10);
      if (photoHeaderMatch[2]) detectedTitle = photoHeaderMatch[2].trim();
      detectedKind = "image";
    }

    // 5. Match Facebook/Social Photo progress: Downloading Facebook photo 1 of 12...
    const photoProgMatch = PHOTO_PROGRESS_RE.exec(rawMsg);
    if (photoProgMatch) {
      const curPhoto = parseInt(photoProgMatch[1], 10);
      const totPhoto = parseInt(photoProgMatch[2], 10);
      if (totPhoto > detectedTotal) detectedTotal = totPhoto;
      detectedKind = "image";

      // Mark earlier photos as ready if they haven't failed
      for (let p = 1; p < curPhoto; p++) {
        let prevItem = itemsMap.get(p);
        if (!prevItem) {
          itemsMap.set(p, {
            id: `item-${p}`,
            index: p,
            total: totPhoto,
            title: `Photo #${p}`,
            mediaKind: "image",
            status: "ready",
            progress: 1,
          });
        } else if (prevItem.status !== "failed") {
          prevItem.status = "ready";
          prevItem.progress = 1;
        }
      }

      let curItem = itemsMap.get(curPhoto);
      if (!curItem) {
        curItem = {
          id: `item-${curPhoto}`,
          index: curPhoto,
          total: totPhoto,
          title: `Photo #${curPhoto}`,
          mediaKind: "image",
          status: "downloading",
          progress: 0.5,
          detailMessage: rawMsg,
        };
        itemsMap.set(curPhoto, curItem);
      } else {
        curItem.status = "downloading";
        curItem.progress = 0.5;
        curItem.detailMessage = rawMsg;
      }
      continue;
    }

    // 6. Match photo album completion: Downloaded all 12 public Facebook photos.
    const photoDoneMatch = PHOTO_COMPLETED_RE.exec(rawMsg);
    if (photoDoneMatch) {
      const doneCount = parseInt(photoDoneMatch[1], 10);
      if (doneCount > detectedTotal) detectedTotal = doneCount;
      detectedKind = "image";
      for (let p = 1; p <= doneCount; p++) {
        let it = itemsMap.get(p);
        if (!it) {
          itemsMap.set(p, {
            id: `item-${p}`,
            index: p,
            total: doneCount,
            title: `Photo #${p}`,
            mediaKind: "image",
            status: "ready",
            progress: 1,
          });
        } else if (it.status !== "failed") {
          it.status = "ready";
          it.progress = 1;
        }
      }
      continue;
    }

    // 7. Match playlist track item log: e.g. [35/47] #35: Runaway with Peace (feat. Caylune) — Transcoding MP3: 70% (speed 90.3x)
    const pMatch = PLAYLIST_ITEM_RE.exec(rawMsg);
    if (pMatch) {
      const totalIdx = parseInt(pMatch[2], 10);
      const trackIdx = parseInt(pMatch[3] || pMatch[4] || pMatch[1], 10);
      const rawTitle = (pMatch[5] || "").replace(/\.{3}$/, "").trim();
      const detail = (pMatch[6] || "").trim();

      if (totalIdx > detectedTotal) detectedTotal = totalIdx;

      let item = itemsMap.get(trackIdx);
      if (!item) {
        item = {
          id: `item-${trackIdx}`,
          index: trackIdx,
          total: totalIdx,
          title: rawTitle || `Track #${trackIdx}`,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, rawTitle),
          status: "downloading",
          progress: 0.05,
        };
        itemsMap.set(trackIdx, item);
      } else if (rawTitle && (!item.title || item.title.startsWith("Track #"))) {
        item.title = rawTitle;
      }

      if (detail) {
        item.detailMessage = detail;
        const speedMatch = /(?:at\s+([\d\.]+\s*[KMGT]?i?B\/s)|speed\s+([\d\.]+x))/i.exec(detail);
        if (speedMatch) item.speed = speedMatch[1] || speedMatch[2];

        const etaMatch = /ETA\s+([\d:]+)/i.exec(detail);
        if (etaMatch) item.eta = etaMatch[1];

        const pctMatch = /(\d+(?:\.\d+)?)\s*%/i.exec(detail);
        const parsedPct = pctMatch ? parseFloat(pctMatch[1]) / 100 : undefined;

        if (detail.toLowerCase().includes("transcoding")) {
          item.status = "transcoding";
          if (parsedPct !== undefined) item.progress = Math.max(item.progress, parsedPct);
        } else if (detail.toLowerCase().includes("download") || detail.toLowerCase().includes("fetching")) {
          item.status = "downloading";
          if (parsedPct !== undefined) item.progress = parsedPct;
        } else if (detail.toLowerCase().includes("ready") || detail.toLowerCase().includes("converted")) {
          item.status = "ready";
          item.progress = 1;
        }
      }
      continue;
    }

    // 8. Match converted item: e.g. [+] Converted: 35. Runaway with Peace (feat. Caylune).mp3
    const convMatch = CONVERTED_RE.exec(rawMsg);
    if (convMatch) {
      const rawConverted = rawMsg.replace(/^\[\+\]\s*(?:Adapted & )?(?:Converted|Saved photo):\s*/i, "").trim();
      const idx = convMatch[1] ? parseInt(convMatch[1], 10) : undefined;
      const cleanTitle = convMatch[2].trim();
      const actualFile = rawConverted || (idx !== undefined ? `${idx}. ${cleanTitle}` : cleanTitle);
      if (idx !== undefined) {
        let item = itemsMap.get(idx);
        if (!item) {
          item = {
            id: `item-${idx}`,
            index: idx,
            total: detectedTotal || idx,
            title: cleanTitle.replace(/\.[a-zA-Z0-9]+$/, ""),
            mediaKind: inferMediaKind(defaultCategory, defaultFormat, actualFile),
            status: "ready",
            progress: 1,
            outputPath: actualFile,
          };
          itemsMap.set(idx, item);
        } else {
          item.status = "ready";
          item.progress = 1;
          item.outputPath = actualFile;
          if (!item.title || item.title.startsWith("Track #")) {
            item.title = cleanTitle.replace(/\.[a-zA-Z0-9]+$/, "");
          }
        }
      } else {
        isSingleMedia = true;
        singleTitle = cleanTitle.replace(/\.[a-zA-Z0-9]+$/, "");
        singleStatus = "ready";
        singleProgress = 1;
        if (!singleOutputPath) {
          singleOutputPath = actualFile;
        }
      }
      continue;
    }

    // 9. Match Ready: e.g. Ready: 9. am.mp3
    const readyMatch = READY_RE.exec(rawMsg);
    if (readyMatch) {
      const rawReady = rawMsg.replace(/^Ready:\s*/i, "").trim();
      const idx = readyMatch[1] ? parseInt(readyMatch[1], 10) : undefined;
      const cleanTitle = (readyMatch[2] || "").trim();
      const actualFile = rawReady || (idx !== undefined ? `${idx}. ${cleanTitle}` : cleanTitle);
      if (idx !== undefined) {
        const item = itemsMap.get(idx);
        if (item) {
          item.status = "ready";
          item.progress = 1;
          if (!item.outputPath) {
            item.outputPath = actualFile;
          }
        }
      } else {
        isSingleMedia = true;
        singleStatus = "ready";
        singleProgress = 1;
        if (!singleOutputPath) {
          singleOutputPath = actualFile;
        }
      }
      continue;
    }

    // 10. Match error: e.g. [!] Error converting track #35 'Runaway with Peace': <error>
    const errMatch = ERROR_RE.exec(rawMsg);
    if (errMatch) {
      const errIdx = parseInt(errMatch[1], 10);
      const errTitle = errMatch[2];
      const errDetail = errMatch[3];
      let item = itemsMap.get(errIdx);
      if (!item) {
        item = {
          id: `item-${errIdx}`,
          index: errIdx,
          total: detectedTotal || errIdx,
          title: errTitle || `Track #${errIdx}`,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, errTitle),
          status: "failed",
          progress: 0,
          errorMessage: errDetail,
        };
        itemsMap.set(errIdx, item);
      } else {
        item.status = "failed";
        item.errorMessage = errDetail;
      }
      continue;
    }

    // 11. Single file progress heuristics (when not in a batch)
    if (itemsMap.size === 0) {
      const singleReadyMatch = SINGLE_READY_RE.exec(rawMsg);
      if (singleReadyMatch) {
        const exportedTarget = (singleReadyMatch[1] || singleReadyMatch[2] || "").trim();
        isSingleMedia = true;
        singleStatus = "ready";
        singleProgress = 1;
        if (exportedTarget) {
          singleOutputPath = exportedTarget;
          const fname = exportedTarget.split(/[\\/]/).pop() || "";
          if (fname) {
            singleTitle = fname.replace(/\.[a-zA-Z0-9]+$/, "");
          }
        }
      } else if (rawMsg.includes("[download]") || rawMsg.includes("Downloading stream:")) {
        isSingleMedia = true;
        singleStatus = "downloading";
        const pctMatch = /(\d+(?:\.\d+)?)\s*%/i.exec(rawMsg);
        if (pctMatch) singleProgress = parseFloat(pctMatch[1]) / 100;
        const spdMatch = /at\s+([\d\.]+\s*[KMGT]?i?B\/s)/i.exec(rawMsg);
        if (spdMatch) singleSpeed = spdMatch[1];
        const etaMatch = /ETA\s+([\d:]+)/i.exec(rawMsg);
        if (etaMatch) singleEta = etaMatch[1];
        singleDetail = rawMsg;
      } else if (rawMsg.includes("Transcoding ")) {
        isSingleMedia = true;
        singleStatus = "transcoding";
        const pctMatch = /(\d+(?:\.\d+)?)\s*%/i.exec(rawMsg);
        if (pctMatch) singleProgress = parseFloat(pctMatch[1]) / 100;
        const spdMatch = /speed\s+([\d\.]+x)/i.exec(rawMsg);
        if (spdMatch) singleSpeed = spdMatch[1];
        singleDetail = rawMsg;
      } else if (rawMsg.startsWith("[!] Error") || event.kind === "failed") {
        isSingleMedia = true;
        singleStatus = "failed";
        singleError = rawMsg;
      }
    }

    if (event.kind === "finished") {
      if (itemsMap.size === 0) {
        isSingleMedia = true;
        if (singleStatus !== "failed") {
          singleStatus = "ready";
          singleProgress = 1;
        }
        if (event.output) {
          singleOutputPath = event.output;
          const fname = event.output.split(/[\\/]/).pop() || "";
          if (fname) {
            singleTitle = fname.replace(/\.[a-zA-Z0-9]+$/, "");
          }
        }
      } else {
        for (const item of itemsMap.values()) {
          if (item.status === "downloading" || item.status === "transcoding") {
            item.status = "ready";
            item.progress = 1;
          }
        }
      }
    }
  }

  // Build items array
  let items: InProgressItem[] = [];

  if (itemsMap.size > 0) {
    const maxIdx = Math.max(detectedTotal, ...Array.from(itemsMap.keys()));
    for (let i = 1; i <= maxIdx; i++) {
      const existing = itemsMap.get(i);
      if (existing) {
        items.push(existing);
      } else {
        items.push({
          id: `item-${i}`,
          index: i,
          total: maxIdx,
          title: detectedKind === "image" ? `Photo #${i}` : `Track #${i}`,
          mediaKind: detectedKind,
          status: "queued",
          progress: 0,
        });
      }
    }
    items.sort((a, b) => a.index - b.index);
  } else if (
    isSingleMedia ||
    (Boolean(initialSource) && Boolean(targetJobId) && targetJobId !== "ui" && targetJobId !== "browser-session" && isRunning)
  ) {
    items = [
      {
        id: "single-item-1",
        index: 1,
        total: 1,
        title: singleTitle || detectedTitle || "Media file",
        mediaKind: inferMediaKind(defaultCategory, defaultFormat, singleOutputPath || singleTitle),
        status: singleStatus,
        progress: singleProgress,
        speed: singleSpeed,
        eta: singleEta,
        detailMessage: singleDetail,
        coverPath: detectedCoverArt,
        thumbnail: singleThumbnail || extractYouTubeThumbnail(initialSource),
        errorMessage: singleError,
        outputPath: singleOutputPath,
      },
    ];
  }

  // Calculate summary counts
  const total = items.length;
  const completed = items.filter((it) => it.status === "ready").length;
  const active = items.filter((it) => it.status === "downloading" || it.status === "transcoding").length;
  const failed = items.filter((it) => it.status === "failed").length;
  const queued = items.filter((it) => it.status === "queued").length;

  let overallProgress = 0;
  if (total > 0) {
    const sum = items.reduce((acc, it) => acc + (it.status === "ready" ? 1 : it.progress), 0);
    overallProgress = Math.min(1, Math.max(0, sum / total));
  }

  const primaryKind = items[0]?.mediaKind || detectedKind;

  return {
    items,
    summary: {
      title: total === 1 && items[0]?.title
        ? items[0].title
        : (detectedTitle || (total > 1 ? (primaryKind === "image" ? "Photo Album" : "Batch Conversion") : "Media Conversion")),
      total,
      completed,
      active,
      failed,
      queued,
      overallProgress,
      mediaKind: primaryKind,
      format: defaultFormat,
      outputDir: detectedOutputDir,
      coverArtPath: detectedCoverArt,
    },
    latestLogLine,
  };
}

export function InProgressView({
  events,
  jobId,
  running = false,
  paused = false,
  progress = 0,
  sourceTitle = "",
  outputDir = "",
  category,
  format,
  historyItems = [],
  conversionTimings = {},
  onPauseToggle,
  onAbort,
  onClear,
  onOpenRawConsole,
  onStatus,
  onNavigateToConverter,
  onNavigateToHistory,
  onNavigateToLibrary,
  onRestoreSession,
}: {
  events: ConverterEvent[];
  jobId?: string;
  running?: boolean;
  paused?: boolean;
  progress?: number;
  sourceTitle?: string;
  outputDir?: string;
  category?: Category;
  format?: string;
  historyItems?: ConversionHistoryItem[];
  conversionTimings?: Record<string, number>;
  onPauseToggle?: () => Promise<void> | void;
  onAbort?: () => Promise<void> | void;
  onClear?: (targetJobId?: string) => void;
  onOpenRawConsole: () => void;
  onStatus: (message: string) => void;
  onNavigateToConverter?: () => void;
  onNavigateToHistory?: () => void;
  onNavigateToLibrary?: () => void;
  onRestoreSession?: (item: ConversionHistoryItem) => void;
}) {
  const [layoutMode, setLayoutMode] = useState<"grid" | "list">("grid");
  const [filterState, setFilterState] = useState<"all" | "active" | "done" | "failed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: InProgressItem } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // 1. Extract distinct chronological jobs from conversion events
  const distinctJobIds = useMemo(() => {
    const ids: string[] = [];
    for (const e of events) {
      if (e.jobId && e.jobId !== "ui" && e.jobId !== "browser-session" && !ids.includes(e.jobId)) {
        ids.push(e.jobId);
      }
    }
    if (jobId && jobId !== "ui" && jobId !== "browser-session" && !ids.includes(jobId)) {
      ids.push(jobId);
    }
    return ids;
  }, [events, jobId]);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Automatically follow live active job when running or when a new job starts
  useEffect(() => {
    if (jobId) {
      setSelectedJobId(jobId);
    }
  }, [jobId]);

  // Derive currently displayed job ID
  const currentJobId = useMemo(() => {
    if (selectedJobId && distinctJobIds.includes(selectedJobId)) {
      return selectedJobId;
    }
    if (jobId && distinctJobIds.includes(jobId)) {
      return jobId;
    }
    return distinctJobIds.length > 0 ? distinctJobIds[distinctJobIds.length - 1] : (jobId || undefined);
  }, [selectedJobId, distinctJobIds, jobId]);

  const currentIndex = currentJobId ? distinctJobIds.indexOf(currentJobId) : -1;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < distinctJobIds.length - 1;
  const isViewingLive = Boolean(running && jobId && currentJobId === jobId);

  function handleNavigateSession(offset: number) {
    if (currentIndex === -1) return;
    const targetIdx = currentIndex + offset;
    if (targetIdx >= 0 && targetIdx < distinctJobIds.length) {
      setSelectedJobId(distinctJobIds[targetIdx]);
    }
  }

  function handleClear() {
    if (!onClear) return;
    if (currentJobId) {
      onClear(currentJobId);
      // Clean up cached previews for this session
      setPreviews((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (k.startsWith(`${currentJobId}:`)) {
            delete next[k];
          }
        }
        return next;
      });
      const remaining = distinctJobIds.filter((id) => id !== currentJobId);
      if (remaining.length > 0) {
        const nextIdx = Math.max(0, Math.min(currentIndex, remaining.length - 1));
        setSelectedJobId(remaining[nextIdx]);
      } else {
        setSelectedJobId(null);
      }
    } else {
      onClear();
      setPreviews({});
      setSelectedJobId(null);
    }
  }

  const isOngoing = Boolean(running || paused);
  const isSinglePage = distinctJobIds.length <= 1;
  const isClosePageDisabled = isSinglePage || isOngoing;

  function handleClosePage() {
    if (isClosePageDisabled) return;
    handleClear();
  }

  // Clear previews only when events are completely wiped
  useEffect(() => {
    if (events.length === 0) {
      setPreviews({});
      setFailedImages({});
      setSelectedJobId(null);
    }
  }, [events.length]);

  // Parse events into structured items & batch summary scoped to displayed job
  const { items, summary, latestLogLine } = useMemo(
    () => parseConversionEvents(events, category, format, isViewingLive ? sourceTitle : undefined, currentJobId, isViewingLive && running),
    [events, category, format, sourceTitle, currentJobId, isViewingLive, running]
  );

  // Computed session summaries for all in-memory jobs
  const sessionSummaries = useMemo(() => {
    return distinctJobIds.map((id, index) => {
      const isLive = Boolean(running && jobId && id === jobId);
      const isCurrent = id === currentJobId;
      const { summary: sSummary } = parseConversionEvents(
        events,
        category,
        format,
        id === jobId ? sourceTitle : undefined,
        id,
        isLive
      );
      return {
        id,
        sessionNumber: index + 1,
        title: sSummary.title || `Session #${index + 1}`,
        total: sSummary.total,
        completed: sSummary.completed,
        failed: sSummary.failed,
        active: sSummary.active,
        mediaKind: sSummary.mediaKind,
        format: sSummary.format,
        isLive,
        isCurrent,
        overallProgress: sSummary.overallProgress,
      };
    }).reverse(); // Most recent first
  }, [distinctJobIds, events, category, format, jobId, running, currentJobId, sourceTitle]);

  // Historical sessions from catalog (persisted across restarts)
  const catalogSessions = useMemo(() => {
    if (!historyItems || historyItems.length === 0) return [];
    return historyItems
      .filter((h) => !distinctJobIds.includes(h.id))
      .slice(0, 25);
  }, [historyItems, distinctJobIds]);

  function getItemPreview(item: InProgressItem): string | undefined {
    const jobKey = currentJobId || "default";
    const itemKey = `item-${item.index}`;

    // 1. In-memory data URI preview (e.g. from bridge.getThumbnail)
    const cached =
      previews[`${jobKey}:${itemKey}`] ||
      previews[`${jobKey}:${item.id}`] ||
      (item.outputPath ? previews[`${jobKey}:${item.outputPath}`] : undefined) ||
      previews[itemKey] ||
      previews[item.id] ||
      (item.outputPath ? previews[item.outputPath] : undefined);

    if (cached && !failedImages[cached]) {
      return cached;
    }

    // 2. Live remote thumbnail (e.g. CDN photo or YouTube cover URL)
    if (item.thumbnail && !failedImages[item.thumbnail]) {
      return item.thumbnail;
    }

    // 3. Only if coverPath is an actual web URL or data URI (never raw disk paths)
    if (
      item.coverPath &&
      (item.coverPath.startsWith("http://") ||
        item.coverPath.startsWith("https://") ||
        item.coverPath.startsWith("data:")) &&
      !failedImages[item.coverPath]
    ) {
      return item.coverPath;
    }

    return undefined;
  }

  function getBatchCover(): string | undefined {
    const jobKey = currentJobId || "default";
    const cached = previews[`${jobKey}:batch_cover`] || previews["batch_cover"];
    if (cached && !failedImages[cached]) {
      return cached;
    }
    if (
      summary.coverArtPath &&
      (summary.coverArtPath.startsWith("http://") ||
        summary.coverArtPath.startsWith("https://") ||
        summary.coverArtPath.startsWith("data:")) &&
      !failedImages[summary.coverArtPath]
    ) {
      return summary.coverArtPath;
    }
    return undefined;
  }

  // Load thumbnails for ready items and album covers
  useEffect(() => {
    const resolvedDir = summary.outputDir || outputDir;
    if (!resolvedDir) return;

    const jobKey = currentJobId || "default";
    const batchCoverKey = `${jobKey}:batch_cover`;

    // 1. Fetch batch / album cover art ONLY when explicitly emitted for this run
    if (!previews[batchCoverKey] && summary.coverArtPath) {
      bridge.getThumbnail(resolvedDir, summary.coverArtPath)
        .then((thumb) => {
          if (thumb) setPreviews((prev) => ({ ...prev, [batchCoverKey]: thumb }));
        })
        .catch(() => {});
    }

    // 2. Fetch individual item cover art from disk ONLY if it has an explicit local coverPath
    for (const item of items) {
      const itemKey = `${jobKey}:item-${item.index}`;
      if (previews[itemKey]) continue;

      const targetPath = item.coverPath
        || (item.outputPath
          ? (item.outputPath.includes(":\\") || item.outputPath.startsWith("/")
            ? item.outputPath
            : `${resolvedDir.replace(/[\\/]$/, "")}\\${item.outputPath}`)
          : null);

      if (targetPath) {
        bridge.getThumbnail(resolvedDir, targetPath)
          .then((thumb) => {
            if (thumb) {
              setPreviews((prev) => ({
                ...prev,
                [itemKey]: thumb,
                [`${jobKey}:${item.id}`]: thumb,
                ...(item.outputPath ? { [`${jobKey}:${item.outputPath}`]: thumb } : {}),
              }));
            }
          })
          .catch(() => {});
      }
    }
  }, [items, outputDir, summary.outputDir, summary.coverArtPath, previews, currentJobId]);

  // Filter items for display
  const displayedItems = useMemo(() => {
    let list = items;
    if (filterState === "active") {
      list = list.filter((it) => it.status === "downloading" || it.status === "transcoding");
    } else if (filterState === "done") {
      list = list.filter((it) => it.status === "ready");
    } else if (filterState === "failed") {
      list = list.filter((it) => it.status === "failed");
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((it) => it.title.toLowerCase().includes(q) || (it.artist && it.artist.toLowerCase().includes(q)));
    }
    return list;
  }, [items, filterState, searchQuery]);

  async function openOutputFolder() {
    const dir = summary.outputDir || outputDir;
    if (!dir) {
      onStatus("No output directory recorded yet.");
      return;
    }
    try {
      await bridge.openPath(dir);
      onStatus(`Opened: ${dir}`);
    } catch (err) {
      onStatus(`Could not open folder: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function cleanPath(value: string) {
    return value.trim().replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  }

  function getItemFullPath(item: InProgressItem): string | undefined {
    // 1. If item.outputPath is already an absolute path, clean and return it
    if (item.outputPath) {
      const cleaned = cleanPath(item.outputPath);
      if (cleaned.includes(":\\") || cleaned.startsWith("/") || cleaned.startsWith("\\\\")) {
        return cleaned;
      }
    }

    // 2. Check historyItems for exact disk exportPath
    const itemFilename = item.outputPath
      ? cleanPath(item.outputPath).split(/[\\/]/).pop()?.toLowerCase()
      : undefined;
    const itemTitle = item.title.toLowerCase();

    for (const hist of historyItems) {
      if (!hist.exportPath) continue;
      const histExport = cleanPath(hist.exportPath);
      const histLower = histExport.toLowerCase();
      const histBase = histExport.split(/[\\/]/).pop()?.toLowerCase();

      // Direct match on filename
      if (itemFilename && (histBase === itemFilename || histLower.endsWith("\\" + itemFilename) || histLower.endsWith("/" + itemFilename))) {
        return histExport;
      }
      // If history entry is a directory containing this item
      if (itemFilename && !/\.[a-zA-Z0-9]{2,5}$/.test(histExport)) {
        return `${histExport.replace(/[\\/]+$/, "")}\\${item.outputPath}`;
      }
      // Direct match on title if history is a file
      if (hist.fileName && hist.fileName.toLowerCase() === itemTitle && /\.[a-zA-Z0-9]{2,5}$/.test(histExport)) {
        return histExport;
      }
    }

    // 3. Fallback to summary.outputDir or outputDir
    let dir = summary.outputDir || outputDir;
    if (dir) {
      dir = cleanPath(dir);
      if (/\.[a-zA-Z0-9]{2,5}$/.test(dir)) {
        const idx = Math.max(dir.lastIndexOf("\\"), dir.lastIndexOf("/"));
        if (idx > 0) dir = dir.slice(0, idx);
      }
    }
    const raw = item.outputPath || (item.coverPath && !item.coverPath.startsWith("http") && !item.coverPath.startsWith("data:") ? item.coverPath : undefined);
    if (!raw) return dir || undefined;
    const cleaned = cleanPath(raw);
    if (cleaned.includes(":\\") || cleaned.startsWith("/") || cleaned.startsWith("\\\\")) {
      return cleaned;
    }
    if (!dir) return cleaned;
    return `${dir.replace(/[\\/]+$/, "")}\\${cleaned}`;
  }

  async function openItemFile(item: InProgressItem) {
    const fullPath = getItemFullPath(item);
    if (!fullPath) return;
    try {
      await bridge.openFile(fullPath);
      onStatus(`Opened: ${item.title}`);
    } catch (err) {
      onStatus(`Could not open file: ${err instanceof Error ? err.message : String(err)} (${fullPath})`);
    }
  }

  async function showItemInFolder(item: InProgressItem) {
    const fullPath = getItemFullPath(item);
    const dir = summary.outputDir || outputDir;
    const target = fullPath || dir;
    if (!target) return;
    try {
      await bridge.openPath(target);
      onStatus(`Opened location: ${target}`);
    } catch (err) {
      onStatus(`Could not open location: ${err instanceof Error ? err.message : String(err)} (${target})`);
    }
  }

  function getItemElapsedMs(item: InProgressItem): number | undefined {
    if (item.elapsedMs !== undefined) return item.elapsedMs;
    const full = getItemFullPath(item);
    if (full) {
      const key = full.replace(/\\/g, "/").toLowerCase();
      if (conversionTimings[key]) return conversionTimings[key];
      const fname = full.split(/[\\/]/).pop()?.toLowerCase();
      if (fname) {
        for (const [k, v] of Object.entries(conversionTimings)) {
          if (k.endsWith("/" + fname) || k === fname) return v;
        }
      }
      const hist = historyItems.find(
        (h) => h.exportPath && (h.exportPath === full || h.exportPath.replace(/\\/g, "/") === full.replace(/\\/g, "/"))
      );
      if (hist?.elapsedMs) return hist.elapsedMs;
    }
    return undefined;
  }

  function handleContextMenu(e: React.MouseEvent, item: InProgressItem) {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 240;
    const menuHeight = 280;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 12);
    setContextMenu({ x, y, item });
  }

  // Display badge helper
  function renderStatusBadge(item: InProgressItem) {
    switch (item.status) {
      case "ready":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
            <Check size={11} className="stroke-[2.5]" /> Ready
          </span>
        );
      case "transcoding":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-medium text-fuchsia-300">
            <RefreshCw size={10} className="animate-spin" />
            Transcoding {item.speed ? `(${item.speed})` : `${Math.round(item.progress * 100)}%`}
          </span>
        );
      case "downloading":
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
            <RefreshCw size={10} className="animate-spin" />
            Downloading {item.speed ? `(${item.speed})` : `${Math.round(item.progress * 100)}%`}
          </span>
        );
      case "failed":
        return (
          <span
            title={item.errorMessage}
            className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300 cursor-help"
          >
            <AlertCircle size={11} /> Failed
          </span>
        );
      case "queued":
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-400">
            <Clock size={10} /> Queued
          </span>
        );
    }
  }

  function renderContextMenu() {
    if (!contextMenu) return null;
    const item = contextMenu.item;
    const fullPath = getItemFullPath(item);
    const hasPath = Boolean(fullPath);
    const elapsed = getItemElapsedMs(item);

    return (
      <div
        style={{
          position: "fixed",
          left: `${contextMenu.x}px`,
          top: `${contextMenu.y}px`,
          zIndex: 9999,
        }}
        className="context-menu min-w-[240px] rounded-xl border border-white/[0.12] bg-[#0c0914]/95 p-1.5 shadow-2xl shadow-black/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Info */}
        <div className="border-b border-white/[0.06] px-3 py-2">
          <div className="truncate text-xs font-semibold text-white" title={item.title}>
            {item.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-400">
            <span className="capitalize">{item.mediaKind}</span>
            {item.total > 1 && (
              <>
                <span>•</span>
                <span>#{item.index} of {item.total}</span>
              </>
            )}
            {item.artist && (
              <>
                <span>•</span>
                <span className="truncate">{item.artist}</span>
              </>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px]">
            <span className="text-zinc-400">Status</span>
            <div className="scale-90 origin-right">
              {renderStatusBadge(item)}
            </div>
          </div>
          {elapsed !== undefined && (
            <div className="mt-1.5 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px]">
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <Clock size={11} style={{ color: "var(--accent-color)" }} /> Conversion time
              </span>
              <span className="font-mono text-zinc-200">
                {formatElapsedMs(elapsed)}
              </span>
            </div>
          )}
          {item.eta && (
            <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-zinc-400">
              <span>ETA</span>
              <span className="font-mono text-zinc-300">{item.eta}</span>
            </div>
          )}
          {item.errorMessage && (
            <div className="mt-1.5 rounded bg-rose-500/10 border border-rose-500/20 p-1.5 text-[10px] text-rose-300 break-words">
              {item.errorMessage}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-1 space-y-0.5">
          {item.status === "ready" && hasPath && (
            <>
              <button
                type="button"
                onClick={() => {
                  void openItemFile(item);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-[var(--accent-subtle)] hover:text-white"
              >
                <Play size={13} style={{ color: "var(--accent-color)" }} />
                {item.mediaKind === "image" ? "Open photo" : "Open / Play file"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void showItemInFolder(item);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
              >
                <FolderOpen size={13} className="text-zinc-400" /> Show in File Explorer
              </button>
              <button
                type="button"
                onClick={() => {
                  if (fullPath) {
                    void navigator.clipboard.writeText(fullPath);
                    onStatus(`Copied path for ${item.title}`);
                  }
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
              >
                <Copy size={13} className="text-zinc-400" /> Copy full path
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(item.title);
              onStatus(`Copied title: ${item.title}`);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
          >
            <Copy size={13} className="text-zinc-400" /> Copy title
          </button>

          {(summary.outputDir || outputDir) && (
            <button
              type="button"
              onClick={() => {
                void openOutputFolder();
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
            >
              <FolderOpen size={13} className="text-zinc-400" /> Open destination folder
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onOpenRawConsole();
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
          >
            <Terminal size={13} className="text-zinc-400" /> View terminal logs
          </button>
        </div>
      </div>
    );
  }

  function renderSessionHistoryModal() {
    if (!showSessionModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-in fade-in duration-200">
        <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-3xl border border-white/10 bg-[#0c0919] p-6 shadow-[0_24px_70px_rgba(0,0,0,.7)]">
          {/* Modal Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] pb-4">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                <History size={18} className="text-[var(--accent-color,#c52b68)]" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white tracking-tight">Conversion Sessions</h2>
                <p className="text-xs text-zinc-400">
                  Browse, inspect, and switch between your media conversion sessions.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSessionModal(false)}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors"
              title="Close modal"
            >
              <X size={16} />
            </button>
          </div>

          {/* Modal Body: List of Sessions */}
          <div className="min-h-0 flex-1 overflow-y-auto py-4 space-y-3 pr-1">
            <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Active Workspace Sessions ({sessionSummaries.length})
            </div>

            {sessionSummaries.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.05] bg-black/20 p-6 text-center text-xs text-zinc-500">
                No active sessions in queue. Convert media to create sessions.
              </div>
            ) : (
              sessionSummaries.map((sess) => (
                <div
                  key={sess.id}
                  onClick={() => {
                    setSelectedJobId(sess.id);
                    setShowSessionModal(false);
                  }}
                  className={`group flex items-center justify-between gap-3.5 rounded-2xl border p-4 cursor-pointer transition-all ${
                    sess.isCurrent
                      ? "border-white/20 bg-white/[0.06] shadow-sm"
                      : "border-white/[0.06] bg-black/40 hover:border-white/15 hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="font-mono text-xs font-semibold text-zinc-500 w-7">
                      #{sess.sessionNumber}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold text-zinc-100 group-hover:text-white">
                          {sess.title}
                        </span>
                        {sess.isLive && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Live
                          </span>
                        )}
                        {sess.isCurrent && !sess.isLive && (
                          <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 border border-white/5">
                            Current Rack
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
                        <span className="font-mono">{sess.completed} of {sess.total} completed</span>
                        {sess.format && (
                          <>
                            <span className="text-zinc-600">•</span>
                            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                              {sess.format.toUpperCase()}
                            </span>
                          </>
                        )}
                        {sess.failed > 0 && (
                          <>
                            <span className="text-zinc-600">•</span>
                            <span className="text-rose-400 font-medium">{sess.failed} failed</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedJobId(sess.id);
                        setShowSessionModal(false);
                      }}
                      className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                        sess.isCurrent
                          ? "bg-white/[0.12] text-white"
                          : "bg-white/[0.04] text-zinc-300 hover:bg-white/[0.1] hover:text-white"
                      }`}
                    >
                      {sess.isCurrent ? "Viewing" : "View in Rack →"}
                    </button>

                    {!sess.isLive && onClear && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (currentJobId === sess.id) {
                            handleClear();
                          } else {
                            onClear(sess.id);
                          }
                        }}
                        className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                        title="Remove session from rack"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Previous Launches from Catalog */}
            {catalogSessions.length > 0 && (
              <div className="pt-4 border-t border-white/[0.06]">
                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                  Past Conversions from Library ({catalogSessions.length})
                </div>
                <div className="space-y-2">
                  {catalogSessions.map((hist) => (
                    <div
                      key={hist.id}
                      onClick={() => {
                        onRestoreSession?.(hist);
                        setSelectedJobId(hist.id);
                        setShowSessionModal(false);
                      }}
                      className="group flex items-center justify-between gap-3 rounded-2xl border border-white/[0.04] bg-black/20 p-3 hover:border-white/10 hover:bg-white/[0.02] cursor-pointer transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-zinc-300 group-hover:text-white">
                          {hist.fileName || hist.source}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
                          <span>{hist.presetName || hist.formatLabel}</span>
                          <span>•</span>
                          <span>{new Date(hist.timestamp).toLocaleDateString()}</span>
                          <span>•</span>
                          <span className={hist.status === "succeeded" ? "text-emerald-400" : "text-amber-400"}>
                            {hist.status}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestoreSession?.(hist);
                          setSelectedJobId(hist.id);
                          setShowSessionModal(false);
                        }}
                        className="rounded-xl bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-400 hover:bg-white/[0.1] hover:text-white transition-colors shrink-0"
                      >
                        Open in Rack →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex shrink-0 items-center justify-between border-t border-white/[0.06] pt-4 mt-2">
            {onNavigateToLibrary ? (
              <button
                type="button"
                onClick={() => {
                  setShowSessionModal(false);
                  onNavigateToLibrary();
                }}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <FolderOpen size={13} /> Open Converted Library ↗
              </button>
            ) : <div />}

            <button
              type="button"
              onClick={() => setShowSessionModal(false)}
              className="subtle-button px-4 py-1.5 text-xs text-zinc-200 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty state when nothing has been converted in this session or overall
  if (items.length === 0 && !isViewingLive) {
    return (
      <div className="mx-auto flex h-full w-full max-w-[1180px] flex-1 flex-col justify-between gap-6 min-h-0">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mono-label">Active Workspace</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-.04em] text-white">In Progress View.</h1>
            <p className="mt-1 text-xs text-zinc-400">
              Visual monitoring rack for downloading media, music albums, videos, and photo carousels.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Session carousel shuffle controls */}
            {(distinctJobIds.length > 0 || running) && (
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1 shadow-inner backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => handleNavigateSession(-1)}
                  disabled={!hasPrevious}
                  className="flex size-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
                  title="Previous conversion session"
                  aria-label="Previous session"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSessionModal(true)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                  title="Click to view all conversion sessions"
                >
                  <span className="font-mono text-[11px] font-medium text-zinc-300">
                    Session {currentIndex >= 0 ? currentIndex + 1 : 1} / {Math.max(1, distinctJobIds.length)}
                  </span>
                  <span className="inline-flex items-center rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 border border-white/5">
                    History
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigateSession(1)}
                  disabled={!hasNext}
                  className="flex size-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
                  title="Next conversion session"
                  aria-label="Next session"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}

            {running && !isViewingLive && jobId && (
              <button
                type="button"
                onClick={() => setSelectedJobId(jobId)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-all shadow-[0_0_12px_rgba(16,185,129,.2)]"
                title="Return to the active live conversion"
              >
                <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
                Jump to Live
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowSessionModal(true)}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
              title="View conversion session history"
            >
              <History size={13} /> History
            </button>

            <button
              type="button"
              onClick={onOpenRawConsole}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            >
              <Terminal size={13} /> Raw Console
            </button>

            {/* Close Page button */}
            <button
              type="button"
              onClick={handleClosePage}
              disabled={isClosePageDisabled}
              aria-disabled={isClosePageDisabled}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-all ${
                isClosePageDisabled
                  ? "border-white/[0.04] bg-black/60 text-zinc-600 opacity-25 cursor-not-allowed pointer-events-none select-none shadow-none"
                  : "subtle-button text-zinc-300 hover:text-white"
              }`}
              title={
                isOngoing
                  ? "Cannot close page while conversion is ongoing (abort first)"
                  : isSinglePage
                    ? "Cannot close the only remaining conversion page"
                    : "Close this conversion page"
              }
            >
              <X size={13} /> Close Page
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-white/[0.07] bg-white/[0.02] p-8 text-center backdrop-blur-md">
          <div className="grid size-16 place-items-center rounded-2xl border border-white/10 bg-black/30 shadow-[0_8px_32px_rgba(0,0,0,.4)]">
            <Music size={26} className="text-zinc-500" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-white">No active conversions</h2>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-400">
            Paste a YouTube URL, Soundcloud link, album playlist, Facebook photo link, or drop media into the Converter to see real-time artwork, download progress, and transcoding speed.
          </p>
          {onNavigateToConverter && (
            <button
              type="button"
              onClick={onNavigateToConverter}
              className="mt-6 flex items-center gap-2 rounded-xl bg-[var(--accent-color,#c52b68)] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_var(--accent-glow,rgba(197,43,104,.4))] hover:brightness-110 transition-all"
            >
              Go to Converter <ChevronRight size={14} />
            </button>
          )}
        </div>

        {/* Bottom Ticker */}
        {latestLogLine && (
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/40 px-3.5 py-2 text-xs text-zinc-400 backdrop-blur-sm">
            <div className="flex items-center gap-2 min-w-0 truncate font-mono text-[11px] text-zinc-300">
              <span className="text-zinc-500">&gt;</span>
              <span className="truncate">{latestLogLine}</span>
            </div>
            <button
              type="button"
              onClick={onOpenRawConsole}
              className="shrink-0 text-[11px] font-medium text-zinc-400 hover:text-white transition-colors"
            >
              Open Raw Console ↗
            </button>
          </div>
        )}

        {renderSessionHistoryModal()}
        {renderContextMenu()}
      </div>
    );
  }

  const effectiveProgress = progress > 0 ? progress : summary.overallProgress;
  const batchCover = getBatchCover();

  return (
    <div className="mx-auto flex h-full w-full max-w-[1180px] flex-1 flex-col gap-4 min-h-0">
      {/* 1. Header Bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mono-label">Active Workspace</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-.04em] text-white">In Progress View.</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Visual cards and cover art for active media downloads and conversions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Carousel session shuffle controls */}
          {(distinctJobIds.length > 0 || running) && (
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1 shadow-inner backdrop-blur-md">
              <button
                type="button"
                onClick={() => handleNavigateSession(-1)}
                disabled={!hasPrevious}
                className="flex size-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
                title="Previous conversion session"
                aria-label="Previous session"
              >
                <ChevronLeft size={14} />
              </button>

              <button
                type="button"
                onClick={() => setShowSessionModal(true)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                title="Click to view all conversion sessions"
              >
                <span className="font-mono text-[11px] font-medium text-zinc-300">
                  Session {currentIndex >= 0 ? currentIndex + 1 : 1} / {Math.max(1, distinctJobIds.length)}
                </span>
                {isViewingLive ? (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 border border-white/5">
                    History
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleNavigateSession(1)}
                disabled={!hasNext}
                className="flex size-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
                title="Next conversion session"
                aria-label="Next session"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* Quick jump back to live session */}
          {running && !isViewingLive && jobId && (
            <button
              type="button"
              onClick={() => setSelectedJobId(jobId)}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-all shadow-[0_0_12px_rgba(16,185,129,.2)]"
              title="Return to the active live conversion"
            >
              <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
              Jump to Live
            </button>
          )}

          {/* Running controls (Pause/Resume/Abort) only shown if viewing the live job */}
          {isViewingLive && (running || paused) && (
            <>
              {onPauseToggle && (
                <button
                  type="button"
                  onClick={() => void onPauseToggle()}
                  className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 hover:text-amber-200"
                >
                  {paused ? <Play size={13} className="fill-current" /> : <Pause size={13} />}
                  {paused ? "Resume" : "Pause"}
                </button>
              )}
              {onAbort && (
                <button
                  type="button"
                  onClick={() => void onAbort()}
                  className="danger-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
                >
                  <Square size={12} /> Abort
                </button>
              )}
            </>
          )}

          {/* Clear button */}
          {!isViewingLive && events.length > 0 && onClear && (
            <button
              type="button"
              onClick={handleClear}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
              title="Clear this session from view"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}

          {/* Close Page button */}
          <button
            type="button"
            onClick={handleClosePage}
            disabled={isClosePageDisabled}
            aria-disabled={isClosePageDisabled}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-all ${
              isClosePageDisabled
                ? "border-white/[0.04] bg-black/60 text-zinc-600 opacity-25 cursor-not-allowed pointer-events-none select-none shadow-none"
                : "subtle-button text-zinc-300 hover:text-white"
            }`}
            title={
              isOngoing
                ? "Cannot close page while conversion is ongoing (abort first)"
                : isSinglePage
                  ? "Cannot close the only remaining conversion page"
                  : "Close this conversion page"
            }
          >
            <X size={13} /> Close Page
          </button>

          {/* Conversion Sessions History */}
          <button
            type="button"
            onClick={() => setShowSessionModal(true)}
            className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            title="View conversion session history"
          >
            <History size={13} /> History
          </button>

          {/* Output Folder */}
          {(summary.outputDir || outputDir) && (
            <button
              type="button"
              onClick={() => void openOutputFolder()}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
              title="Open output destination folder"
            >
              <FolderOpen size={13} /> Output Folder
            </button>
          )}

          {/* Raw Console */}
          <button
            type="button"
            onClick={onOpenRawConsole}
            className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            title="Inspect full diagnostic terminal logs"
          >
            <Terminal size={13} /> Raw Console
          </button>
        </div>
      </div>

      {/* 2. Hero Batch Card with Master Progress */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0a1a]/85 p-5 shadow-[0_12px_36px_rgba(0,0,0,.35)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            {batchCover && (
              <div className="size-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-md">
                <img
                  src={batchCover}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImages((prev) => ({ ...prev, [batchCover]: true }))}
                  className="size-full object-cover"
                />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-white tracking-tight">
              {summary.title || "Converting Media"}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="font-mono text-zinc-300">
                {summary.completed} of {summary.total} completed
              </span>
              <span className="text-zinc-600">•</span>
              {summary.active > 0 && (
                <span className="text-fuchsia-400 font-medium">
                  {summary.active} converting
                </span>
              )}
              {summary.queued > 0 && (
                <span className="text-zinc-500">
                  {summary.queued} queued
                </span>
              )}
              {summary.format && (
                <>
                  <span className="text-zinc-600">•</span>
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                    {summary.format.toUpperCase()}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="text-right">
            <div className="font-mono text-xl font-bold text-white tracking-tight">
              {Math.round(effectiveProgress * 100)}%
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Overall Progress</div>
          </div>
        </div>

        {/* Master Progress Bar */}
        <div className="relative mt-4 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${Math.round(effectiveProgress * 100)}%`,
              backgroundColor: "var(--accent-color, #c52b68)",
              boxShadow: "0 0 16px var(--accent-glow, rgba(197,43,104,.6))",
            }}
          />
        </div>
      </div>

      {/* 3. Toolbar: Status Filters & Grid/List Layout Mode */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterState("all")}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filterState === "all"
                ? "bg-white/[0.1] text-white"
                : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            All ({summary.total})
          </button>
          <button
            type="button"
            onClick={() => setFilterState("active")}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filterState === "active"
                ? "bg-fuchsia-500/20 text-fuchsia-300"
                : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            Active ({summary.active})
          </button>
          <button
            type="button"
            onClick={() => setFilterState("done")}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filterState === "done"
                ? "bg-emerald-500/20 text-emerald-300"
                : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            Done ({summary.completed})
          </button>
          {summary.failed > 0 && (
            <button
              type="button"
              onClick={() => setFilterState("failed")}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                filterState === "failed"
                  ? "bg-rose-500/20 text-rose-300"
                  : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
              }`}
            >
              Failed ({summary.failed})
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {summary.total > 6 && (
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 w-36 rounded-lg border border-white/[0.08] bg-black/30 pl-7 pr-2 text-xs text-zinc-200 placeholder-zinc-500 focus:w-48 focus:border-white/20 focus:outline-none transition-all"
              />
            </div>
          )}

          <div className="flex items-center rounded-lg border border-white/[0.08] bg-black/30 p-0.5">
            <button
              type="button"
              onClick={() => setLayoutMode("grid")}
              aria-label="Grid layout"
              title="Card Grid view"
              className={`rounded p-1 text-xs transition-colors ${
                layoutMode === "grid" ? "bg-white/[0.12] text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("list")}
              aria-label="List layout"
              title="Compact List view"
              className={`rounded p-1 text-xs transition-colors ${
                layoutMode === "list" ? "bg-white/[0.12] text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <List size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* 4. Main Conversion Rack: Grid or List */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {layoutMode === "grid" ? (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {displayedItems.map((item) => {
              const preview = getItemPreview(item);
              const isActive = item.status === "downloading" || item.status === "transcoding";

              return (
                <div
                  key={item.id}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-[#0b0916]/80 p-3.5 transition-all select-none ${
                    isActive
                      ? "border-fuchsia-500/40 shadow-[0_0_24px_rgba(197,43,104,.18)]"
                      : item.status === "ready"
                      ? "border-white/[0.08] hover:border-white/[0.16]"
                      : "border-white/[0.04] opacity-75 hover:opacity-100"
                  }`}
                >
                  {/* Thumbnail Container */}
                  <div
                    className={`relative mb-3 overflow-hidden rounded-xl border border-white/[0.07] bg-black/40 ${
                      item.mediaKind === "video" ? "aspect-video" : "aspect-square"
                    }`}
                  >
                    {preview ? (
                      <img
                        src={preview}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (preview) {
                            setFailedImages((prev) => ({ ...prev, [preview]: true }));
                          }
                        }}
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-1.5 text-zinc-600">
                        {item.mediaKind === "video" ? (
                          <Film size={28} className={isActive ? "text-fuchsia-400" : "text-zinc-600"} />
                        ) : item.mediaKind === "image" ? (
                          <ImageIcon size={28} className={isActive ? "text-fuchsia-400" : "text-zinc-600"} />
                        ) : (
                          <Music size={28} className={isActive ? "text-fuchsia-400" : "text-zinc-600"} />
                        )}
                        <span className="font-mono text-[10px] text-zinc-500">#{item.index}</span>
                      </div>
                    )}

                    {/* Corner format chip */}
                    <div className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-300 backdrop-blur-md">
                      {item.mediaKind}
                    </div>

                    {/* Active transcode/download pulsing ring */}
                    {isActive && (
                      <div className="pointer-events-none absolute inset-0 border-2 border-fuchsia-400/30 animate-pulse rounded-xl" />
                    )}
                  </div>

                  {/* Item Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1.5">
                      <h3
                        title={item.title}
                        className="truncate text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors"
                      >
                        {item.title}
                      </h3>
                    </div>
                    {item.artist && (
                      <p className="mt-0.5 truncate text-[11px] text-zinc-400">{item.artist}</p>
                    )}
                  </div>

                  {/* Micro Progress Bar (for active items) */}
                  {isActive && (
                    <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          width: `${Math.round(item.progress * 100)}%`,
                          backgroundColor: "var(--accent-color, #c52b68)",
                        }}
                      />
                    </div>
                  )}

                  {/* Card Footer: Status Badge + Conversion Time + Action Buttons */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-white/[0.05]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {renderStatusBadge(item)}
                      {getItemElapsedMs(item) !== undefined && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 border border-white/5"
                          title={`Conversion took ${formatElapsedMs(getItemElapsedMs(item)!)}`}
                        >
                          <Clock size={10} className="text-zinc-500" />
                          {formatElapsedMs(getItemElapsedMs(item)!)}
                        </span>
                      )}
                    </div>

                    {item.status === "ready" && Boolean(getItemFullPath(item)) && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          draggable
                          onDragStartCapture={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const target = getItemFullPath(item);
                            if (target) {
                              void bridge.dragLibraryFile(target).catch((err: unknown) => {
                                onStatus(`Could not drag file: ${err instanceof Error ? err.message : String(err)} (${target})`);
                              });
                            } else {
                              onStatus("No file path available to drag.");
                            }
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onStatus("Drag this button into another app (e.g. FL Studio, DAW, or Discord).");
                          }}
                          className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white cursor-grab active:cursor-grabbing"
                          title="Drag this file into another app"
                          aria-label={"Drag " + item.title}
                        >
                          <GripVertical size={12} style={{ color: "var(--accent-color)" }} />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openItemFile(item);
                          }}
                          className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                          title={item.mediaKind === "image" ? "Open photo" : "Open / Play file"}
                          aria-label={"Open " + item.title}
                        >
                          <Play size={11} className="fill-current" style={{ color: "var(--accent-color)" }} />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void showItemInFolder(item);
                          }}
                          className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                          title="Show in File Explorer"
                          aria-label={"Show in folder for " + item.title}
                        >
                          <FolderOpen size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List Mode Rack */
          <div className="divide-y divide-white/[0.04] rounded-2xl border border-white/[0.07] bg-[#0c0a1a]/70 backdrop-blur-md">
            {displayedItems.map((item) => {
              const preview = getItemPreview(item);
              const isActive = item.status === "downloading" || item.status === "transcoding";

              return (
                <div
                  key={item.id}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  className={`flex flex-wrap items-center gap-3.5 px-4 py-3 transition-colors select-none ${
                    isActive ? "bg-fuchsia-500/[0.04]" : "hover:bg-white/[0.02]"
                  }`}
                >
                  <span className="w-6 text-center font-mono text-xs text-zinc-500">#{item.index}</span>

                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[0.08] bg-black/40 shadow-sm">
                    {preview ? (
                      <img
                        src={preview}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (preview) {
                            setFailedImages((prev) => ({ ...prev, [preview]: true }));
                          }
                        }}
                        className="size-full object-cover transition-transform duration-300 hover:scale-105"
                      />
                    ) : item.mediaKind === "video" ? (
                      <Film size={18} className="text-zinc-500" />
                    ) : item.mediaKind === "image" ? (
                      <ImageIcon size={18} className="text-zinc-500" />
                    ) : (
                      <Music size={18} className="text-zinc-500" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-zinc-200">{item.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                      {item.artist && <span>{item.artist}</span>}
                      {item.speed && (
                        <>
                          <span>•</span>
                          <span className="font-mono text-zinc-400">{item.speed}</span>
                        </>
                      )}
                      {item.eta && (
                        <>
                          <span>•</span>
                          <span>ETA {item.eta}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <div className="w-28">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          className="h-full rounded-full transition-all duration-200"
                          style={{
                            width: `${Math.round(item.progress * 100)}%`,
                            backgroundColor: "var(--accent-color, #c52b68)",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 shrink-0">
                    {renderStatusBadge(item)}
                    {getItemElapsedMs(item) !== undefined && (
                      <span
                        className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 border border-white/5"
                        title={`Conversion took ${formatElapsedMs(getItemElapsedMs(item)!)}`}
                      >
                        <Clock size={10} className="text-zinc-500" />
                        {formatElapsedMs(getItemElapsedMs(item)!)}
                      </span>
                    )}
                  </div>

                  {item.status === "ready" && Boolean(getItemFullPath(item)) && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        draggable
                        onDragStartCapture={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const target = getItemFullPath(item);
                          if (target) {
                            void bridge.dragLibraryFile(target).catch((err: unknown) => {
                              onStatus(`Could not drag file: ${err instanceof Error ? err.message : String(err)} (${target})`);
                            });
                          } else {
                            onStatus("No file path available to drag.");
                          }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onStatus("Drag this button into another app (e.g. FL Studio, DAW, or Discord).");
                        }}
                        className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white cursor-grab active:cursor-grabbing"
                        title="Drag this file into another app"
                        aria-label={"Drag " + item.title}
                      >
                        <GripVertical size={12} style={{ color: "var(--accent-color)" }} />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openItemFile(item);
                        }}
                        className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                        title={item.mediaKind === "image" ? "Open photo" : "Open / Play file"}
                        aria-label={"Open " + item.title}
                      >
                        <Play size={11} className="fill-current" style={{ color: "var(--accent-color)" }} />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void showItemInFolder(item);
                        }}
                        className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
                        title="Show in File Explorer"
                        aria-label={"Show in folder for " + item.title}
                      >
                        <FolderOpen size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Bottom Live Ticker Dock */}
      {latestLogLine && (
        <div className="flex shrink-0 items-center justify-between rounded-xl border border-white/[0.06] bg-black/40 px-3.5 py-2 text-xs text-zinc-400 backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0 truncate font-mono text-[11px] text-zinc-300">
            <span className="text-zinc-500">&gt;</span>
            <span className="truncate">{latestLogLine}</span>
          </div>
          <button
            type="button"
            onClick={onOpenRawConsole}
            className="shrink-0 text-[11px] font-medium text-zinc-400 hover:text-white transition-colors ml-3"
          >
            Open Raw Console ↗
          </button>
        </div>
      )}

      {renderSessionHistoryModal()}
      {renderContextMenu()}
    </div>
  );
}
