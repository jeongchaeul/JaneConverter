import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  LayoutGrid,
  List,
  Music,
  Search,
} from "lucide-react";
import { bridge, type Category, type ConverterEvent, type ConversionHistoryItem } from "../bridge";
import { InProgressHeader } from "./inprogress/InProgressHeader";
import { ItemCard } from "./inprogress/ItemCard";
import { ItemContextMenu } from "./inprogress/ItemContextMenu";
import { SessionHistoryModal } from "./inprogress/SessionHistoryModal";
import {
  extractYouTubeThumbnail,
  inferMediaKind,
  parseConversionEvents,
} from "./inprogress/parser";
import type {
  InProgressBatchSummary,
  InProgressItem,
  InProgressItemStatus,
  MediaKind,
  SessionSummary,
} from "./inprogress/types";

export type {
  InProgressBatchSummary,
  InProgressItem,
  InProgressItemStatus,
  MediaKind,
  SessionSummary,
};
export {
  extractYouTubeThumbnail,
  inferMediaKind,
  parseConversionEvents,
};

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

  // Close context menu on outside click or Escape
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

  // Extract distinct chronological jobs from conversion events
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

  // Clear previews when events are completely wiped
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
  const sessionSummaries = useMemo<SessionSummary[]>(() => {
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
    }).reverse();
  }, [distinctJobIds, events, category, format, jobId, running, currentJobId, sourceTitle]);

  // Historical sessions from catalog
  const catalogSessions = useMemo(() => {
    if (!historyItems || historyItems.length === 0) return [];
    return historyItems
      .filter((h) => !distinctJobIds.includes(h.id))
      .slice(0, 25);
  }, [historyItems, distinctJobIds]);

  function getItemPreview(item: InProgressItem): string | undefined {
    const jobKey = currentJobId || "default";
    const itemKey = `item-${item.index}`;

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

    if (item.thumbnail && !failedImages[item.thumbnail]) {
      return item.thumbnail;
    }

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

    if (!previews[batchCoverKey] && summary.coverArtPath) {
      bridge.getThumbnail(resolvedDir, summary.coverArtPath)
        .then((thumb) => {
          if (thumb) setPreviews((prev) => ({ ...prev, [batchCoverKey]: thumb }));
        })
        .catch(() => {});
    }

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

  const effectiveProgress = progress > 0 ? progress : summary.overallProgress;
  const batchCover = getBatchCover();
  const hasOutputDir = Boolean(summary.outputDir || outputDir);

  // Common Header props
  const headerProps = {
    distinctJobCount: distinctJobIds.length,
    currentIndex,
    hasPrevious,
    hasNext,
    running,
    paused,
    isViewingLive,
    liveJobId: jobId,
    hasEvents: events.length > 0,
    isClosePageDisabled,
    isOngoing,
    isSinglePage,
    hasOutputDir,
    onNavigateSession: handleNavigateSession,
    onOpenSessionModal: () => setShowSessionModal(true),
    onJumpToLive: () => { if (jobId) setSelectedJobId(jobId); },
    onPauseToggle,
    onAbort,
    onClear: handleClear,
    onClosePage: handleClosePage,
    onOpenOutputFolder: openOutputFolder,
    onOpenRawConsole,
  };

  // Empty state when nothing has been converted in this session or overall
  if (items.length === 0 && !isViewingLive) {
    return (
      <div className="mx-auto flex h-full w-full max-w-[1180px] flex-1 flex-col justify-between gap-6 min-h-0">
        <InProgressHeader {...headerProps} />

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

        <SessionHistoryModal
          open={showSessionModal}
          onClose={() => setShowSessionModal(false)}
          sessionSummaries={sessionSummaries}
          catalogSessions={catalogSessions}
          onSelectSession={(id) => setSelectedJobId(id)}
          onRemoveSession={(id) => {
            if (currentJobId === id) handleClear();
            else onClear?.(id);
          }}
          onRestoreSession={onRestoreSession}
          onNavigateToLibrary={onNavigateToLibrary}
        />

        <ItemContextMenu
          contextMenu={contextMenu}
          onClose={() => setContextMenu(null)}
          fullPath={contextMenu ? getItemFullPath(contextMenu.item) : undefined}
          elapsedMs={contextMenu ? getItemElapsedMs(contextMenu.item) : undefined}
          openItemFile={openItemFile}
          showItemInFolder={showItemInFolder}
          openOutputFolder={openOutputFolder}
          onOpenRawConsole={onOpenRawConsole}
          onStatus={onStatus}
          hasOutputDir={hasOutputDir}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[1180px] flex-1 flex-col gap-4 min-h-0">
      {/* 1. Header Bar */}
      <InProgressHeader {...headerProps} />

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
            {displayedItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                layoutMode="grid"
                preview={getItemPreview(item)}
                fullPath={getItemFullPath(item)}
                elapsedMs={getItemElapsedMs(item)}
                onContextMenu={handleContextMenu}
                onImageError={(url) => setFailedImages((prev) => ({ ...prev, [url]: true }))}
                onStatus={onStatus}
                onOpen={openItemFile}
                onShowInFolder={showItemInFolder}
              />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04] rounded-2xl border border-white/[0.07] bg-[#0c0a1a]/70 backdrop-blur-md">
            {displayedItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                layoutMode="list"
                preview={getItemPreview(item)}
                fullPath={getItemFullPath(item)}
                elapsedMs={getItemElapsedMs(item)}
                onContextMenu={handleContextMenu}
                onImageError={(url) => setFailedImages((prev) => ({ ...prev, [url]: true }))}
                onStatus={onStatus}
                onOpen={openItemFile}
                onShowInFolder={showItemInFolder}
              />
            ))}
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

      <SessionHistoryModal
        open={showSessionModal}
        onClose={() => setShowSessionModal(false)}
        sessionSummaries={sessionSummaries}
        catalogSessions={catalogSessions}
        onSelectSession={(id) => setSelectedJobId(id)}
        onRemoveSession={(id) => {
          if (currentJobId === id) handleClear();
          else onClear?.(id);
        }}
        onRestoreSession={onRestoreSession}
        onNavigateToLibrary={onNavigateToLibrary}
      />

      <ItemContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        fullPath={contextMenu ? getItemFullPath(contextMenu.item) : undefined}
        elapsedMs={contextMenu ? getItemElapsedMs(contextMenu.item) : undefined}
        openItemFile={openItemFile}
        showItemInFolder={showItemInFolder}
        openOutputFolder={openOutputFolder}
        onOpenRawConsole={onOpenRawConsole}
        onStatus={onStatus}
        hasOutputDir={hasOutputDir}
      />
    </div>
  );
}
