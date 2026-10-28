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
  Inbox,
  Info,
  Layers,
  Link2,
  ListMusic,
  ListPlus,
  LoaderCircle,
  LockKeyhole,
  Music2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
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
import { StoryTermsModal } from "./StoryTermsModal";
import { type QueueItem, createQueueItems } from "./converter/queueUtils";
import { ConverterQueue } from "./converter/ConverterQueue";
import { ActionBar } from "./converter/ActionBar";

export function isEphemeralStoryUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const isInsta = host === "instagram.com" || host.endsWith(".instagram.com");
    if (isInsta && /^\/stories\/[^/?#]+/.test(path)) {
      return true;
    }
    const isFb = host === "facebook.com" || host.endsWith(".facebook.com");
    if (isFb && /^\/stories\/\d+/.test(path)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function groupIndexesByPreset(
  indexesStr: string,
  fallbackPreset: IntentPreset | undefined,
  itemOverrides?: Record<number, IntentPreset>
): Array<{ indexes: string; preset: IntentPreset | undefined }> {
  const idxList = indexesStr
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  if (idxList.length === 0) return [];

  if (!itemOverrides || Object.keys(itemOverrides).length === 0) {
    return [{ indexes: idxList.join(","), preset: fallbackPreset }];
  }

  const groups = new Map<string, { preset: IntentPreset | undefined; indexes: number[] }>();

  for (const idx of idxList) {
    const preset = itemOverrides[idx] ?? fallbackPreset;
    const key = preset ? preset.id : "current";
    if (!groups.has(key)) {
      groups.set(key, { preset, indexes: [] });
    }
    groups.get(key)!.indexes.push(idx);
  }

  return Array.from(groups.values()).map((g) => ({
    indexes: g.indexes.sort((a, b) => a - b).join(","),
    preset: g.preset,
  }));
}

function isFacebookPostLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return (host === "facebook.com" || host.endsWith(".facebook.com")) && (
      path.startsWith("/share/p/") ||
      path.includes("/permalink/") ||
      path.includes("/posts/") ||
      path.endsWith("/story.php") ||
      path.includes("/photo") ||
      path.includes("/photos/") ||
      path.includes("/media/set")
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

function isPinterestNotificationRoute(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (!(host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it")) return false;
    const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    return host === "pin.it" || (segs.length >= 1 && (segs[0] === "news_hub" || segs[0] === "notifications" || segs[0] === "multi-pin-share" || segs[0] === "pin" || (segs.length >= 2 && segs[1] === "pin")));
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
    if (host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it") {
      if (host === "pin.it" || path.startsWith("/pin/") || path.startsWith("/multi-pin-share/")) return "pinterest";
      const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
      if (
        segs.length >= 2 &&
        segs.length <= 3 &&
        !/^(?:search|ideas|explore|business|news_hub|notifications|settings|messages|edit|following|feed|today|login|signup|logout|about|resource|multi-pin-share)$/i.test(segs[0])
      ) {
        return "pinterest";
      }
    }
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

export type { QueueItem };

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
  accentColor = "#c52b68",
  onStatus,
  onError,
}: {
  accentColor?: string;
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
  onStart: (
    source: string,
    playlistIndexes?: string,
    facebookCaptureId?: string,
    socialCaptureId?: string,
    detectedMediaKind?: "photo" | "video",
    customSettings?: ConverterSettings,
  ) => Promise<void | boolean>;
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
  const [showStoryTermsModal, setShowStoryTermsModal] = useState(false);
  const [droppedFlpPath, setDroppedFlpPath] = useState<string>("");
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
  const activeQueueItemIdRef = useRef<string | null>(null);
  const isStartingQueueRef = useRef(false);
  const lastHandledEventRef = useRef<ConverterEvent | null>(null);
  const [configuringQueueItem, setConfiguringQueueItem] = useState<QueueItem | null>(null);
  const [loadingQueueConfig, setLoadingQueueConfig] = useState(false);
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
    if (!lastEvent || lastHandledEventRef.current === lastEvent) return;
    lastHandledEventRef.current = lastEvent;

    if (lastEvent.kind === "finished" || (lastEvent.kind as string) === "partial") {
      let outName = "media file";
      if (lastEvent.message.startsWith("Conversion complete: ")) {
        outName = lastEvent.message.replace("Conversion complete: ", "").trim();
      } else if (lastEvent.output) {
        outName = lastEvent.output.replace(/^.*[\\/]/, "");
      }
      const outPath = lastEvent.output || (settings.outputDir ? `${settings.outputDir.replace(/[\\/]+$/, "")}/${outName}` : undefined);
      setCompletedItem({ name: outName, path: outPath });

      const activeId = activeQueueItemIdRef.current;
      if (activeId || queue.some((it) => it.status === "converting")) {
        setQueue((curr) =>
          curr.map((item) => {
            if (item.id === activeId || (item.status === "converting" && !activeId)) {
              return { ...item, status: "completed", progress: 1.0, outputPath: outPath };
            }
            return item;
          })
        );
        activeQueueItemIdRef.current = null;
      }
    } else if (lastEvent.kind === "failed") {
      const activeId = activeQueueItemIdRef.current;
      if (activeId || queue.some((it) => it.status === "converting")) {
        setQueue((curr) =>
          curr.map((item) => {
            if (item.id === activeId || (item.status === "converting" && !activeId)) {
              return { ...item, status: "failed", errorMessage: lastEvent.message };
            }
            return item;
          })
        );
        activeQueueItemIdRef.current = null;
      }
    } else if (lastEvent.kind === "cancelled") {
      if (queueRunning) {
        setQueueRunning(false);
      }
      isStartingQueueRef.current = false;
      const abortedId = activeQueueItemIdRef.current;
      activeQueueItemIdRef.current = null;
      setQueue((curr) =>
        curr.map((item) =>
          item.id === abortedId || item.status === "converting"
            ? { ...item, status: "queued", progress: 0 }
            : item
        )
      );
    }
  }, [lastEvent, queueRunning, settings.outputDir]);

  // Live progress updates for currently converting queue item
  useEffect(() => {
    const activeId = activeQueueItemIdRef.current;
    if (progress > 0) {
      setQueue((curr) =>
        curr.map((item) =>
          (activeId ? item.id === activeId : item.status === "converting") && item.status === "converting"
            ? { ...item, progress }
            : item
        )
      );
    }
  }, [progress]);

  async function executeConversion(
    sourceToConvert: string,
    indexesToConvert?: string,
    customPreset?: IntentPreset
  ): Promise<boolean> {
    const trimmedSource = sourceToConvert.trim();
    if (!trimmedSource && !access.bridgeConnected) return false;
    if (trimmedSource && isEphemeralStoryUrl(trimmedSource) && !settings.allowStoryExtraction) {
      setShowStoryTermsModal(true);
      onStatus("Ephemeral story extraction requires accepting the Terms of Usage and legal compliance agreement.");
      return false;
    }

    const customSettings: ConverterSettings | undefined = customPreset
      ? {
          ...settings,
          category: customPreset.category,
          format: customPreset.format,
          bitrate: customPreset.bitrate,
          sampleRate: customPreset.sampleRate,
          resolution: customPreset.resolution,
          normalize: customPreset.normalize,
          useGpu: customPreset.useGpu,
        }
      : undefined;

    const invokeStart = (
      startSource: string,
      startIndexes?: string,
      startFbId?: string,
      startSocialId?: string,
      startMediaKind?: "photo" | "video",
    ) => {
      if (customSettings) {
        return onStart(startSource, startIndexes, startFbId, startSocialId, startMediaKind, customSettings);
      }
      if (startMediaKind !== undefined) {
        return onStart(startSource, startIndexes, startFbId, startSocialId, startMediaKind);
      }
      if (startSocialId !== undefined) {
        return onStart(startSource, startIndexes, startFbId, startSocialId);
      }
      if (startFbId !== undefined) {
        return onStart(startSource, startIndexes, startFbId);
      }
      return onStart(startSource, startIndexes);
    };

    if (isPinterestNotificationRoute(trimmedSource)) {
      onStatus("Reading Pinterest collection using your browser session...");
      const started = await invokeStart(trimmedSource, indexesToConvert);
      return started !== false;
    }
    if (settings.openInBrowser && /^https?:\/\//i.test(trimmedSource)) {
      void bridge.openUrl(trimmedSource).catch(() => {});
    }
    const photoPlatform = trimmedSource ? socialPhotoPlatform(trimmedSource) : null;
    const categoryToCheck = customSettings ? customSettings.category : activeCategory;
    const formatToCheck = customSettings ? customSettings.format : activeFormat;
    const isSourceToCheck = formatToCheck === "source";
    const isVideoToCheck = isSourceToCheck
      ? categoryToCheck === "Video"
      : videoFormats.includes(formatToCheck) && categoryToCheck !== "Image";
    const explicitVideoFormat = categoryToCheck === "Video" && isVideoToCheck && !isSourceToCheck;
    if (explicitVideoFormat && (isFacebookPostLink(trimmedSource) || isInstagramVideoRoute(trimmedSource) || photoPlatform === "twitter")) {
      const platformLabel = isFacebookPostLink(trimmedSource)
        ? "Facebook"
        : photoPlatform === "twitter"
          ? "X/Twitter"
          : "Instagram";
      onStatus(`Sending this ${platformLabel} post to the video converter...`);
      const started = await invokeStart(trimmedSource, indexesToConvert);
      return started !== false;
    }
    if (isFacebookPostLink(trimmedSource)) {
      if (access.active || settings.readBrowserCookies === true) {
        onStatus("Reading Facebook post using your active browser session...");
        const started = await invokeStart(trimmedSource, indexesToConvert);
        return started !== false;
      }
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
          started = await invokeStart(trimmedSource, indexesToConvert, undefined, undefined, "video");
        } else {
          onStatus(`Found ${capture.photoCount} photos. Starting the local download...`);
          started = await invokeStart(trimmedSource, undefined, capture.captureId);
        }
        sessionTransferredToConversion = started !== false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/cancelled|canceled/i.test(message)) {
          onStatus(message);
        } else {
          onStatus("Facebook guest session unavailable or restricted. Adapting with browser session...");
          try {
            const started = await invokeStart(trimmedSource, indexesToConvert);
            sessionTransferredToConversion = started !== false;
          } catch (fallbackError) {
            onError(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
          }
        }
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
      return sessionTransferredToConversion;
    }
    if (photoPlatform) {
      if (photoPlatform === "instagram" && isInstagramVideoRoute(trimmedSource)) {
        onStatus("Sending this Instagram post to the video converter...");
        const started = await invokeStart(trimmedSource, indexesToConvert, undefined, undefined, "video");
        return started !== false;
      }
      if (photoPlatform === "instagram" && (access.active || settings.readBrowserCookies === true)) {
        onStatus("Reading Instagram post using your active browser session...");
        const started = await invokeStart(trimmedSource, indexesToConvert);
        return started !== false;
      }
      if (photoPlatform === "pinterest" && (access.active || settings.readBrowserCookies === true)) {
        onStatus("Reading Pinterest using your active browser session...");
        const started = await invokeStart(trimmedSource, indexesToConvert);
        return started !== false;
      }
      const captureId = crypto.randomUUID();
      socialCaptureIdRef.current = captureId;
      setSocialCaptureBusy(true);
      const platformLabel = socialPhotoPlatformLabel(photoPlatform);
      onStatus(`Reading the public ${platformLabel} post in a hidden guest session...`);
      let sessionTransferredToConversion = false;
      try {
        const capture = await bridge.captureSocialPostPhotos(trimmedSource, captureId);
        let started: void | boolean;
        if (capture.mediaKind === "video") {
          onStatus(`This ${platformLabel} post contains video. Starting the video conversion...`);
          started = await invokeStart(trimmedSource, indexesToConvert, undefined, undefined, "video");
        } else {
          onStatus(`Found ${capture.photoCount} photos. Starting the local download...`);
          started = await invokeStart(trimmedSource, undefined, undefined, capture.captureId);
        }
        sessionTransferredToConversion = started !== false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/cancelled|canceled/i.test(message)) {
          onStatus(message);
        } else if (photoPlatform === "twitter") {
          onStatus("Adapting: Passing the X/Twitter post to the media downloader...");
          const started = await invokeStart(trimmedSource, indexesToConvert, undefined, undefined, "video");
          sessionTransferredToConversion = started !== false;
        } else {
          onStatus(`Guest session for ${platformLabel} unavailable or restricted. Adapting with browser session...`);
          try {
            const started = await invokeStart(trimmedSource, indexesToConvert);
            sessionTransferredToConversion = started !== false;
          } catch (fallbackError) {
            onError(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
          }
        }
      } finally {
        if (!sessionTransferredToConversion && socialCaptureIdRef.current === captureId) {
          try {
            await bridge.cancelSocialPostPhotos(captureId);
          } catch {
            // Preserve the original conversion error; the capture expires automatically.
          }
        }
        socialCaptureIdRef.current = null;
        setSocialCaptureBusy(false);
      }
      return sessionTransferredToConversion;
    }
    const started = await invokeStart(trimmedSource, indexesToConvert);
    return started !== false;
  }

  // Sequential queue runner
  useEffect(() => {
    if (!queueRunning) return;
    if (running || effectivePaused) return;
    if (isStartingQueueRef.current) return;

    // Do not start next item if an item is already converting
    const currentlyConverting = queue.some((item) => item.status === "converting");
    if (currentlyConverting) return;

    const nextIdx = queue.findIndex((item) => item.status === "queued");
    if (nextIdx === -1) {
      setQueueRunning(false);
      activeQueueItemIdRef.current = null;
      onStatus("Batch conversion queue completed.");
      return;
    }

    const targetItem = queue[nextIdx];
    activeQueueItemIdRef.current = targetItem.id;
    isStartingQueueRef.current = true;

    setQueue((curr) =>
      curr.map((item) => (item.id === targetItem.id ? { ...item, status: "converting", progress: 0.05 } : item))
    );
    if (targetItem.settingsSnapshot) {
      onSettings(targetItem.settingsSnapshot);
    }

    executeConversion(targetItem.source, targetItem.playlistIndexes)
      .then((started) => {
        if (!started) {
          activeQueueItemIdRef.current = null;
          setQueue((curr) =>
            curr.map((it) =>
              it.id === targetItem.id ? { ...it, status: "failed", errorMessage: "Failed to start conversion." } : it
            )
          );
        }
      })
      .catch((err) => {
        activeQueueItemIdRef.current = null;
        setQueue((curr) =>
          curr.map((it) =>
            it.id === targetItem.id
              ? { ...it, status: "failed", errorMessage: err instanceof Error ? err.message : String(err) }
              : it
          )
        );
      })
      .finally(() => {
        isStartingQueueRef.current = false;
      });
  }, [queueRunning, running, effectivePaused, queue, onStart, onStatus, onSettings]);

  function addToQueue(
    customSource?: string,
    customIndexes?: string,
    customCatalog?: PlaylistCatalog,
    customPreset?: IntentPreset,
  ) {
    const raw = customSource !== undefined ? customSource : source;
    const clean = raw.trim();
    if (!clean) {
      onStatus("Enter a source URL or choose a file before adding to queue.");
      return;
    }
    if (isEphemeralStoryUrl(clean) && !settings.allowStoryExtraction) {
      setShowStoryTermsModal(true);
      onStatus("Ephemeral story extraction requires accepting the Terms of Usage and legal compliance agreement.");
      return;
    }

    const detected = detectCategoryFromPath(clean);
    const itemCategory = customPreset ? customPreset.category : ((customCatalog ? "Audio" : detected) || activeCategory);
    const itemName = customCatalog?.title || clean.replace(/^.*[\\/]/, "") || clean;
    const presetName = customPreset
      ? customPreset.name
      : (selectedPresetId ? intentPresets.find((p) => p.id === selectedPresetId)?.name : undefined);

    const snapshotSettings: ConverterSettings = customPreset
      ? {
          ...settings,
          category: customPreset.category,
          format: customPreset.format,
          bitrate: customPreset.bitrate,
          sampleRate: customPreset.sampleRate,
          resolution: customPreset.resolution,
          normalize: customPreset.normalize,
          useGpu: customPreset.useGpu,
        }
      : { ...settings };

    const newItem: QueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: clean,
      name: itemName,
      category: itemCategory,
      status: "queued",
      progress: 0,
      playlistIndexes: customIndexes,
      playlistCatalog: customCatalog,
      presetName,
      settingsSnapshot: snapshotSettings,
    };

    setQueue((curr) => [...curr, newItem]);
    if (!customSource || customSource === source.trim()) {
      setSource("");
    }
    const isStory = isEphemeralStoryUrl(clean);
    const itemLabel = isStory ? "items" : "tracks";
    const trackNote = customIndexes ? ` (${customIndexes.split(",").length} ${itemLabel} selected)` : "";
    onStatus(`Added "${itemName}"${trackNote} to conversion queue.`);
  }

  async function handleConfigureQueueItem(item: QueueItem) {
    if (item.playlistCatalog) {
      setConfiguringQueueItem(item);
      return;
    }
    setLoadingQueueConfig(true);
    onStatus(`Loading playlist catalog for ${item.name}...`);
    try {
      const catalog = await bridge.loadPlaylist(item.source);
      setQueue((curr) =>
        curr.map((it) => (it.id === item.id ? { ...it, playlistCatalog: catalog } : it))
      );
      setConfiguringQueueItem({ ...item, playlistCatalog: catalog });
      onStatus(`Loaded ${catalog.items.length} tracks for ${catalog.title}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(`Could not read playlist tracks for ${item.name}: ${message}`);
    } finally {
      setLoadingQueueConfig(false);
    }
  }

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

  const isBrowsingRef = useRef(false);

  async function browseFile() {
    if (isBrowsingRef.current) return;
    isBrowsingRef.current = true;
    try {
      if (bridge.chooseFiles) {
        const paths = await bridge.chooseFiles();
        if (!paths || paths.length === 0) {
          // User closed or cancelled the file dialog
          return;
        }
        if (paths.length > 1) {
          const newItems = createQueueItems(paths, activeCategory);
          setQueue((curr) => [...curr, ...newItems]);
          onStatus(`Added ${paths.length} items to conversion queue.`);
          return;
        }
        if (paths.length === 1) {
          handleSourceInput(paths[0]);
          onStatus("Local media file selected.");
          return;
        }
      } else {
        const path = await bridge.chooseFile();
        if (path) {
          handleSourceInput(path);
          onStatus("Local media file selected.");
        }
      }
    } catch {
      try {
        const path = await bridge.chooseFile();
        if (path) {
          handleSourceInput(path);
          onStatus("Local media file selected.");
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to open file dialog.");
      }
    } finally {
      isBrowsingRef.current = false;
    }
  }

  async function browseBatch() {
    if (isBrowsingRef.current) return;
    isBrowsingRef.current = true;
    try {
      const paths = bridge.chooseFiles ? await bridge.chooseFiles() : [];
      if (!paths || paths.length === 0) return;
      const newItems = createQueueItems(paths, activeCategory);
      setQueue((curr) => [...curr, ...newItems]);
      onStatus(`Added ${paths.length} items to conversion queue.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      isBrowsingRef.current = false;
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

  const lastProcessedDropRef = useRef<{ signature: string; timestamp: number }>({ signature: "", timestamp: 0 });

  async function handleDroppedPaths(paths: string[]) {
    if (!paths || paths.length === 0) return;
    const signature = paths.slice().sort().join("|||");
    const now = Date.now();
    if (signature === lastProcessedDropRef.current.signature && now - lastProcessedDropRef.current.timestamp < 600) {
      return;
    }
    lastProcessedDropRef.current = { signature, timestamp: now };

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
      const newItems = createQueueItems(acceptedPaths, activeCategory);
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

  const converterTabRef = useRef(converterTab);
  converterTabRef.current = converterTab;

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const handleDroppedPathsRef = useRef(handleDroppedPaths);
  handleDroppedPathsRef.current = handleDroppedPaths;

  // Native Tauri drag-and-drop listener
  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | undefined;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) => {
          if (!isMounted) return;
          return getCurrentWebview().onDragDropEvent((event) => {
            if (!isMounted) return;
            if (event.payload.type === "over" || event.payload.type === "enter") {
              setIsDraggingOver(true);
            } else if (event.payload.type === "leave") {
              setIsDraggingOver(false);
            } else if (event.payload.type === "drop") {
              setIsDraggingOver(false);
              if (event.payload.paths && event.payload.paths.length > 0) {
                if (converterTabRef.current === "flp") {
                  const daw = event.payload.paths.find((p) => {
                    const lower = p.toLowerCase();
                    return lower.endsWith(".flp") || lower.endsWith(".als");
                  });
                  if (daw) {
                    setDroppedFlpPath(daw);
                  } else {
                    onStatusRef.current("Please drop a valid .flp or .als project file.");
                  }
                } else {
                  void handleDroppedPathsRef.current(event.payload.paths);
                }
              }
            }
          });
        })
        .then((unlisten) => {
          if (!isMounted) {
            unlisten?.();
          } else {
            unlistenFn = unlisten;
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
      unlistenFn?.();
    };
  }, []);

  async function browseOutput() {
    if (isBrowsingRef.current) return;
    isBrowsingRef.current = true;
    try {
      const path = await bridge.chooseFolder();
      if (path) update({ outputDir: path });
    } finally {
      isBrowsingRef.current = false;
    }
  }

  async function loadPlaylist() {
    if (!source.trim()) {
      onStatus("Paste a playlist, album, or story URL first.");
      return;
    }
    const isStory = isEphemeralStoryUrl(source.trim());
    if (isStory && !settings.allowStoryExtraction) {
      setShowStoryTermsModal(true);
      onStatus("Ephemeral story extraction requires accepting the Terms of Usage and legal compliance agreement.");
      return;
    }
    setLoadingPlaylist(true);
    try {
      const catalog = await bridge.loadPlaylist(source.trim());
      setPlaylist(catalog);
      const itemLabel = isStory ? "items" : "tracks";
      onStatus(`Loaded ${catalog.items.length} ${itemLabel} from ${catalog.title}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancelled/i.test(message)) onStatus(isStory ? "Story loading cancelled." : "Playlist loading cancelled.");
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
      await bridge.openUrl(access.link);
      setAccessNotice("Access page opened in your browser.");
      setAccessNoticeTone("neutral");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAccessNotice(message);
      setAccessNoticeTone("error");
    }
  }

  async function convert(indexes?: string, customPreset?: IntentPreset) {
    if (queue.length > 0 && queue.some((item) => item.status === "queued" || item.status === "converting")) {
      if (!running) {
        setQueue((curr) =>
          curr.map((it) => (it.status === "converting" ? { ...it, status: "queued", progress: 0 } : it))
        );
      }
      setQueueRunning(true);
      return;
    }
    if (!source.trim() && !access.bridgeConnected) {
      onStatus("Paste a source URL, choose a local file, or capture media in the browser first.");
      return;
    }
    await executeConversion(source, indexes, customPreset);
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
    }
    isStartingQueueRef.current = false;
    const abortedId = activeQueueItemIdRef.current;
    activeQueueItemIdRef.current = null;
    setQueue((curr) =>
      curr.map((item) =>
        item.id === abortedId || item.status === "converting"
          ? { ...item, status: "queued", progress: 0 }
          : item
      )
    );
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
        category: (["Audio", "Music", "Video", "Image", "Miscellaneous"].includes(activeCategory) ? activeCategory : settings.category) as Category,
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
      <div className="inline-flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1">
        <button
          type="button"
          aria-pressed={converterTab === "media"}
          onClick={() => setConverterTab("media")}
          className={"rounded-lg px-3 py-1.5 text-xs font-medium transition-colors " + (converterTab === "media" ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300")}
        >
          Media & Streams
        </button>
        <button
          type="button"
          aria-pressed={converterTab === "flp"}
          onClick={() => setConverterTab("flp")}
          className={"inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors " + (converterTab === "flp" ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300")}
        >
          <span>Studio DAW Tools</span>
          <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider border border-pink-500/30 bg-pink-500/10 text-pink-300">
            Producer Suite
          </span>
        </button>
      </div>

      {converterTab === "flp" ? (
        <FlpConverterView onStatus={onStatus} initialFilePath={droppedFlpPath} />
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
            disabled={facebookCaptureBusy || socialCaptureBusy}
            onChange={(event) => handleSourceInput(event.target.value)}
            onDragOver={handleDragOver}
            onDrop={handleDropEvent}
            placeholder="Paste a media or Facebook post link, or drop local files..."
            className="field min-w-0 flex-1 px-3.5 py-3 text-sm placeholder:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button type="button" disabled={facebookCaptureBusy || socialCaptureBusy} onClick={() => void paste()} className="subtle-button flex items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            <Clipboard className="size-3.5" /> Paste
          </button>
          <button type="button" disabled={facebookCaptureBusy || socialCaptureBusy} onClick={() => void browseFile()} className="subtle-button flex items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            <FilePlus2 className="size-3.5" /> Browse
          </button>
          <button type="button" disabled={facebookCaptureBusy || socialCaptureBusy} onClick={() => void browseBatch()} className="subtle-button flex items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            <Files className="size-3.5" /> Batch
          </button>
          {isEphemeralStoryUrl(source.trim()) ? (
            <button
              type="button"
              disabled={loadingPlaylist || facebookCaptureBusy || socialCaptureBusy}
              onClick={() => void loadPlaylist()}
              className="subtle-button flex items-center gap-2 px-3 text-xs text-pink-300 hover:text-pink-200 border-pink-500/25 bg-pink-500/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
              title="Read all active realtime stories for this user"
            >
              <Layers className="size-3.5 text-pink-400" /> {loadingPlaylist ? "Reading stories..." : "Story items"}
            </button>
          ) : (
            <button
              type="button"
              disabled={loadingPlaylist || facebookCaptureBusy || socialCaptureBusy}
              onClick={() => void loadPlaylist()}
              className="subtle-button flex items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              title="Load playlist tracks and inspect catalog"
            >
              <ListMusic className="size-3.5" /> {loadingPlaylist ? "Loading..." : "Playlist tracks"}
            </button>
          )}
          <button
            type="button"
            disabled={!source.trim() || facebookCaptureBusy || socialCaptureBusy}
            onClick={() => addToQueue()}
            className="subtle-button flex items-center gap-1.5 px-3 text-xs text-pink-300 hover:text-pink-200 border-pink-500/25 bg-pink-500/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
            title="Add this source to conversion queue"
          >
            <ListPlus className="size-3.5" /> Queue
          </button>
          {source.trim().startsWith("http") && (
            <button
              type="button"
              disabled={facebookCaptureBusy || socialCaptureBusy}
              onClick={() => void bridge.openUrl(source.trim())}
              className="subtle-button flex items-center gap-1.5 px-3 text-xs text-zinc-300 hover:text-white"
              title="Open this link in your default browser to view or warm up session cookies"
            >
              <ExternalLink className="size-3.5 text-zinc-400" /> Open in browser
            </button>
          )}
        </div>

        {isEphemeralStoryUrl(source) && !settings.allowStoryExtraction && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <ShieldAlert className="size-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-100">
                  Ephemeral Story Link Detected (Instagram / Facebook Stories)
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-300/80">
                  Stories expire in 24 hours and carry strict privacy boundaries (Friends Only / Close Friends). Ephemeral extraction is disabled by default under statutory compliance rules. You must review and accept the Terms of Usage to enable conversion.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowStoryTermsModal(true)}
              className="shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition-all hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: accentColor,
                boxShadow: `0 2px 8px ${accentColor}40`,
              }}
            >
              Review Terms & Enable
            </button>
          </div>
        )}
        {isEphemeralStoryUrl(source) && settings.allowStoryExtraction && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2 text-xs text-emerald-300">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-emerald-400" />
              <span>Ephemeral story extraction is active. Terms of Usage acknowledged.</span>
            </div>
            <button
              type="button"
              onClick={() => setShowStoryTermsModal(true)}
              className="text-[11px] underline text-emerald-400/80 hover:text-emerald-200 transition-colors"
            >
              Review Policy
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setNotesOpen((value) => !value)}
          className="mt-4 flex items-center gap-2 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <Info className="size-3.5" /> Source notes and fallback engine <span className="text-zinc-700">{notesOpen ? "Hide" : "Show"}</span>
        </button>
        {notesOpen && (
          <div className="mt-3 grid gap-3 rounded-xl border border-white/[0.06] bg-black/15 p-4 text-[11px] leading-relaxed text-zinc-500 md:grid-cols-3">
            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-300">
                <Music2 className="size-3.5 text-pink-400" /> Apple Music (Adaptive Fallback)
              </div>
              Direct audio extraction requires an active Apple Music subscription in your browser session. If you are not signed in, the initial direct stream fetch is expected to fail—JaneConverter automatically falls back to parse playlist metadata and match lossless audio across other public platforms.
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-300">
                <ShieldCheck className="size-3.5 text-emerald-400" /> Spotify & Private Media
              </div>
              Spotify tracklists are parsed into metadata; JaneConverter finds matching public streams automatically. For friends-only or login-gated posts (Facebook, Instagram, YouTube), JaneConverter reads your default browser's active session. Opening the link once in your browser freshens tokens.
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-300">
                <Inbox className="size-3.5 text-sky-400" /> Media Capturer Extension
              </div>
              For streams locked behind DRM or players without direct audio/video URLs, use the JaneConverter Browser Bridge in the Media Capturer tab to record playback streams directly into your local library.
            </div>
          </div>
        )}
      </section>

      {/* Conversion Queue Section */}
      <ConverterQueue
        queue={queue}
        queueRunning={queueRunning}
        running={running}
        onStartQueue={() => {
          if (!running) {
            setQueue((curr) =>
              curr.map((it) => (it.status === "converting" ? { ...it, status: "queued", progress: 0 } : it))
            );
          }
          setQueueRunning(true);
        }}
        onPauseQueue={() => setQueueRunning(false)}
        onClearCompleted={() => setQueue((curr) => curr.filter((it) => it.status !== "completed"))}
        onClearAll={() => {
          if (queueRunning) {
            setQueueRunning(false);
          }
          isStartingQueueRef.current = false;
          activeQueueItemIdRef.current = null;
          setQueue([]);
        }}
        onRetryItem={(id) => {
          setQueue((curr) =>
            curr.map((it) => (it.id === id ? { ...it, status: "queued", errorMessage: undefined } : it))
          );
          if (!queueRunning) setQueueRunning(true);
        }}
        onRemoveItem={(id) => setQueue((curr) => curr.filter((it) => it.id !== id))}
        onConfigureItem={(item) => void handleConfigureQueueItem(item)}
        onOpenFile={(path) => void bridge.openFile(path)}
      />

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
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  <Toggle
                    checked={settings.reconstructFrequencyLoss ?? false}
                    onChange={(reconstructFrequencyLoss) => update({ reconstructFrequencyLoss })}
                    label="Harmonic Exciter (High-End Sparkle)"
                    hint={isAudio ? "Applies an audio exciter filter to synthesize subtle high-frequency air (7.5–20 kHz)" : "Available for audio output."}
                    disabled={!isAudio || isSourceFormat}
                  />
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
                  <Toggle
                    checked={settings.archivalFallback ?? false}
                    onChange={(archivalFallback) => update({ archivalFallback })}
                    label="Search archival vaults for unavailable media"
                    hint="Index Wayback Machine, Archive.org, Ghostarchive, and Filmot if a video is deleted or private"
                  />
                </div>
                {settings.archivalFallback && (
                  <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs leading-relaxed text-zinc-300">
                    <div className="font-medium text-amber-300 mb-1 flex items-center gap-1.5">
                      <span>Archival Vault Indexing (Wayback Machine, Archive.org & Ghostarchive)</span>
                    </div>
                    <p className="text-zinc-400">
                      <strong className="text-zinc-200">What it does:</strong> When JaneConverter encounters a deleted, hidden, or private video (standalone or inside a playlist), it initiates a multi-stage archival recovery pipeline: queries historical metadata via Filmot and Wayback Machine CDX, locates raw video/audio files preserved across Internet Archive (ArchiveTeam & YouTube collections), and probes Ghostarchive mirrors.
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Note: Archival recovery depends on whether public internet preservation archives crawled the media before removal.
                    </p>
                  </div>
                )}
                {isAudio && settings.reconstructFrequencyLoss && !isSourceFormat && (
                  <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/[0.04] p-3 text-xs leading-relaxed text-zinc-300">
                    <div className="font-medium text-purple-300 mb-1 flex items-center gap-1.5">
                      <span>Harmonic Exciter (High-Frequency Sparkle / Studio Air)</span>
                    </div>
                    <p className="text-zinc-400">
                      <strong className="text-zinc-200">What it does:</strong> Lossy platforms (SoundCloud, YouTube, TikTok) often apply steep lowpass filtering around 15–16 kHz. This mode engages FFmpeg's analog-modeled exciter (aexciter) to synthesize subtle upper-harmonic presence starting from 7.5 kHz up to 20 kHz.
                    </p>
                    <p className="mt-1 text-zinc-400">
                      <strong className="text-zinc-200">What to expect:</strong> Restores perceptual brightness, cymbal shimmer, and transient bite to heavily compressed tracks. Note: this enhances psychoacoustic air through harmonic synthesis; it does not uncompressedly recover destroyed spectral data.
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Tip: Great for livening up dull streaming rips. For uncompressed WAV or lossless FLAC masters, keep this toggle off.
                    </p>
                  </div>
                )}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-2 block text-[11px] font-medium text-zinc-500">Trim start time (optional)</span>
                    <input
                      type="text"
                      placeholder="e.g. 00:15 or 90"
                      value={settings.startTime ?? ""}
                      onChange={(e) => update({ startTime: e.target.value })}
                      className="field w-full px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                    />
                    <span className="mt-1.5 block text-[10px] leading-relaxed text-zinc-600">Start timestamp (HH:MM:SS, MM:SS, or seconds)</span>
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-2 block text-[11px] font-medium text-zinc-500">Trim end time (optional)</span>
                    <input
                      type="text"
                      placeholder="e.g. 02:45 or 165"
                      value={settings.endTime ?? ""}
                      onChange={(e) => update({ endTime: e.target.value })}
                      className="field w-full px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                    />
                    <span className="mt-1.5 block text-[10px] leading-relaxed text-zinc-600">End timestamp (HH:MM:SS, MM:SS, or seconds)</span>
                  </label>
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
      <ActionBar
        outputDir={settings.outputDir}
        onOutputDirChange={(outputDir) => update({ outputDir })}
        onBrowseOutput={() => void browseOutput()}
        onOpenOutput={() => void bridge.openPath(settings.outputDir)}
        isOperationActive={isOperationActive}
        queueLength={queue.length}
        queueRunning={queueRunning}
        pendingQueueCount={queue.filter((it) => it.status === "queued").length}
        onConvert={() => void convert()}
        source={source}
        facebookCaptureBusy={facebookCaptureBusy}
        socialCaptureBusy={socialCaptureBusy}
        onAddToQueue={() => addToQueue()}
        effectivePaused={effectivePaused}
        onPauseToggle={() => void handlePauseToggle()}
        onAbort={() => void handleAbort()}
        status={status}
        progress={progress}
        lastEvent={lastEvent}
      />
        </>
      )}

      {playlist && (
        <PlaylistDialog
          catalog={playlist}
          onClose={() => setPlaylist(null)}
          onConfirm={(indexes, preset, itemOverrides) => {
            setPlaylist(null);
            const groups = groupIndexesByPreset(indexes, preset, itemOverrides);
            if (groups.length <= 1) {
              const single = groups[0] || { indexes, preset };
              void convert(single.indexes, single.preset);
            } else {
              for (const group of groups) {
                addToQueue(source.trim(), group.indexes, playlist, group.preset);
              }
              setQueueRunning(true);
              onStatus(`Queued ${groups.length} batches with distinct presets and started conversion queue.`);
            }
          }}
          onQueue={(indexes, catalog, preset, itemOverrides) => {
            setPlaylist(null);
            const groups = groupIndexesByPreset(indexes, preset, itemOverrides);
            for (const group of groups) {
              addToQueue(source.trim(), group.indexes, catalog, group.preset);
            }
          }}
        />
      )}
      {configuringQueueItem && configuringQueueItem.playlistCatalog && (
        <PlaylistDialog
          catalog={configuringQueueItem.playlistCatalog}
          initialIndexes={configuringQueueItem.playlistIndexes}
          isQueuedItem={true}
          onClose={() => setConfiguringQueueItem(null)}
          onQueue={(indexes, catalog, preset, itemOverrides) => {
            const groups = groupIndexesByPreset(indexes, preset, itemOverrides);
            if (groups.length <= 1) {
              const single = groups[0] || { indexes, preset };
              setQueue((curr) =>
                curr.map((it) =>
                  it.id === configuringQueueItem.id
                    ? {
                        ...it,
                        playlistIndexes: single.indexes,
                        playlistCatalog: catalog,
                        ...(single.preset
                          ? {
                              category: single.preset.category,
                              presetName: single.preset.name,
                              settingsSnapshot: {
                                ...(it.settingsSnapshot ?? settings),
                                category: single.preset.category,
                                format: single.preset.format,
                                bitrate: single.preset.bitrate,
                                sampleRate: single.preset.sampleRate,
                                resolution: single.preset.resolution,
                                normalize: single.preset.normalize,
                                useGpu: single.preset.useGpu,
                              },
                            }
                          : {}),
                      }
                    : it
                )
              );
            } else {
              const targetIdx = queue.findIndex((it) => it.id === configuringQueueItem.id);
              const newItems: QueueItem[] = groups.map((g, idx) => ({
                id: idx === 0 ? configuringQueueItem.id : crypto.randomUUID(),
                source: configuringQueueItem.source,
                name: `${configuringQueueItem.name} (${g.preset?.name || "Default"})`,
                category: g.preset ? g.preset.category : configuringQueueItem.category,
                status: "queued" as const,
                progress: 0,
                playlistIndexes: g.indexes,
                playlistCatalog: catalog,
                presetName: g.preset ? g.preset.name : configuringQueueItem.presetName,
                settingsSnapshot: g.preset
                  ? {
                      ...(configuringQueueItem.settingsSnapshot ?? settings),
                      category: g.preset.category,
                      format: g.preset.format,
                      bitrate: g.preset.bitrate,
                      sampleRate: g.preset.sampleRate,
                      resolution: g.preset.resolution,
                      normalize: g.preset.normalize,
                      useGpu: g.preset.useGpu,
                    }
                  : configuringQueueItem.settingsSnapshot,
              }));
              setQueue((curr) => {
                const next = [...curr];
                next.splice(targetIdx, 1, ...newItems);
                return next;
              });
            }
            setConfiguringQueueItem(null);
            const isStory = isEphemeralStoryUrl(configuringQueueItem.source);
            const itemLabel = isStory ? "items" : "tracks";
            onStatus(`Saved selection for "${configuringQueueItem.name}" (${indexes.split(",").length} ${itemLabel} selected).`);
          }}
        />
      )}
      {(loadingPlaylist || loadingQueueConfig) && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 backdrop-blur-sm">
          <div className="panel flex items-center gap-3 px-5 py-4 text-sm text-zinc-300">
            <RefreshCw className="size-4 animate-spin text-zinc-500" /> {isEphemeralStoryUrl(source.trim()) ? "Reading live story collection..." : "Reading playlist catalog..."}
            <button
              type="button"
              className="subtle-button px-3 py-1"
              onClick={() => {
                setLoadingQueueConfig(false);
                void bridge.cancelPlaylist().catch((error) => onError(String(error)));
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <StoryTermsModal
        isOpen={showStoryTermsModal}
        accentColor={accentColor}
        onClose={() => setShowStoryTermsModal(false)}
        onConfirm={() => {
          onSettings({ ...settings, allowStoryExtraction: true });
          onStatus("Ephemeral stories extraction enabled. You can now convert this story.");
        }}
      />
    </div>
  );
}
