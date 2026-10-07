import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Clipboard,
  Copy,
  ExternalLink,
  FileAudio,
  FileImage,
  FilePlus2,
  Files,
  FileVideo,
  FolderOpen,
  Info,
  Link2,
  ListMusic,
  LoaderCircle,
  LockKeyhole,
  Music2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { AccessStatus, Category, ConverterEvent, ConverterSettings, FetchedMedia, PlaylistCatalog, RuntimeInfo } from "../bridge";
import { bridge } from "../bridge";
import {
  audioFormats,
  detectCategoryFromPath,
  formatsFor,
  imageFormats,
  imageQualityLabel,
  intentPresets,
  type IntentPreset,
  qualitiesFor,
  resolutionLabel,
  resolutions,
  videoFormats,
  videoQualityLabel,
} from "../options";
import { PlaylistDialog } from "./PlaylistDialog";
import { FlpConverterView } from "./FlpConverterView";

function isFacebookPostLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return (host === "facebook.com" || host.endsWith(".facebook.com")) && (
      path.startsWith("/share/p/") ||
      path.includes("/permalink/") ||
      path.includes("/posts/") ||
      path.endsWith("/story.php")
    );
  } catch {
    return false;
  }
}

type SocialPhotoPlatform = "instagram" | "twitter" | "tiktok" | "reddit" | "tumblr" | "pinterest";
const SOCIAL_PHOTO_PLATFORM_LABELS: Record<SocialPhotoPlatform, string> = {
  instagram: "Instagram",
  twitter: "X/Twitter",
  tiktok: "TikTok",
  reddit: "Reddit",
  tumblr: "Tumblr",
  pinterest: "Pinterest",
};

function socialPhotoPlatformLabel(platform: SocialPhotoPlatform): string {
  return SOCIAL_PHOTO_PLATFORM_LABELS[platform];
}

function isInstagramVideoRoute(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (!(host === "instagram.com" || host.endsWith(".instagram.com"))) return false;
    return /^\/(?:[^/]+\/)?reels?\/[^/]+\/?$/.test(path);
  } catch {
    return false;
  }
}

