import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  FileAudio,
  Film,
  FolderOpen,
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
} from "lucide-react";
import { bridge, type Category, type ConverterEvent } from "../bridge";

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
const COVER_ART_RE = /\[\*\]\s*(?:Playlist Cover Art|Media Thumbnail):\s*(.*)/i;
const TRACK_COVER_RE = /\[\*\]\s*Track\s*#(\d+)\s*Cover:\s*(.*)/i;
const TARGET_DIR_RE = /(?:Target Directory:\s*(.*)|Export Directory:\s*(.*)|DONE! Exported:\s*(.*))/i;

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
): { items: InProgressItem[]; summary: InProgressBatchSummary; latestLogLine: string } {
  // 1. Filter events by active job so multiple jobs never mix together
  const jobEvents = events.filter((e) => e.jobId && e.jobId !== "ui" && e.jobId !== "browser-session");
  let scopedEvents = jobEvents.length > 0 ? jobEvents : events;
  if (targetJobId) {
    const matched = scopedEvents.filter((e) => e.jobId === targetJobId);
    if (matched.length > 0) scopedEvents = matched;
  } else if (scopedEvents.length > 0) {
    const lastJobId = scopedEvents[scopedEvents.length - 1].jobId;
    if (lastJobId) {
      const matched = scopedEvents.filter((e) => e.jobId === lastJobId);
      if (matched.length > 0) scopedEvents = matched;
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
  let singleProgress = 0;
  let singleStatus: InProgressItemStatus = "downloading";
  let singleSpeed: string | undefined;
  let singleEta: string | undefined;
  let singleDetail = "";
  let singleError: string | undefined;

  for (const event of scopedEvents) {
    const rawMsg = event.message.trim();
    if (!rawMsg) continue;
    latestLogLine = rawMsg;

    // 1. Detect target directory: Target Directory: <path> or Export Directory: <path> or DONE! Exported: <path>
    const dirMatch = TARGET_DIR_RE.exec(rawMsg);
    if (dirMatch) {
      detectedOutputDir = (dirMatch[1] || dirMatch[2] || dirMatch[3] || "").trim();
    }

    // 2. Detect cover art paths
    const coverMatch = COVER_ART_RE.exec(rawMsg);
    if (coverMatch) {
      detectedCoverArt = coverMatch[1].trim();
    }
    const trackCoverMatch = TRACK_COVER_RE.exec(rawMsg);
    if (trackCoverMatch) {
      const tIdx = parseInt(trackCoverMatch[1], 10);
      const tPath = trackCoverMatch[2].trim();
      let item = itemsMap.get(tIdx);
      if (item) {
        item.coverPath = tPath;
      }
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
      const idx = convMatch[1] ? parseInt(convMatch[1], 10) : undefined;
      const filename = convMatch[2].trim();
      if (idx !== undefined) {
        let item = itemsMap.get(idx);
        if (!item) {
          item = {
            id: `item-${idx}`,
            index: idx,
            total: detectedTotal || idx,
            title: filename.replace(/\.[a-zA-Z0-9]+$/, ""),
            mediaKind: inferMediaKind(defaultCategory, defaultFormat, filename),
            status: "ready",
            progress: 1,
            outputPath: filename,
          };
          itemsMap.set(idx, item);
        } else {
          item.status = "ready";
          item.progress = 1;
          item.outputPath = filename;
          if (!item.title || item.title.startsWith("Track #")) {
            item.title = filename.replace(/\.[a-zA-Z0-9]+$/, "");
          }
        }
      } else {
        isSingleMedia = true;
        singleTitle = filename.replace(/\.[a-zA-Z0-9]+$/, "");
        singleStatus = "ready";
        singleProgress = 1;
      }
      continue;
    }

    // 9. Match Ready: e.g. Ready: 9. am.mp3
    const readyMatch = READY_RE.exec(rawMsg);
    if (readyMatch) {
      const idx = readyMatch[1] ? parseInt(readyMatch[1], 10) : undefined;
      if (idx !== undefined) {
        const item = itemsMap.get(idx);
        if (item) {
          item.status = "ready";
          item.progress = 1;
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
      if (rawMsg.includes("[download]") || rawMsg.includes("Downloading stream:")) {
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
  } else if (isSingleMedia || scopedEvents.length > 0) {
    items = [
      {
        id: "single-item-1",
        index: 1,
        total: 1,
        title: singleTitle || detectedTitle || "Active conversion",
        mediaKind: inferMediaKind(defaultCategory, defaultFormat, singleTitle),
        status: singleStatus,
        progress: singleProgress,
        speed: singleSpeed,
        eta: singleEta,
        detailMessage: singleDetail,
        errorMessage: singleError,
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
      title: detectedTitle || (total > 1 ? (primaryKind === "image" ? "Photo Album" : "Batch Conversion") : "Media Conversion"),
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
  onPauseToggle,
  onAbort,
  onClear,
  onOpenRawConsole,
  onStatus,
  onNavigateToConverter,
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
  onPauseToggle?: () => Promise<void> | void;
  onAbort?: () => Promise<void> | void;
  onClear?: () => void;
  onOpenRawConsole: () => void;
  onStatus: (message: string) => void;
  onNavigateToConverter?: () => void;
}) {
  const [layoutMode, setLayoutMode] = useState<"grid" | "list">("grid");
  const [filterState, setFilterState] = useState<"all" | "active" | "done" | "failed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});

  // Reset previews whenever the active job changes or events are cleared
  useEffect(() => {
    setPreviews({});
  }, [jobId]);

  useEffect(() => {
    if (events.length === 0) {
      setPreviews({});
    }
  }, [events.length]);

  // Parse events into structured items & batch summary scoped to active job
  const { items, summary, latestLogLine } = useMemo(
    () => parseConversionEvents(events, category, format, sourceTitle, jobId),
    [events, category, format, sourceTitle, jobId]
  );

  // Load thumbnails for ready items and album covers
  useEffect(() => {
    const resolvedDir = summary.outputDir || outputDir;
    if (!resolvedDir) return;

    // 1. Fetch batch / album cover art
    if (!previews["batch_cover"]) {
      const candidate = summary.coverArtPath || `${resolvedDir.replace(/[\\/]$/, "")}\\metadata\\cover.jpg`;
      bridge.getThumbnail(resolvedDir, candidate)
        .then((thumb) => {
          if (thumb) {
            setPreviews((prev) => ({ ...prev, batch_cover: thumb }));
          }
        })
        .catch(() => {
          bridge.getThumbnail(resolvedDir, resolvedDir)
            .then((thumb) => {
              if (thumb) setPreviews((prev) => ({ ...prev, batch_cover: thumb }));
            })
            .catch(() => {});
        });
    }

    // 2. Fetch individual track or photo thumbnails
    for (const item of items) {
      const itemKey = `item-${item.index}`;
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
                ...(item.outputPath ? { [item.outputPath]: thumb } : {}),
              }));
            }
          })
          .catch(() => {});
      }
    }
  }, [items, outputDir, summary.outputDir, summary.coverArtPath, previews]);

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

  async function openItemFile(item: InProgressItem) {
    const dir = summary.outputDir || outputDir;
    if (!dir || !item.outputPath) return;
    try {
      const fullPath = item.outputPath.includes(":\\") || item.outputPath.startsWith("/")
        ? item.outputPath
        : `${dir.replace(/[\\/]$/, "")}\\${item.outputPath}`;
      await bridge.openFile(fullPath);
    } catch (err) {
      onStatus(`Could not open file: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  // Empty state when nothing has been converted
  if (items.length === 0 && !running) {
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenRawConsole}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            >
              <Terminal size={13} /> Raw Console
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
      </div>
    );
  }

  const effectiveProgress = progress > 0 ? progress : summary.overallProgress;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1180px] flex-1 flex-col gap-4 min-h-0">
      {/* 1. Header Bar */}
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono-label">Active Workspace</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-.04em] text-white">In Progress View.</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Visual cards and cover art for active media downloads and conversions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(running || paused) && (
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

          {!running && events.length > 0 && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
              title="Clear finished or aborted conversion list"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}

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
              const itemKey = `item-${item.index}`;
              const preview = previews[item.id] || previews[itemKey] || (item.outputPath && previews[item.outputPath]) || previews["batch_cover"];
              const isActive = item.status === "downloading" || item.status === "transcoding";

              return (
                <div
                  key={item.id}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-[#0b0916]/80 p-3.5 transition-all ${
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

                  {/* Card Footer: Status Badge + Action Button */}
                  <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
                    {renderStatusBadge(item)}

                    {item.status === "ready" && item.outputPath && (
                      <button
                        type="button"
                        onClick={() => void openItemFile(item)}
                        className="rounded p-1 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors"
                        title="Open converted file"
                        aria-label={"Open " + item.title}
                      >
                        <ExternalLink size={12} />
                      </button>
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
              const itemKey = `item-${item.index}`;
              const preview = previews[item.id] || previews[itemKey] || (item.outputPath && previews[item.outputPath]) || previews["batch_cover"];
              const isActive = item.status === "downloading" || item.status === "transcoding";

              return (
                <div
                  key={item.id}
                  className={`flex flex-wrap items-center gap-3.5 px-4 py-3 transition-colors ${
                    isActive ? "bg-fuchsia-500/[0.04]" : "hover:bg-white/[0.02]"
                  }`}
                >
                  <span className="w-6 text-center font-mono text-xs text-zinc-500">#{item.index}</span>

                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[0.08] bg-black/40 shadow-sm">
                    {preview ? (
                      <img src={preview} alt="" className="size-full object-cover transition-transform duration-300 hover:scale-105" />
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

                  <div className="shrink-0">{renderStatusBadge(item)}</div>

                  {item.status === "ready" && item.outputPath && (
                    <button
                      type="button"
                      onClick={() => void openItemFile(item)}
                      className="rounded p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors"
                      title="Open file"
                      aria-label={"Open " + item.title}
                    >
                      <ExternalLink size={13} />
                    </button>
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
    </div>
  );
}
