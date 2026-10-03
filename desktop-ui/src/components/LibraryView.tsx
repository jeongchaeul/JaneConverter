import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileAudio,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  GripVertical,
  History,
  ImageIcon,
  Play,
  RefreshCw,
  Trash2,
  Video,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import type { ConversionHistoryItem, ConverterSettings, LibraryEntry } from "../bridge";
import { bridge } from "../bridge";
import { detectCategoryFromPath, formatElapsedMs } from "../options";

function size(value: number) {
  return value < 1024 * 1024
    ? Math.round(value / 1024) + " KB"
    : (value / (1024 * 1024)).toFixed(1) + " MB";
}

function cleanPath(value: string) {
  return value.trim().replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
}

function pathKey(value: string) {
  return cleanPath(value).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function isInside(root: string, candidate: string) {
  const rootKey = pathKey(root);
  const candidateKey = pathKey(candidate);
  return candidateKey === rootKey || candidateKey.startsWith(rootKey + "\\");
}

function parentPath(value: string) {
  const index = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
  return index > 0 ? value.slice(0, index) : value;
}

function baseName(value: string) {
  const trimmed = value.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function joinPath(parent: string, name: string) {
  return parent.replace(/[\\/]+$/, "") + "\\" + name;
}

const HISTORY_PAGE_SIZE = 20;
type LibrarySection = "explorer" | "recent" | "history";
type MediaFilter = "all" | "audio" | "video" | "image" | "metadata";
type PreviewSetter = (update: (current: Record<string, string>) => Record<string, string>) => void;

const MEDIA_FILTERS: Array<{ id: MediaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "audio", label: "Audios" },
  { id: "video", label: "Videos" },
  { id: "image", label: "Images" },
  { id: "metadata", label: "Metadata" },
];

function isMetadataEntry(entry: LibraryEntry) {
  return entry.path.split(/[\\/]+/).some((part) => part.toLowerCase() === "metadata");
}

function matchesMediaFilter(entry: LibraryEntry, filter: MediaFilter) {
  if (filter === "all" || entry.isDirectory) return true;
  const inMetadataFolder = isMetadataEntry(entry);
  if (filter === "metadata") return inMetadataFolder;
  if (inMetadataFolder) return false;
  const category = detectCategoryFromPath(entry.path);
  if (filter === "audio") return category === "Audio";
  if (filter === "video") return category === "Video";
  return category === "Image";
}

type PendingAction =
  | { kind: "move"; destination: string }
  | { kind: "delete"; entry: LibraryEntry };

function mediaIcon(entry: LibraryEntry) {
  if (isMetadataEntry(entry)) {
    return <FileText size={17} />;
  }
  const category = detectCategoryFromPath(entry.path);
  if (category === "Image") return <ImageIcon size={17} />;
  if (category === "Video") return <Video size={17} />;
  return <FileAudio size={17} />;
}

export function LibraryView({
  settings,
  onSettings,
  onStatus,
  history = [],
  conversionTimings = {},
  onClearHistory,
  onRemoveHistoryItem,
}: {
  settings: ConverterSettings;
  onSettings: (settings: ConverterSettings) => void;
  onStatus: (message: string) => void;
  history?: ConversionHistoryItem[];
  conversionTimings?: Record<string, number>;
  onClearHistory?: () => void;
  onRemoveHistoryItem?: (id: string) => void;
}) {
  const [root, setRoot] = useState(settings.outputDir);
  const [currentPath, setCurrentPath] = useState(settings.outputDir);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [recentEntries, setRecentEntries] = useState<LibraryEntry[]>([]);
  const [recentPreviews, setRecentPreviews] = useState<Record<string, string>>({});
  const [section, setSection] = useState<LibrarySection>("explorer");
  const [historyPage, setHistoryPage] = useState(1);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [loading, setLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: LibraryEntry } | null>(null);
  const refreshSequence = useRef(0);
  const recentRefreshSequence = useRef(0);
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);
  const libraryDragActive = useRef(false);
  const suppressClickUntil = useRef(0);

  const [copiedSourceId, setCopiedSourceId] = useState<string | null>(null);

  function copySourcePath(id: string, source: string) {
    void navigator.clipboard.writeText(source);
    setCopiedSourceId(id);
    setTimeout(() => {
      setCopiedSourceId((current) => (current === id ? null : current));
    }, 2000);
    onStatus("Copied source path to clipboard.");
  }


  function entryElapsedMs(entry: LibraryEntry): number | undefined {
    if (entry.conversionMs !== undefined) return entry.conversionMs;
    return conversionTimings[pathKey(entry.path)];
  }

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

  function handleContextMenu(e: React.MouseEvent, entry: LibraryEntry) {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 230;
    const menuHeight = 250;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 12);
    setContextMenu({ x, y, entry });
  }

  useEffect(() => {
    if (!pendingAction) return;
    cancelConfirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingAction(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingAction]);

  async function loadPreviews(
    scanned: LibraryEntry[],
    libraryRoot: string,
    token: number,
    isCurrent: () => boolean,
    setPreview: PreviewSetter,
  ) {
    const candidates = scanned.slice(0, 24);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < candidates.length) {
        const entry = candidates[nextIndex++];
        try {
          const preview = await bridge.getThumbnail(libraryRoot, entry.path);
          if (preview && isCurrent()) {
            setPreview((current) => ({ ...current, [entry.path]: preview }));
          }
        } catch {
          // A missing cover, unsupported codec, or unavailable FFmpeg should not block browsing.
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
  }

  async function refresh(path = currentPath, libraryRoot = root) {
    const token = ++refreshSequence.current;
    setLoading(true);
    try {
      const scanned = await bridge.scanLibrary(path);
      if (token !== refreshSequence.current) return;
      setEntries(scanned);
      setPreviews({});
      void loadPreviews(scanned, libraryRoot, token, () => token === refreshSequence.current, setPreviews);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (token === refreshSequence.current) setLoading(false);
    }
  }

  async function refreshRecent(libraryRoot = root) {
    const token = ++recentRefreshSequence.current;
    setRecentLoading(true);
    try {
      const scanned = await bridge.recentConversions(libraryRoot, 100);
      if (token !== recentRefreshSequence.current) return;
      setRecentEntries(scanned);
      setRecentPreviews({});
      void loadPreviews(scanned, libraryRoot, token, () => token === recentRefreshSequence.current, setRecentPreviews);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (token === recentRefreshSequence.current) setRecentLoading(false);
    }
  }

  useEffect(() => {
    setRoot(settings.outputDir);
    setCurrentPath(settings.outputDir);
    void refresh(settings.outputDir, settings.outputDir);
    void refreshRecent(settings.outputDir);
  }, [settings.outputDir]);

  function navigate(path: string) {
    if (!isInside(root, path)) {
      onStatus("For safety, the library browser cannot leave the configured export folder.");
      return;
    }
    setCurrentPath(path);
    void refresh(path);
  }

  function goBack() {
    if (pathKey(currentPath) === pathKey(root)) return;
    const parent = parentPath(currentPath);
    navigate(isInside(root, parent) ? parent : root);
  }

  async function openPath(path: string) {
    try {
      await bridge.openPath(path);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function openFile(path: string) {
    try {
      await bridge.openFile(path);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function dragFile(event: React.DragEvent, entry: LibraryEntry) {
    if (entry.isDirectory) return;
    event.preventDefault();
    event.stopPropagation();
    libraryDragActive.current = true;
    void bridge.dragLibraryFile(entry.path)
      .catch((error) => {
        onStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        libraryDragActive.current = false;
        suppressClickUntil.current = Date.now() + 400;
      });
  }

  function rejectLibraryDrop(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function preventClickAfterDragOut(event: React.MouseEvent) {
    if (!libraryDragActive.current && Date.now() > suppressClickUntil.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  async function moveLibrary() {
    const destinationParent = await bridge.chooseFolder();
    if (!destinationParent) return;
    const destination = joinPath(destinationParent, baseName(root));
    if (pathKey(destinationParent) === pathKey(parentPath(root))) {
      onStatus("Choose a different parent folder for the library.");
      return;
    }
    if (isInside(root, destinationParent)) {
      onStatus("The new library location cannot be inside the current library.");
      return;
    }
    setPendingAction({ kind: "move", destination });
  }

  async function confirmPendingAction() {
    const action = pendingAction;
    if (!action) return;
    setPendingAction(null);

    if (action.kind === "move") {
      setMoving(true);
      try {
        const result = await bridge.moveLibrary(root, parentPath(action.destination));
        const movedTo = result.destination;
        const nextSettings = { ...settings, outputDir: movedTo };
        onSettings(nextSettings);
        onStatus(result.cleanupWarning ?? ("Library moved to " + movedTo + "."));
      } catch (error) {
        onStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setMoving(false);
      }
      return;
    }

    try {
      await bridge.deleteLibraryEntry(root, action.entry.path);
      onStatus(action.entry.name + " deleted.");
      if (section === "recent") {
        await refreshRecent();
      } else {
        await refresh(currentPath);
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function remove(entry: LibraryEntry) {
    setPendingAction({ kind: "delete", entry });
  }

  function handleClearTempHistory() {
    onClearHistory?.();
    setHistoryPage(1);
    void refresh(currentPath);
    void refreshRecent();
  }

  /*
   * Keep confirmation inside the Tauri surface so it matches the design
   * system instead of looking like a browser-owned localhost dialog.
   */
  function pendingActionCopy() {
    if (!pendingAction) return null;
    if (pendingAction.kind === "delete") {
      return {
        title: "Delete media?",
        message: "Delete " + pendingAction.entry.name + "? This cannot be undone.",
        confirm: "Delete file",
      };
    }
    return {
      title: "Move converted library?",
      message: "Move the converted library to " + pendingAction.destination + "? JaneConverter will keep the same library folder name.",
      confirm: "Move library",
    };
  }

  const totalHistoryPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const safeHistoryPage = Math.min(Math.max(1, historyPage), totalHistoryPages);
  const pagedHistory = history.slice((safeHistoryPage - 1) * HISTORY_PAGE_SIZE, safeHistoryPage * HISTORY_PAGE_SIZE);
  const confirmation = pendingActionCopy();
  const atRoot = pathKey(currentPath) === pathKey(root);
  const visibleEntries = section === "recent"
    ? recentEntries
    : entries.filter((entry) => matchesMediaFilter(entry, mediaFilter));
  const visiblePreviews = section === "recent" ? recentPreviews : previews;
  const activeLoading = section === "recent" ? recentLoading : loading;

  function removePreview(path: string) {
    const setPreview = section === "recent" ? setRecentPreviews : setPreviews;
    setPreview((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
  }

  return (
    <div
      className="mx-auto max-w-[1180px] space-y-5 pb-10"
      onClickCapture={preventClickAfterDragOut}
      onDropCapture={rejectLibraryDrop}
    >
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono-label">Project library</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] text-white">Converted media.</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {section === "history"
              ? "Review conversion history, presets, quality, elapsed time, and operation outcomes."
              : section === "recent"
              ? "Find recent conversions and drag a file into another app."
              : "Browse converted media and drag a file into another app."}
          </p>
          <div className="mt-4 inline-flex rounded-xl border border-white/[0.08] bg-white/[0.025] p-1">
            <button
              type="button"
              aria-pressed={section === "explorer"}
              onClick={() => setSection("explorer")}
              className={"rounded-lg px-3 py-2 text-xs transition-colors " + (section === "explorer" ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300")}
            >
              Library
            </button>
            <button
              type="button"
              aria-pressed={section === "recent"}
              onClick={() => setSection("recent")}
              className={"rounded-lg px-3 py-2 text-xs transition-colors " + (section === "recent" ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300")}
            >
              Recents
            </button>
            <button
              type="button"
              aria-pressed={section === "history"}
              onClick={() => setSection("history")}
              className={"rounded-lg px-3 py-2 text-xs transition-colors " + (section === "history" ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300")}
            >
              History
            </button>
          </div>
          {section === "explorer" && (
            <div className="mt-2 inline-flex flex-wrap rounded-xl border border-white/[0.08] bg-white/[0.025] p-1" role="group" aria-label="Filter library by media type">
              {MEDIA_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={mediaFilter === filter.id}
                  onClick={() => setMediaFilter(filter.id)}
                  className={"rounded-lg px-3 py-2 text-xs transition-colors " + (mediaFilter === filter.id ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300")}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {section === "history" ? (
            <button
              type="button"
              onClick={handleClearTempHistory}
              className="subtle-button flex items-center gap-2 px-3 py-2 text-xs text-rose-300 hover:border-rose-500/40"
            >
              <Trash2 className="size-3.5" /> Clear Temp History
            </button>
          ) : (
            <button type="button" onClick={() => void (section === "recent" ? refreshRecent() : refresh())} className="subtle-button flex items-center gap-2 px-3 py-2 text-xs">
              <RefreshCw className={"size-3.5 " + (activeLoading ? "animate-spin" : "")} /> Refresh
            </button>
          )}
        </div>
      </motion.div>

      {section !== "history" && (
        <section className="panel space-y-3 p-4">
          {section === "explorer" && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <button
                type="button"
                disabled={atRoot}
                title={atRoot ? "Already at the library root" : "Go to the parent folder"}
                onClick={goBack}
                className={"subtle-button flex items-center gap-2 px-3 py-2 " + (atRoot ? "cursor-not-allowed opacity-40" : "")}
              >
                <ArrowLeft className="size-3.5" /> Back
              </button>
              <span className="truncate font-mono text-[11px] text-zinc-700">{currentPath}</span>
            </div>
          )}
          <div className={"flex flex-wrap items-center justify-between gap-3 " + (section === "explorer" ? "border-t border-white/[0.06] pt-3" : "")}>
            <div>
              <div className="text-xs text-zinc-400">Library root</div>
              <div className="mt-1 truncate font-mono text-[11px] text-zinc-600">{root}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void openPath(root)} className="subtle-button flex items-center gap-2 px-3 py-2 text-xs">
                <ExternalLink className="size-3.5" /> Open folder
              </button>
              <button type="button" disabled={moving} onClick={() => void moveLibrary()} className="subtle-button flex items-center gap-2 px-3 py-2 text-xs disabled:cursor-wait disabled:opacity-60">
                <FolderInput className={"size-3.5 " + (moving ? "animate-pulse" : "")} /> {moving ? "Moving library..." : "Move library"}
              </button>
            </div>
          </div>
        </section>
      )}

      {section === "history" ? (
        <section className="space-y-2.5">
          {!history.length && (
            <div className="panel py-14 text-center text-sm text-zinc-600">
              <History className="mx-auto mb-2 size-5 text-zinc-600" />
              No temporary conversion history recorded yet.
            </div>
          )}
          {pagedHistory.map((item) => {
            const succeeded = item.status === "succeeded";
            const isPartial = item.status === "partial";
            const hasExported = succeeded || isPartial;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="panel space-y-2.5 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium " +
                          (succeeded
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : isPartial
                            ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                            : "border-rose-400/30 bg-rose-400/10 text-rose-300")
                        }
                      >
                        {succeeded ? (
                          <CheckCircle2 className="size-3" />
                        ) : isPartial ? (
                          <AlertTriangle className="size-3" />
                        ) : (
                          <XCircle className="size-3" />
                        )}
                        {succeeded ? "Succeeded" : isPartial ? "Partial" : "Failed"}
                      </span>
                      <span className="truncate text-sm font-medium text-white">{item.fileName}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-500">
                      <span className="break-all">Source: {item.source}</span>
                      <button
                        type="button"
                        onClick={() => copySourcePath(item.id, item.source)}
                        className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
                        aria-label={`Copy source path for ${item.fileName}`}
                        title={`Copy source path for ${item.fileName}`}
                      >
                        {copiedSourceId === item.id ? (
                          <>
                            <Check size={11} className="text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={11} />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-300">
                      Preset: {item.presetName}
                    </span>
                    <span className="rounded-md border border-pink-500/30 bg-pink-500/10 px-2 py-0.5 font-mono text-pink-200">
                      {item.formatLabel}
                    </span>
                    <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-zinc-300">
                      {item.qualityLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-zinc-400">
                      <Clock className="size-3 text-zinc-500" />
                      {formatElapsedMs(item.elapsedMs)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveHistoryItem?.(item.id)}
                      className="grid size-7 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                      aria-label={`Delete history entry for ${item.fileName}`}
                      title={`Delete ${item.fileName} from history`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {item.fallbackNote && (
                  <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">
                    {item.fallbackNote}
                  </div>
                )}
                {item.errorMessage && !succeeded && (
                  <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {item.errorMessage}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
                  <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">
                    {hasExported ? `Exported: ${item.exportPath}` : `Source: ${item.source}`}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copySourcePath(item.id, item.source)}
                      className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs hover:border-pink-500/40"
                      aria-label={`Copy source path for ${item.fileName}`}
                      title={`Copy source path for ${item.fileName}`}
                    >
                      {copiedSourceId === item.id ? (
                        <>
                          <Check className="size-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied Source</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5 text-zinc-400" />
                          <span>Copy Source Path</span>
                        </>
                      )}
                    </button>
                    {hasExported && (
                      <>
                        <button
                          type="button"
                          draggable
                          onDragStartCapture={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            libraryDragActive.current = true;
                            void bridge.dragLibraryFile(item.exportPath)
                              .catch((error) => {
                                onStatus(error instanceof Error ? error.message : String(error));
                              })
                              .finally(() => {
                                libraryDragActive.current = false;
                                suppressClickUntil.current = Date.now() + 400;
                              });
                          }}
                          onClick={() => onStatus("Drag this button into another app (e.g. FL Studio, Explorer, or Discord).")}
                          className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-grab active:cursor-grabbing hover:border-pink-500/40"
                          title="Drag this file into another app"
                          aria-label={`Drag ${item.fileName} into another app`}
                        >
                          <GripVertical className="size-3.5 text-pink-400" /> Drag File
                        </button>
                        <button
                          type="button"
                          onClick={() => void openFile(item.exportPath)}
                          className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs hover:border-pink-500/40"
                        >
                          <Play className="size-3 text-pink-400" /> Open File
                        </button>
                        <button
                          type="button"
                          onClick={() => void openPath(item.exportPath)}
                          className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
                        >
                          <FolderOpen className="size-3.5" /> Open Path
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
          {totalHistoryPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-3">
              <div className="text-xs text-zinc-400">
                Showing <span className="font-medium text-white">{(safeHistoryPage - 1) * HISTORY_PAGE_SIZE + 1}</span>–
                <span className="font-medium text-white">{Math.min(safeHistoryPage * HISTORY_PAGE_SIZE, history.length)}</span> of{" "}
                <span className="font-medium text-white">{history.length}</span> entries
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safeHistoryPage <= 1}
                  onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                  className="subtle-button flex items-center gap-1 px-2.5 py-1 text-xs disabled:pointer-events-none disabled:opacity-40 hover:border-pink-500/40"
                  aria-label="Previous history page"
                >
                  <ChevronLeft className="size-3.5" /> Previous
                </button>
                <span className="px-2 text-xs font-mono text-zinc-300">
                  {safeHistoryPage} / {totalHistoryPages}
                </span>
                <button
                  type="button"
                  disabled={safeHistoryPage >= totalHistoryPages}
                  onClick={() => setHistoryPage((prev) => Math.min(totalHistoryPages, prev + 1))}
                  className="subtle-button flex items-center gap-1 px-2.5 py-1 text-xs disabled:pointer-events-none disabled:opacity-40 hover:border-pink-500/40"
                  aria-label="Next history page"
                >
                  Next <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          {!visibleEntries.length && <div className="panel py-14 text-center text-sm text-zinc-600">{activeLoading ? "Scanning converted media..." : section === "recent" ? "No recent conversions found in this library." : mediaFilter === "all" ? "No converted media found in this folder." : `No ${MEDIA_FILTERS.find((filter) => filter.id === mediaFilter)?.label.toLowerCase()} found in this folder.`}</div>}
          {visibleEntries.slice(0, 500).map((entry) => {
            const preview = visiblePreviews[entry.path];
            const metadata = isMetadataEntry(entry);
            const elapsed = entryElapsedMs(entry);
            const details = entry.isDirectory
              ? entry.mediaCount + " media item" + (entry.mediaCount === 1 ? "" : "s") + " - " + size(entry.totalBytes)
              : entry.extension + " - " + size(entry.totalBytes);
            return (
              <motion.div
                key={entry.path}
                draggable={!entry.isDirectory && !metadata}
                onDragStartCapture={metadata ? undefined : (event) => dragFile(event, entry)}
                title={entry.isDirectory || metadata ? undefined : "Drag this file into another app"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                whileHover={{ scale: 1.002 }}
                whileTap={{ scale: 0.998 }}
                onClick={() => {
                  if (entry.isDirectory) {
                    navigate(entry.path);
                  }
                }}
                onDoubleClick={(event) => {
                  if (entry.isDirectory || (event.target instanceof Element && event.target.closest("button"))) return;
                  void openFile(entry.path);
                }}
                onContextMenu={(e) => handleContextMenu(e, entry)}
                className={`panel group relative flex flex-wrap items-center gap-3 px-4 py-3 select-none transition-all duration-150 hover:border-pink-500/30 hover:bg-white/[0.04] active:bg-white/[0.06] ${entry.isDirectory ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[0.07] bg-black/15 text-zinc-500">
                  {preview ? (
                    <img
                      src={preview}
                      alt=""
                      draggable={false}
                      className="size-full object-cover"
                      onError={() => removePreview(entry.path)}
                    />
                  ) : entry.isDirectory ? (
                    <Folder className={entry.isPlaylist ? "text-[#d75b88]" : ""} size={17} />
                  ) : (
                    mediaIcon(entry)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-300 group-hover:text-white transition-colors">{entry.name}</div>
                  <div className="mt-1 text-[11px] text-zinc-600">
                    {details}
                    {entry.isPlaylist ? " - playlist" : ""}
                    {elapsed !== undefined ? ` - Converted in ${formatElapsedMs(elapsed)}` : ""}
                  </div>
                  {section === "recent" && <div className="mt-1 truncate font-mono text-[10px] text-zinc-700">{parentPath(entry.path)}</div>}
                </div>
                {entry.isDirectory ? (
                  <button
                    type="button"
                    aria-label={"Open " + entry.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(entry.path);
                    }}
                    className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors hover:border-pink-500/40"
                  >
                    <FolderOpen className="size-3.5 text-pink-400" /> Open
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-label={"Open " + entry.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openFile(entry.path);
                      }}
                      className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors hover:border-pink-500/40"
                    >
                      <Play className="size-3 text-pink-400" /> Open
                    </button>
                    <button
                      type="button"
                      aria-label={"Show " + entry.name + " in folder"}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openPath(entry.path);
                      }}
                      className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <FolderOpen className="size-3.5" /> Show file
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(entry);
                  }}
                  className="grid size-8 place-items-center rounded-lg text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-300"
                  aria-label={"Delete " + entry.name}
                  title={"Delete " + entry.name}
                >
                  <Trash2 size={14} />
                </button>
              </motion.div>
            );
          })}
          {visibleEntries.length > 500 && <div className="text-center text-[11px] text-zinc-700">Showing the first 500 items to keep the library responsive.</div>}
          {!activeLoading && visibleEntries.length > 0 && Object.keys(visiblePreviews).length === 0 && (
            <div className="flex items-center justify-center gap-2 pt-2 text-[11px] text-zinc-700">
              <ImageIcon size={13} /> Covers and previews appear when embedded artwork or a supported video frame is available.
            </div>
          )}
        </section>
      )}

      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 9999,
          }}
          className="context-menu min-w-[220px] rounded-xl border border-white/[0.12] bg-[#0c0914]/95 p-1.5 shadow-2xl shadow-black/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-white/[0.06] px-3 py-2">
            <div className="truncate text-xs font-semibold text-white">{contextMenu.entry.name}</div>
            <div className="text-[10px] text-zinc-500">
              {contextMenu.entry.isDirectory ? "Folder" : `${contextMenu.entry.extension} File`}
            </div>
            <div className="mt-1.5 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px]">
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <Clock size={11} className="text-pink-400" /> Conversion time
              </span>
              <span className="font-mono text-zinc-200">
                {formatElapsedMs(entryElapsedMs(contextMenu.entry))}
              </span>
            </div>
          </div>

          <div className="mt-1 space-y-0.5">
            {contextMenu.entry.isDirectory ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    navigate(contextMenu.entry.path);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-pink-500/15 hover:text-pink-200"
                >
                  <FolderOpen size={13} className="text-pink-400" /> Open folder
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openPath(contextMenu.entry.path);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
                >
                  <ExternalLink size={13} className="text-zinc-400" /> Show in File Explorer
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void openFile(contextMenu.entry.path);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-pink-500/15 hover:text-pink-200"
                >
                  <Play size={13} className="text-pink-400" /> Open / Play file
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openPath(contextMenu.entry.path);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
                >
                  <FolderOpen size={13} className="text-zinc-400" /> Show in File Explorer
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(contextMenu.entry.path);
                onStatus(`Copied path for ${contextMenu.entry.name}`);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
            >
              <Copy size={13} className="text-zinc-400" /> Copy full path
            </button>

            <div className="my-1 border-t border-white/[0.06]" />

            <button
              type="button"
              onClick={() => {
                const target = contextMenu.entry;
                setContextMenu(null);
                remove(target);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-red-500/15 hover:text-red-300"
            >
              <Trash2 size={13} /> {contextMenu.entry.isDirectory ? "Delete folder" : "Delete file"}
            </button>
          </div>
        </div>
      )}

      {pendingAction && confirmation && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingAction(null);
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-confirm-title"
            aria-describedby="library-confirm-description"
            className="panel w-full max-w-md border border-white/[0.10] bg-[#090812]/95 p-5 shadow-2xl shadow-black/60"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className={"grid size-10 shrink-0 place-items-center rounded-xl border " + (pendingAction.kind === "delete" ? "border-red-400/20 bg-red-400/10 text-red-300" : "border-[#d75b88]/20 bg-[#d75b88]/10 text-[#e68aae]")}>
                {pendingAction.kind === "delete" ? <Trash2 size={17} /> : <AlertTriangle size={17} />}
              </div>
              <div className="min-w-0">
                <h2 id="library-confirm-title" className="text-base font-medium text-white">{confirmation.title}</h2>
                <p id="library-confirm-description" className="mt-2 break-words text-sm leading-6 text-zinc-400">{confirmation.message}</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button ref={cancelConfirmRef} type="button" onClick={() => setPendingAction(null)} className="subtle-button px-3 py-2 text-xs">
                Cancel
              </button>
              <button type="button" onClick={() => void confirmPendingAction()} className={"rounded-lg border px-3 py-2 text-xs transition-colors " + (pendingAction.kind === "delete" ? "border-red-400/25 bg-red-400/10 text-red-200 hover:bg-red-400/20" : "border-[#d75b88]/25 bg-[#d75b88]/10 text-[#f0b0c8] hover:bg-[#d75b88]/20")}>
                {confirmation.confirm}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