function socialPhotoPlatform(value: string): SocialPhotoPlatform | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if ((host === "instagram.com" || host.endsWith(".instagram.com")) && /^\/(?:(?!(?:accounts|explore|stories|direct|about|developer)\/)[^/]+\/)?(?:p|reels?)\/[^/]+\/?$/.test(path)) return "instagram";
    if ((host === "x.com" || host === "www.x.com" || host === "twitter.com" || host === "www.twitter.com") && /\/status\/\d+/.test(path)) return "twitter";
    if ((host === "tiktok.com" || host.endsWith(".tiktok.com")) && (/\/photo\/\d+/.test(path) || path.startsWith("/t/") || path.startsWith("/share/photo/"))) return "tiktok";
    if ((host === "reddit.com" || host.endsWith(".reddit.com")) && (/\/comments\//.test(path) || path.startsWith("/gallery/"))) return "reddit";
    if ((host === "tumblr.com" || host.endsWith(".tumblr.com")) && (/\/post\/\d+/.test(path) || /^\/[^/]+\/\d+/.test(path))) return "tumblr";
    if ((host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it")
      && (host === "pin.it" || path.startsWith("/pin/") || /^\/[^/]+\/[^/]+(?:\/[^/]+)?\/?$/.test(path))) return "pinterest";
    return null;
  } catch {
    return null;
  }
}

function normalizeDroppedPath(value: string): string {
  const clean = value.trim();
  if (!/^file:\/\//i.test(clean)) return clean;
  try {
    const url = new URL(clean);
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) return `\\\\${url.hostname}${pathname.replace(/\//g, "\\")}`;
    return pathname.replace(/^\/([a-z]:)/i, "$1").replace(/\//g, "\\");
  } catch {
    return clean.replace(/^file:\/\/\/?/i, "").replace(/\//g, "\\");
  }
}

export interface QueueItem {
  id: string;
  source: string;
  name: string;
  category: Category;
  status: "queued" | "converting" | "completed" | "failed";
  progress: number;
  outputPath?: string;
  errorMessage?: string;
}

function SelectField({
  label,
  value,
  values,
  onChange,
  disabled = false,
  formatValue,
  hint,
}: {
  label: string;
  value: string | number;
  values: Array<string | number>;
  onChange: (value: string) => void;
  disabled?: boolean;
  formatValue?: (item: string | number) => string;
  hint?: string;
}) {
  return (
    <label className={`block min-w-0 ${disabled ? "opacity-50" : ""}`}>
      <span className="mb-2 block text-[11px] font-medium text-zinc-500">{label}</span>
      <span className="relative block">
        <select
          aria-label={label}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="field w-full appearance-none px-3 py-2.5 pr-9 text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {values.map((item) => (
            <option key={item} value={item} className="bg-[#0c0914] text-zinc-200">
              {formatValue ? formatValue(item) : String(item)}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
      </span>
      {hint && <span className="mt-1.5 block text-[10px] leading-relaxed text-zinc-600">{hint}</span>}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-3 transition-colors ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:border-white/[0.12]"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-[#c52b68] disabled:cursor-not-allowed"
      />
      <span className="min-w-0">
        <span className="block text-xs text-zinc-300">{label}</span>
        {hint && <span className="mt-1 block text-[10px] leading-relaxed text-zinc-600">{hint}</span>}
      </span>
    </label>
  );
}

export function ConverterView({
  settings,
  runtime,
  events,
  access,
  selectedCapture,
  running,
  paused = false,
  progress,
  status,
  onSettings,
  onStart,
  onCancel,
  onPauseToggle,
  onCaptureBusyChange,
  onCreateAccess,
  onClearAccess,
  onStatus,
  onError,
}: {
  settings: ConverterSettings;
  runtime: RuntimeInfo | null;
  events: ConverterEvent[];
  access: AccessStatus;
  selectedCapture?: FetchedMedia | null;
  running: boolean;
  paused?: boolean;
  progress: number;
  status: string;
  onSettings: (next: ConverterSettings) => void;
  onStart: (source: string, playlistIndexes?: string, facebookCaptureId?: string, socialCaptureId?: string, detectedMediaKind?: "photo" | "video") => Promise<void | boolean>;
  onCancel: () => Promise<void>;
  onPauseToggle?: () => Promise<void> | void;
  onCaptureBusyChange?: (busy: boolean, cancelCapture?: (() => Promise<void>) | null) => void;
  onCreateAccess: (source: string) => Promise<AccessStatus>;
  onClearAccess: () => Promise<void>;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [source, setSource] = useState("");
  const [converterTab, setConverterTab] = useState<"media" | "flp">("media");
  const [playlist, setPlaylist] = useState<PlaylistCatalog | null>(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const presetBaselineRef = useRef<ConverterSettings | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessNotice, setAccessNotice] = useState("");
  const [accessNoticeTone, setAccessNoticeTone] = useState<"neutral" | "success" | "error">("neutral");
  const [facebookCaptureBusy, setFacebookCaptureBusy] = useState(false);
  const facebookCaptureIdRef = useRef<string | null>(null);
  const facebookPostLink = isFacebookPostLink(source);
  const [socialCaptureBusy, setSocialCaptureBusy] = useState(false);
  const socialCaptureIdRef = useRef<string | null>(null);
  const [localPaused, setLocalPaused] = useState(false);
  const effectivePaused = paused || localPaused;
  // Queue and completion state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const activeQueueIndexRef = useRef<number>(-1);
  const [completedItem, setCompletedItem] = useState<{ name: string; path?: string } | null>(null);
  const [copiedCompleted, setCopiedCompleted] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const isOperationActive = running || effectivePaused || facebookCaptureBusy || socialCaptureBusy || queueRunning;

  const capturedCategory = selectedCapture?.mediaKind
    ? selectedCapture.mediaKind === "image"
      ? "Image"
      : selectedCapture.mediaKind === "audio"
      ? "Audio"
      : "Video"
    : null;
  const capturedFormat = selectedCapture?.mediaKind
    ? selectedCapture.mediaKind === "image"
      ? "jpg"
      : selectedCapture.mediaKind === "audio"
      ? "mp3"
      : "mp4"
    : null;

  const activeCategory = (capturedCategory || settings.category) === "Music" ? "Audio" : (capturedCategory || settings.category);
  const activeFormat = capturedFormat || settings.format;
  const formats = useMemo(() => formatsFor(activeCategory), [activeCategory]);
  const qualities = useMemo(() => qualitiesFor(activeFormat, activeCategory), [activeFormat, activeCategory]);
  const isSourceFormat = activeFormat === "source";
  const isVideo = isSourceFormat
    ? activeCategory === "Video"
    : videoFormats.includes(activeFormat) && activeCategory !== "Image";
  const isImage = isSourceFormat
    ? activeCategory === "Image"
    : imageFormats.includes(activeFormat) && (activeCategory === "Image" || !videoFormats.includes(activeFormat));
  const isAudio = audioFormats.includes(activeFormat) || (isSourceFormat && (activeCategory === "Audio" || activeCategory === "Music"));
  const presetCategory = activeCategory === "Video" || activeCategory === "Image" ? activeCategory : "Audio";
  const visiblePresets = intentPresets.filter((preset) => preset.group === (presetCategory === "Audio" ? "Music" : presetCategory) || preset.group === "Other");
  const hardwareAccelerationDisabled = !isVideo || isSourceFormat || activeFormat === "gif" || (runtime !== null && runtime !== undefined && !runtime.gpuAvailable);
  const lastEvent = events.length ? events[events.length - 1] : null;

  useEffect(() => {
    if (!formats.includes(settings.format)) {
      onSettings({ ...settings, format: formats[0], bitrate: qualitiesFor(formats[0], activeCategory)[0] });
    }
  }, [formats, settings, onSettings]);

  useEffect(() => {
    if (access.bridgeConnected) {
      setAccessBusy(false);
      setAccessNotice(`Browser capture received through ${access.browser || "your browser"}. The selected media is ready to convert.`);
      setAccessNoticeTone("success");
      return;
    }
    if (access.browser) {
      setAccessBusy(false);
      setAccessNotice(`Access confirmed in ${access.browser}. Open the JaneConverter Browser Capture extension and capture the visible media before converting.`);
      setAccessNoticeTone("success");
    }
  }, [access.bridgeConnected, access.browser]);

  useEffect(() => {
    if (!selectedCapture?.mediaKind) return;
    const nextCategory = selectedCapture.mediaKind === "image" ? "Image" : selectedCapture.mediaKind === "audio" ? "Audio" : "Video";
    const nextFormat = selectedCapture.mediaKind === "image" ? "jpg" : selectedCapture.mediaKind === "audio" ? "mp3" : "mp4";
    if (settings.category !== nextCategory || settings.format !== nextFormat) {
      onSettings({ ...settings, category: nextCategory, format: nextFormat, bitrate: qualitiesFor(nextFormat)[0] });
    }
  }, [selectedCapture?.mediaKind]);

  // Track finished completions and queue progress
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.kind === "finished") {
      let outName = "media file";
      if (lastEvent.message.startsWith("Conversion complete: ")) {
        outName = lastEvent.message.replace("Conversion complete: ", "").trim();
      } else if (lastEvent.output) {
        outName = lastEvent.output.replace(/^.*[\\/]/, "");
      }
      const outPath = lastEvent.output || (settings.outputDir ? `${settings.outputDir.replace(/[\\/]+$/, "")}/${outName}` : undefined);
      setCompletedItem({ name: outName, path: outPath });

      if (queueRunning && activeQueueIndexRef.current >= 0) {
        setQueue((curr) =>
          curr.map((item, idx) => {
            if (idx === activeQueueIndexRef.current) {
              return { ...item, status: "completed", progress: 1.0, outputPath: outPath };
            }
            return item;
          })
        );
      }
    } else if (lastEvent.kind === "failed") {
      if (queueRunning && activeQueueIndexRef.current >= 0) {
        setQueue((curr) =>
          curr.map((item, idx) => {
            if (idx === activeQueueIndexRef.current) {
              return { ...item, status: "failed", errorMessage: lastEvent.message };
            }
            return item;
          })
        );
      }
    } else if (lastEvent.kind === "cancelled") {
      if (queueRunning) {
        setQueueRunning(false);
        const abortedIdx = activeQueueIndexRef.current;
        activeQueueIndexRef.current = -1;
        if (abortedIdx >= 0) {
          setQueue((curr) =>
            curr.map((item, idx) => (idx === abortedIdx && item.status === "converting" ? { ...item, status: "queued", progress: 0 } : item))
          );
        }
      }
    }
  }, [lastEvent, queueRunning, settings.outputDir]);

  // Sequential queue runner
  useEffect(() => {
    if (!queueRunning) return;
    if (running || effectivePaused) return;

    const nextIdx = queue.findIndex((item) => item.status === "queued");
    if (nextIdx === -1) {
      setQueueRunning(false);
      activeQueueIndexRef.current = -1;
      onStatus("Batch conversion queue completed.");
      return;
    }

    activeQueueIndexRef.current = nextIdx;
    setQueue((curr) =>
      curr.map((item, idx) => (idx === nextIdx ? { ...item, status: "converting", progress: 0.05 } : item))
    );
    const targetItem = queue[nextIdx];
    void onStart(targetItem.source);
  }, [queueRunning, running, effectivePaused, queue, onStart, onStatus]);

  const update = (patch: Partial<ConverterSettings>) => {
    presetBaselineRef.current = null;
    setSelectedPresetId(null);
    onSettings({ ...settings, ...patch });
  };

  function handleSourceInput(val: string) {
    setSource(val);
    const detected = detectCategoryFromPath(val);
    if (detected && detected !== settings.category) {
      update({ category: detected });
    }
  }

  async function paste() {
    try {
      const value = await navigator.clipboard.readText();
      handleSourceInput(value.trim());
      onStatus("Source pasted from clipboard.");
    } catch {
      onStatus("Clipboard access was unavailable. Paste directly into the source field.");
    }
  }

  async function browseFile() {
    try {
      if (bridge.chooseFiles) {
        const paths = await bridge.chooseFiles();
        if (paths && paths.length > 1) {
          const newItems: QueueItem[] = paths.map((p, idx) => ({
            id: `${Date.now()}-${idx}`,
            source: p,
            name: p.replace(/^.*[\\/]/, ""),
            category: detectCategoryFromPath(p) || activeCategory,
            status: "queued",
            progress: 0,
          }));
          setQueue((curr) => [...curr, ...newItems]);
          onStatus(`Added ${paths.length} items to conversion queue.`);
          return;
        }
        if (paths && paths.length === 1) {
          handleSourceInput(paths[0]);
          onStatus("Local media file selected.");
          return;
        }
      }
    } catch {
      // Fallback to single chooseFile
    }
    const path = await bridge.chooseFile();
    if (path) {
      handleSourceInput(path);
      onStatus("Local media file selected.");
    }
  }

  async function browseBatch() {
    try {
      const paths = bridge.chooseFiles ? await bridge.chooseFiles() : [];
      if (!paths || paths.length === 0) return;
      const newItems: QueueItem[] = paths.map((p, idx) => ({
        id: `${Date.now()}-${idx}`,
        source: p,
        name: p.replace(/^.*[\\/]/, ""),
        category: detectCategoryFromPath(p) || activeCategory,
        status: "queued",
        progress: 0,
      }));
      setQueue((curr) => [...curr, ...newItems]);
      onStatus(`Added ${paths.length} items to conversion queue.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleSingleSource(rawInput: string) {
    let clean = rawInput.trim();
    if (clean.startsWith("file://")) {
      try {
        clean = decodeURIComponent(clean.replace(/^file:\/\/\/?/, ""));
        if (/^[a-zA-Z]:/.test(clean)) {
          clean = clean.replace(/\//g, "\\");
        }
      } catch {}
    }
    handleSourceInput(clean);
    onStatus(`Source set to: ${clean.replace(/^.*[\\/]/, "") || clean}`);
  }

  async function handleDroppedPaths(paths: string[]) {
    if (!paths || paths.length === 0) return;
    let inspectedPaths: Array<{ path: string; isLibraryPath: boolean }>;
    try {
      inspectedPaths = await Promise.all(paths.map(async (path) => {
        const normalizedPath = normalizeDroppedPath(path);
        return {
          path: normalizedPath,
          isLibraryPath: await bridge.isConvertedLibraryPath(normalizedPath),
        };
      }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "JaneConverter could not verify the dropped file location, so it was ignored.");
      return;
    }

    const rejectedCount = inspectedPaths.filter((item) => item.isLibraryPath).length;
    const acceptedPaths = inspectedPaths.filter((item) => !item.isLibraryPath).map((item) => item.path);
    if (rejectedCount > 0) {
      onStatus("Converted-library files can be dragged out to other apps, but can't be dropped back into JaneConverter.");
    }
    if (acceptedPaths.length === 0) return;

    if (acceptedPaths.length === 1) {
      handleSingleSource(acceptedPaths[0]);
    } else {
      const newItems: QueueItem[] = acceptedPaths.map((p, idx) => {
        const clean = p.trim();
        return {
          id: `${Date.now()}-${idx}`,
          source: clean,
          name: clean.replace(/^.*[\\/]/, "") || clean,
          category: detectCategoryFromPath(clean) || activeCategory,
          status: "queued",
          progress: 0,
        };
      });
      setQueue((curr) => [...curr, ...newItems]);
      onStatus(`Added ${acceptedPaths.length} items to conversion queue.`);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  }

  function handleDropEvent(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    // 1. Files dropped via browser/webview
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const fileList = Array.from(e.dataTransfer.files);
      const filePaths = fileList
        .map((f) => (f as any).path || (f as any).webkitRelativePath || f.name)
        .filter(Boolean);
      if (filePaths.length > 0) {
        handleDroppedPaths(filePaths);
        return;
      }
    }

    // 2. URLs or plain text dragged from browser
    const uriList = e.dataTransfer.getData("text/uri-list");
    const plainText = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text");
    const droppedText = (uriList || plainText || "").trim();

    if (droppedText) {
      const lines = droppedText.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1) {
        void handleDroppedPaths(lines);
      } else {
        void handleDroppedPaths([lines[0]]);
      }
    }
  }

  // Native Tauri drag-and-drop listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) => {
          return getCurrentWebview().onDragDropEvent((event) => {
            if (event.payload.type === "over" || event.payload.type === "enter") {
              setIsDraggingOver(true);
            } else if (event.payload.type === "leave") {
              setIsDraggingOver(false);
            } else if (event.payload.type === "drop") {
              setIsDraggingOver(false);
              if (event.payload.paths && event.payload.paths.length > 0) {
                handleDroppedPaths(event.payload.paths);
              }
            }
          });
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    }
    return () => {
      unlisten?.();
    };
  }, [activeCategory]);

  async function browseOutput() {
    const path = await bridge.chooseFolder();
    if (path) update({ outputDir: path });
  }

  async function loadPlaylist() {
    if (!source.trim()) {
      onStatus("Paste a playlist or album URL first.");
      return;
    }
    setLoadingPlaylist(true);
    try {
      const catalog = await bridge.loadPlaylist(source.trim());
      setPlaylist(catalog);
      onStatus(`Loaded ${catalog.items.length} tracks from ${catalog.title}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled/i.test(message)) onStatus("Playlist loading cancelled.");
      else onError(message);
    } finally {
      setLoadingPlaylist(false);
    }
  }

  async function createAccess() {
    setAccessBusy(true);
    const sourceUrl = source.trim();
    setAccessNotice(sourceUrl ? "Creating a temporary access page and opening your browser..." : "Creating a browser capture session and opening your browser...");
    setAccessNoticeTone("neutral");
    try {
      const nextAccess = await onCreateAccess(sourceUrl);
      if (nextAccess.browser) {
        setAccessNotice(`Access page opened in ${nextAccess.browser}. Confirm access there, then use the Browser Capture extension to capture the visible media.`);
        setAccessNoticeTone("success");
      } else {
        setAccessNotice("Access page opened. Direct brute-force extraction is active in JaneConverter; no localhost website required.");
        setAccessNoticeTone("neutral");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAccessNotice(message);
      setAccessNoticeTone("error");
    } finally {
      setAccessBusy(false);
    }
  }

  async function clearAccess() {
    setAccessBusy(true);
    try {
      await onClearAccess();
      setAccessNotice("Account access cleared. Future conversions will use public-only extraction.");
      setAccessNoticeTone("neutral");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAccessNotice(message);
      setAccessNoticeTone("error");
    } finally {
      setAccessBusy(false);
    }
  }

  async function copyAccessLink() {
    try {
      await navigator.clipboard.writeText(access.link);
      setAccessNotice("Temporary access link copied to the clipboard.");
      setAccessNoticeTone("success");
    } catch {
      setAccessNotice("The link could not be copied. Use Open link instead.");
      setAccessNoticeTone("error");
    }
  }

  async function openAccessLink() {
    try {
      if (/localhost|127\.0\.0\.1|::1/i.test(access.link)) {
        setAccessNotice("Direct extraction is active in JaneConverter. Localhost pages do not need to be opened in your browser.");
        setAccessNoticeTone("neutral");
        return;
      }
      await bridge.openUrl(access.link);
      setAccessNotice("Access page opened in your browser.");
      setAccessNoticeTone("neutral");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAccessNotice(message);
      setAccessNoticeTone("error");
    }
  }

  async function convert(indexes?: string) {
    if (queue.length > 0) {
      setQueueRunning(true);
      return;
    }
    if (!source.trim() && !access.bridgeConnected) {
      onStatus("Paste a source URL, choose a local file, or capture media in the browser first.");
      return;
    }
    const trimmedSource = source.trim();
    const photoPlatform = socialPhotoPlatform(trimmedSource);
    const explicitVideoFormat = activeCategory === "Video" && isVideo && !isSourceFormat;
    if (explicitVideoFormat && (isFacebookPostLink(trimmedSource) || isInstagramVideoRoute(trimmedSource))) {
      const platformLabel = isFacebookPostLink(trimmedSource) ? "Facebook" : "Instagram";
      onStatus(`Sending this ${platformLabel} post to the video converter...`);
      await onStart(trimmedSource, indexes);
      return;
    }
    if (isFacebookPostLink(trimmedSource)) {
      const captureId = crypto.randomUUID();
      facebookCaptureIdRef.current = captureId;
      setFacebookCaptureBusy(true);
      onStatus("Reading the public Facebook post in a hidden guest session...");
      let sessionTransferredToConversion = false;
      try {
        const capture = await bridge.captureFacebookAlbum(trimmedSource, captureId);
        let started: void | boolean;
        if (capture.mediaKind === "video") {
          onStatus("This Facebook post contains video. Starting the video conversion...");
          started = await onStart(trimmedSource, indexes, undefined, undefined, "video");
        } else {
          onStatus(`Found ${capture.photoCount} photos. Starting the local download...`);
          started = await onStart(trimmedSource, undefined, capture.captureId);
        }
        sessionTransferredToConversion = started !== false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/cancelled|canceled/i.test(message)) onStatus(message);
        else onError(message);
      } finally {
        if (!sessionTransferredToConversion && facebookCaptureIdRef.current === captureId) {
          try {
            await bridge.cancelFacebookAlbum(captureId);
          } catch {
            // Preserve the original conversion error; the capture expires automatically.
          }
        }
        facebookCaptureIdRef.current = null;
        setFacebookCaptureBusy(false);
      }
      return;
    }
    if (photoPlatform) {
      if (photoPlatform === "instagram" && isInstagramVideoRoute(trimmedSource)) {
        onStatus("Sending this Instagram post to the video converter...");
        await onStart(trimmedSource, indexes, undefined, undefined, "video");
        return;
      }
      const captureId = crypto.randomUUID();
      socialCaptureIdRef.current = captureId;
      setSocialCaptureBusy(true);
      const platformLabel = socialPhotoPlatformLabel(photoPlatform);
      onStatus(`Reading the public ${platformLabel} post in a hidden guest session...`);
      try {
        const capture = await bridge.captureSocialPostPhotos(trimmedSource, captureId);
        if (capture.mediaKind === "video") {
          onStatus(`This ${platformLabel} post contains video. Starting the video conversion...`);
          await onStart(trimmedSource, indexes, undefined, undefined, "video");
        } else {
          onStatus(`Found ${capture.photoCount} photos. Starting the local download...`);
          await onStart(trimmedSource, undefined, undefined, capture.captureId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (photoPlatform === "twitter" && message === "NO_PUBLIC_PHOTOS") {
          onStatus("No X/Twitter photos found. Passing the post to the standard media downloader...");
          await onStart(trimmedSource, indexes, undefined, undefined, "video");
        } else if (/cancelled|canceled/i.test(message)) {
          onStatus(message);
        } else {
          onError(message);
        }
      } finally {
        socialCaptureIdRef.current = null;
        setSocialCaptureBusy(false);
      }
      return;
    }
    await onStart(trimmedSource, indexes);
  }

  async function cancelFacebookCapture() {
    const captureId = facebookCaptureIdRef.current;
    if (!captureId) return;
    facebookCaptureIdRef.current = null;
    try {
      await bridge.cancelFacebookAlbum(captureId);
      onStatus("Facebook photo capture aborted.");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function cancelSocialPhotoCapture() {
    const captureId = socialCaptureIdRef.current;
    if (!captureId) return;
    try {
      await bridge.cancelSocialPostPhotos(captureId);
      onStatus("Public photo capture aborted.");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handlePauseToggle() {
    if (!isOperationActive) return;
    if (onPauseToggle) {
      await onPauseToggle();
      return;
    }
    try {
      if (effectivePaused) {
        await bridge.resumeConversion();
        setLocalPaused(false);
        onStatus("Resumed conversion.");
      } else {
        await bridge.pauseConversion();
        setLocalPaused(true);
        onStatus("Paused conversion.");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleAbort() {
    setLocalPaused(false);
    if (queueRunning) {
      setQueueRunning(false);
      const abortedIdx = activeQueueIndexRef.current;
      activeQueueIndexRef.current = -1;
      if (abortedIdx >= 0) {
        setQueue((curr) =>
          curr.map((item, idx) => (idx === abortedIdx && item.status === "converting" ? { ...item, status: "queued", progress: 0 } : item))
        );
      }
    }
    if (facebookCaptureBusy) {
      await cancelFacebookCapture();
    }
    if (socialCaptureBusy) {
      await cancelSocialPhotoCapture();
    }
    if (running) {
      await onCancel();
    } else if (!facebookCaptureBusy && !socialCaptureBusy) {
      onStatus("Operation aborted.");
    }
  }

  useEffect(() => {
    const busy = facebookCaptureBusy || socialCaptureBusy || queueRunning;
    onCaptureBusyChange?.(busy, busy ? handleAbort : null);
  }, [facebookCaptureBusy, socialCaptureBusy, queueRunning]);

  function applyPreset(preset: IntentPreset) {
    if (selectedPresetId === preset.id) {
      const previous = presetBaselineRef.current;
      if (previous) {
        onSettings({
          ...settings,
          category: previous.category,
          format: previous.format,
          bitrate: previous.bitrate,
          sampleRate: previous.sampleRate,
          resolution: previous.resolution,
          normalize: previous.normalize,
          useGpu: previous.useGpu,
        });
      }
      presetBaselineRef.current = null;
      setSelectedPresetId(null);
      onStatus(`${preset.name} unselected. Your previous conversion settings were restored.`);
      return;
    }
    if (selectedPresetId === null) presetBaselineRef.current = settings;

    if (preset.preserveQuality) {
      onSettings({
        ...settings,
        category: (["Audio", "Video", "Image"].includes(activeCategory) ? activeCategory : preset.category) as Category,
        format: preset.format,
        resolution: "original",
        normalize: false,
        useGpu: settings.useGpu,
        bitrate: qualitiesFor(preset.format)[0],
      });
      setSelectedPresetId(preset.id);
      onStatus(`Applied ${preset.name} preset: ${preset.description}.`);
      return;
    }
    onSettings({
      ...settings,
      category: preset.category,
      format: preset.format,
      bitrate: preset.bitrate,
      sampleRate: preset.sampleRate,
      resolution: preset.resolution,
      normalize: preset.normalize,
      useGpu: settings.useGpu || preset.useGpu,
    });
    setSelectedPresetId(preset.id);
    onStatus(`Applied ${preset.name} preset: ${preset.description}.`);
  }

  return (
    <div className="mx-auto max-w-[1180px] space-y-3.5 pb-2">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex items-end justify-between gap-5">
        <div>
          <div className="mono-label">Universal media studio</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-.04em] text-white">Convert with less friction.</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">Keep the source behavior you already trust, with a calmer workspace around it.</p>
        </div>
        <div className="hidden rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[11px] text-zinc-500 md:block">
          <span className={`mr-2 inline-block size-1.5 rounded-full ${runtime?.pythonReady ? "bg-emerald-400" : "bg-amber-400"}`} />
          {runtime?.pythonReady ? "Python engine ready" : "Engine setup required"}
        </div>
      </motion.div>

      {/* Converter Type Sub-Navigation Switcher */}
      <div className="inline-flex rounded-xl border border-white/[0.08] bg-white/[0.025] p-1">
        <button
          type="button"
          aria-pressed={converterTab === "media"}
          onClick={() => setConverterTab("media")}
          className={"rounded-lg px-3 py-1.5 text-xs font-medium transition-colors " + (converterTab === "media" ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300")}
        >
          Media Converter
        </button>
        <button
          type="button"
          aria-pressed={converterTab === "flp"}
          onClick={() => setConverterTab("flp")}
          className={"rounded-lg px-3 py-1.5 text-xs font-medium transition-colors " + (converterTab === "flp" ? "border border-[#c52b68]/40 bg-[#c52b68]/20 text-rose-300 shadow-[0_0_15px_rgba(197,43,104,0.15)]" : "text-zinc-500 hover:text-zinc-300")}
        >
          FL Studio Project (.flp)
        </button>
      </div>

      {converterTab === "flp" ? (
        <FlpConverterView onStatus={onStatus} />
      ) : (
        <>
          {/* Source Input Section */}
          <section
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropEvent}
        className={`panel p-4 relative transition-all duration-200 ${
          isDraggingOver
            ? "border-[#c52b68] bg-[#c52b68]/[0.08] shadow-[0_0_30px_rgba(197,43,104,0.22)] ring-1 ring-[#c52b68]"
            : ""
        }`}
      >
        {isDraggingOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#c52b68] bg-black/65 backdrop-blur-sm">
            <ArrowDownToLine className="size-8 animate-bounce text-pink-400" />
            <div className="mt-2 text-sm font-semibold text-white">Drop media or web links here</div>
            <div className="mt-0.5 text-xs text-pink-300">Drop a file or URL to set source, or multiple files for batch queue</div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-200">Source media</div>
            <div className="mt-1 text-xs text-zinc-600">Paste or drag a public URL, choose or drop files, or queue a batch.</div>
          </div>
          <span className="text-[11px] text-zinc-600">{queue.length > 0 ? `${queue.length} items queued` : source ? "Source provided" : "Ready for URL, drop, or path"}</span>
        </div>
        <div className="mt-4 flex gap-2">
          <input
            aria-label="Source media URL or local path"
            value={source}
            disabled={isOperationActive}
            onChange={(event) => handleSourceInput(event.target.value)}
            onDragOver={handleDragOver}
            onDrop={handleDropEvent}
            placeholder="Paste a media or Facebook post link, or drop local files..."
            className="field min-w-0 flex-1 px-3.5 py-3 text-sm placeholder:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button type="button" disabled={isOperationActive} onClick={() => void paste()} className="subtle-button flex items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            <Clipboard className="size-3.5" /> Paste
          </button>
          <button type="button" disabled={isOperationActive} onClick={() => void browseFile()} className="subtle-button flex items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            <FilePlus2 className="size-3.5" /> Browse
          </button>
          <button type="button" disabled={isOperationActive} onClick={() => void browseBatch()} className="subtle-button flex items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            <Files className="size-3.5" /> Batch
          </button>
          <button
            type="button"
            disabled={loadingPlaylist || isOperationActive}
            onClick={() => void loadPlaylist()}
            className="subtle-button flex items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ListMusic className="size-3.5" /> {loadingPlaylist ? "Loading..." : "Playlist tracks"}
          </button>
        </div>

        {/* Account Access */}
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <LockKeyhole className="size-3.5 text-zinc-600" /> Optional browser capture <span className="text-zinc-700">- session only</span>
            </div>
            <span
              className={`text-[11px] ${
                access.bridgeConnected
                  ? "text-emerald-400"
                  : access.browser
                  ? "text-emerald-400"
                  : access.active
                  ? "text-amber-300"
                  : "text-zinc-600"
              }`}
            >
              {access.bridgeConnected
                ? `Browser capture received through ${access.browser || "browser"}`
                : access.browser
                ? `Access confirmed in ${access.browser}`
                : access.active
                ? "Access page open"
                : "Public access first"}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-zinc-600">
            {selectedCapture
              ? "Fetched media selected from the browser capture inbox. Choose your output settings and convert it whenever you are ready."
              : access.bridgeConnected
              ? "Browser Capture connected for this session. Keep capturing from the active browser page; every item is kept temporarily in the Fetched Media tab. This access session does not affect unrelated URL or local-file conversions."
              : access.active
              ? "Open the media in this browser, sign in if needed, confirm access here, then open the JaneConverter Browser Capture extension. Choose Capture current media or Capture story sequence. Unrelated URL and local-file conversions remain public/local."
              : "Public access is tried first. If a supported site requires sign-in, yt-dlp automatically retries using your default browser's existing session. Cookies are used temporarily and are not exported to a file. Browser Capture below offers another way to send visible media to JaneConverter."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {access.active ? (
              <button type="button" disabled={accessBusy} onClick={() => void clearAccess()} className="subtle-button px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50">
                {accessBusy ? "Working..." : "Clear access"}
              </button>
            ) : (
              <button
                type="button"
                disabled={accessBusy || running}
                onClick={() => void createAccess()}
                className="subtle-button flex items-center gap-2 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {accessBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}{" "}
                {accessBusy ? "Opening access page..." : "Create access link"}
              </button>
            )}
          </div>
          {accessNotice && (
            <div
              role="status"
              aria-live="polite"
              className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed ${
                accessNoticeTone === "success"
                  ? "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-300"
                  : accessNoticeTone === "error"
                  ? "border-rose-400/20 bg-rose-400/[0.05] text-rose-300"
                  : "border-white/[0.08] bg-white/[0.025] text-zinc-400"
              }`}
            >
              {accessNoticeTone === "success" ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              ) : accessNoticeTone === "error" ? (
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <Info className="mt-0.5 size-3.5 shrink-0" />
              )}
              <span>{accessNotice}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setNotesOpen((value) => !value)}
          className="mt-4 flex items-center gap-2 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <Info className="size-3.5" /> Source notes and common failures <span className="text-zinc-700">{notesOpen ? "Hide" : "Show"}</span>
        </button>
        {notesOpen && (
          <div className="mt-3 grid gap-3 rounded-xl border border-white/[0.06] bg-black/15 p-4 text-[11px] leading-relaxed text-zinc-500 md:grid-cols-3">
            <div>
              <div className="mb-1 text-zinc-300">Apple Music</div>
              Public catalog links provide metadata and artwork, not a normal downloadable subscription stream. Region restrictions, removed tracks, music videos, alternate versions, and missing public matches can fail. Direct song links with a track selector work best.
            </div>
            <div>
              <div className="mb-1 text-zinc-300">Spotify</div>
              Spotify provides metadata; JaneConverter searches supported public sources for a matching stream. Private, deleted, region-locked, or mismatched tracks can fail.
            </div>
            <div>
              <div className="mb-1 text-zinc-300">Other sources and files</div>
              Age gates, login walls, bot checks, rate limits, provider changes, unreadable local files, FFmpeg availability, permissions, and free disk space can affect conversion. Console has the exact detail.
            </div>
          </div>
        )}
      </section>

      {/* Lightweight Batch Queue Section */}
      {queue.length > 0 && (
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Files className="size-4 text-[#c52b68]" />
              <div className="text-sm font-medium text-zinc-200">Conversion Queue</div>
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] text-zinc-400">{queue.length} items</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQueue([])}
                disabled={queueRunning}
                className="subtle-button px-2.5 py-1 text-xs text-zinc-500 hover:text-rose-400 disabled:opacity-50"
              >
                Clear queue
              </button>
            </div>
          </div>
          <div className="mt-3 divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-black/15">
            {queue.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {item.category === "Image" ? (
                    <FileImage className="size-4 text-sky-400 shrink-0" />
                  ) : item.category === "Video" ? (
                    <FileVideo className="size-4 text-[#c52b68] shrink-0" />
                  ) : (
                    <FileAudio className="size-4 text-emerald-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-zinc-200">{item.name}</div>
                    <div className="truncate text-[10px] text-zinc-600">{item.source}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {item.status === "converting" && (
                    <span className="flex items-center gap-1.5 text-[11px] text-amber-300">
                      <LoaderCircle className="size-3 animate-spin" /> Converting...
                    </span>
                  )}
                  {item.status === "completed" && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                        <CheckCircle2 className="size-3" /> Done
                      </span>
                      {item.outputPath && (
                        <button
                          type="button"
                          onClick={() => void bridge.openFile(item.outputPath!)}
                          className="subtle-button px-2 py-0.5 text-[10px] text-emerald-300"
                        >
                          Open
                        </button>
                      )}
                    </div>
                  )}
                  {item.status === "failed" && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[11px] text-rose-400" title={item.errorMessage}>
                        <AlertCircle className="size-3" /> Failed
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setQueue((curr) =>
                            curr.map((it) => (it.id === item.id ? { ...it, status: "queued", errorMessage: undefined } : it))
                          );
                          if (!queueRunning) setQueueRunning(true);
                        }}
                        className="subtle-button px-2 py-0.5 text-[10px] text-zinc-400 hover:text-white"
                      >
                        <RotateCcw className="size-2.5" /> Retry
                      </button>
                    </div>
                  )}
                  {item.status === "queued" && <span className="text-[11px] text-zinc-600">Queued</span>}
                  <button
                    type="button"
                    disabled={item.status === "converting"}
                    onClick={() => setQueue((curr) => curr.filter((it) => it.id !== item.id))}
                    className="text-zinc-600 hover:text-rose-400 disabled:opacity-30"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Output & Presets Parameters */}
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-200">Output and conversion presets</div>
            <div className="mt-0.5 text-xs text-zinc-600">Select an intent goal or fine-tune settings below.</div>
          </div>
          <span className="hidden items-center gap-1.5 text-[11px] text-zinc-400 sm:inline-flex">
            <Wand2 className="size-3.5" style={{ color: "var(--accent-color)" }} aria-hidden="true" /> 1-click presets
          </span>
        </div>

        {/* Intent Presets Toolbar */}
        <div className="mt-2.5 overflow-hidden rounded-xl border border-white/[0.08] bg-black/15">
          <div className="grid grid-cols-3 border-b border-white/[0.08]" aria-label="Preset categories">
            {(["Audio", "Video", "Image"] as const).map((category) => (
              <button
                key={category}
                type="button"
                aria-pressed={presetCategory === category}
                onClick={() => update({ category })}
                className="preset-category-button min-h-9 border-b-2 border-transparent px-3 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px]"
              >
                {category}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5 p-2 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePresets.map((preset) => {
              const isSelected = selectedPresetId === preset.id;
              const Icon = preset.id === "preserve-quality" ? ShieldCheck : preset.id === "universal-video" ? FileVideo : preset.id === "studio-cinematic" ? Clapperboard : preset.id === "lossless-image" ? FileImage : Music2;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => applyPreset(preset)}
                  className="preset-choice-button flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-left text-xs text-zinc-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  title={isSelected ? `Unselect ${preset.name} and restore your previous settings` : preset.description}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary Controls */}
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <SelectField
            label="Container format"
            value={activeFormat}
            values={formats}
            formatValue={(format) =>
              format === "source"
                ? "Source (preserve original)"
                : format === "alac"
                  ? "ALAC (M4A container)"
                  : String(format).toUpperCase()
            }
            onChange={(format) => update({ format, bitrate: qualitiesFor(format, activeCategory)[0] })}
          />
          <div className="flex items-end">
            <button
              type="button"
              role="switch"
              aria-checked={showAdvanced}
              aria-controls="advanced-conversion-parameters"
              onClick={() => setShowAdvanced((v) => !v)}
              className="advanced-settings-switch inline-flex min-h-9 items-center gap-2 rounded-lg px-1 text-xs text-zinc-300 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2"
            >
              <span aria-hidden="true" className="advanced-settings-track relative h-5 w-9 rounded-full bg-zinc-700 transition-colors">
                <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${showAdvanced ? "translate-x-4" : ""}`} />
              </span>
              Advanced settings
            </button>
          </div>
        </div>

        {/* Collapsible Advanced Parameters */}
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              id="advanced-conversion-parameters"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <SelectField
                    label={isVideo ? "Video quality" : isImage ? "Image quality" : "Audio bitrate / quality"}
                    value={isImage ? "best" : settings.bitrate}
                    values={qualities}
                    formatValue={(v) => (isVideo ? videoQualityLabel(String(v)) : isImage ? imageQualityLabel(String(v), activeFormat) : String(v))}
                    onChange={(bitrate) => update({ bitrate })}
                    disabled={isSourceFormat}
                    hint={
                      isSourceFormat
                        ? "Source output keeps the original quality settings."
                        : isVideo
                        ? "Controls compression and file size; resolution is set separately."
                        : undefined
                    }
                  />
                  <SelectField
                    label="Video resolution"
                    value={settings.resolution}
                    values={resolutions}
                    formatValue={(v) => resolutionLabel(String(v))}
                    onChange={(resolution) => update({ resolution })}
                    disabled={!isVideo || isSourceFormat}
                    hint={!isVideo ? "Available for video output." : isSourceFormat ? "Source output keeps its original dimensions." : undefined}
                  />
                  <SelectField
                    label="Audio sample rate"
                    value={settings.sampleRate}
                    values={[44100, 48000, 96000]}
                    onChange={(sampleRate) => update({ sampleRate: Number(sampleRate) })}
                    disabled={!isAudio || isSourceFormat}
                    hint={!isAudio ? "Available for audio output." : isSourceFormat ? "Source output keeps its original audio." : undefined}
                  />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <Toggle
                    checked={settings.normalize}
                    onChange={(normalize) => update({ normalize })}
                    label="EBU R128 normalization"
                    hint={isAudio ? "-14 LUFS streaming target" : "Available for audio output."}
                    disabled={!isAudio || isSourceFormat}
                  />
                  <Toggle
                    checked={settings.saveCover}
                    onChange={(saveCover) => update({ saveCover })}
                    label="Embed and save cover art"
                    hint={isImage ? "Available for audio and video sources." : "Artwork or thumbnail when available"}
                    disabled={isImage}
                  />
                  <Toggle
                    checked={settings.saveMetadata}
                    onChange={(saveMetadata) => update({ saveMetadata })}
                    label="Export metadata and credits"
                    hint="Human-readable .txt metadata"
                  />
                  <Toggle
                    checked={settings.useGpu}
                    onChange={(useGpu) => update({ useGpu })}
                    label="Hardware acceleration"
                    hint={
                      hardwareAccelerationDisabled
                        ? !isVideo || isSourceFormat
                          ? "Available for encoded video output."
                          : activeFormat === "gif"
                          ? "GIF output uses its own frame conversion."
                          : "No supported GPU detected. CPU mode is available."
                        : runtime?.gpuLabel || "Use the available video hardware encoder."
                    }
                    disabled={hardwareAccelerationDisabled}
                  />
                </div>
                {isImage && isSourceFormat && (
                  <div className="mt-3 max-w-md">
                    <Toggle
                      checked={settings.allowPngFallback ?? false}
                      onChange={(allowPngFallback) => update({ allowPngFallback })}
                      label="Allow PNG recovery"
                      hint="If the original image cannot be validated, save a lossless PNG instead and show the format change. The source stays untouched."
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* 1-Click Completion Banner */}
      {completedItem && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3.5 text-xs text-zinc-200"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
              <div>
                <div className="font-medium text-white">{completedItem.name}</div>
                <div className="text-[11px] text-zinc-400">Conversion finished and verified via ffprobe.</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {completedItem.path && (
                <button
                  type="button"
                  onClick={() => void bridge.openFile(completedItem.path!)}
                  className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-300 hover:text-white"
                >
                  <ExternalLink className="size-3.5" /> Open file
                </button>
              )}
              <button
                type="button"
                onClick={() => void bridge.openPath(settings.outputDir)}
                className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <FolderOpen className="size-3.5" /> Open folder
              </button>
              {completedItem.path && (
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(completedItem.path!);
                    setCopiedCompleted(true);
                    setTimeout(() => setCopiedCompleted(false), 2000);
                  }}
                  className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
                >
                  <Copy className="size-3.5" /> {copiedCompleted ? "Copied!" : "Copy path"}
                </button>
              )}
              {completedItem.path && (
                <button
                  type="button"
                  onClick={() => {
                    handleSourceInput(completedItem.path!);
                    setCompletedItem(null);
                    onStatus("Output file loaded as new conversion source.");
                  }}
                  className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
                >
                  Use as source
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Unified Export Destination & Convert Action Panel */}
      <section className="panel overflow-hidden p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-center">
          {/* Left Column: Export Destination */}
          <div className="lg:col-span-7">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                <FolderOpen className="size-3.5 text-zinc-400" /> Export folder
              </div>
              <span className="hidden sm:inline text-[10px] text-zinc-500 truncate">Default: project-local converted media</span>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                aria-label="Export folder"
                value={settings.outputDir}
                onChange={(event) => update({ outputDir: event.target.value })}
                className="field h-9 min-w-0 flex-1 px-3 text-xs"
              />
              <button type="button" onClick={() => void browseOutput()} className="subtle-button inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 px-3 text-xs whitespace-nowrap">
                Browse
              </button>
              <button type="button" onClick={() => void bridge.openPath(settings.outputDir)} className="subtle-button inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 px-3 text-xs whitespace-nowrap">
                <FolderOpen className="size-3.5" /> Open
              </button>
            </div>
          </div>

          {/* Right Column: Compact Convert Action & High-Visibility Progress Bar */}
          <div className="flex flex-col justify-center border-t border-white/[0.06] pt-3 lg:col-span-5 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isOperationActive}
                onClick={() => void convert()}
                className="primary-button flex h-9.5 flex-1 items-center justify-center gap-2 px-4 text-xs font-semibold shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="size-3.5 fill-current" />
                Convert media
              </button>
              {isOperationActive && (
                <>
                  <button
                    type="button"
                    onClick={() => void handlePauseToggle()}
                    className="subtle-button flex h-9.5 items-center gap-1.5 px-3 text-xs font-medium text-amber-300 hover:text-amber-200"
                    aria-label={effectivePaused ? "Resume operation" : "Pause operation"}
                  >
                    {effectivePaused ? <Play className="size-3 fill-current" /> : <Pause className="size-3" />}
                    {effectivePaused ? "Resume" : "Pause"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAbort()}
                    className="danger-button flex h-9.5 items-center gap-1.5 px-3 text-xs"
                    aria-label="Abort operation"
                  >
                    <Square className="size-3" /> Abort
                  </button>
                </>
              )}
            </div>

            {/* High-visibility progress bar & percentage */}
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className={`truncate ${isOperationActive ? "text-zinc-200 font-medium" : "text-zinc-500"}`}>
                  {effectivePaused ? `Paused — ${status || "Operation paused"}` : status || "Ready to convert"}
                </span>
                <span
                  className="shrink-0 font-mono font-bold text-xs"
                  style={{ color: isOperationActive ? "var(--accent-color, #ec4899)" : "#71717a" }}
                >
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.06] p-[1px] ring-1 ring-white/10">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: "linear-gradient(to right, var(--accent-color, #c52b68), var(--accent-hover, #e0407b))",
                    boxShadow: "0 0 8px var(--accent-glow, rgba(197,43,104,0.4))",
                  }}
                  animate={{ width: `${Math.round(progress * 100)}%` }}
                  transition={{ ease: "easeOut", duration: 0.25 }}
                />
              </div>
              {lastEvent && (
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500 truncate">
                  <RefreshCw
                    className={`size-2.5 shrink-0 ${isOperationActive && !effectivePaused ? "animate-spin" : ""}`}
                    style={isOperationActive ? { color: "var(--accent-color, #ec4899)" } : undefined}
                  />
                  <span className="truncate">Engine: {lastEvent.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
        </>
      )}

      {playlist && <PlaylistDialog catalog={playlist} onClose={() => setPlaylist(null)} onConfirm={(indexes) => { setPlaylist(null); void convert(indexes); }} />}
      {loadingPlaylist && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 backdrop-blur-sm">
          <div className="panel flex items-center gap-3 px-5 py-4 text-sm text-zinc-300">
            <RefreshCw className="size-4 animate-spin text-zinc-500" /> Reading playlist catalog...
            <button type="button" className="subtle-button px-3 py-1" onClick={() => void bridge.cancelPlaylist().catch((error) => onError(String(error)))}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
