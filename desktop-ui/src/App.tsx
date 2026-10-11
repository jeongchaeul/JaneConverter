import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Clock, FolderOpen, GripVertical, Play, X } from "lucide-react";
import { bridge, type AccessStatus, type ConversionHistoryItem, type ConverterEvent, type ConverterSettings, type FetchedMedia, type RuntimeInfo } from "./bridge";
import { Sidebar, type ViewKey } from "./components/Sidebar";
import { ConverterView } from "./components/ConverterView";
import { LibraryView } from "./components/LibraryView";
import { ConsoleView } from "./components/ConsoleView";
import { HardwarePipelineView } from "./components/HardwarePipelineView";
import { SettingsView } from "./components/SettingsView";
import { FetchedMediaView } from "./components/FetchedMediaView";
import { findPresetName, formatElapsedMs } from "./options";

const defaultSettings: ConverterSettings = {
  outputDir: "converted",
  fetchedDir: "fetched",
  category: "Music",
  format: "mp3",
  bitrate: "320k",
  sampleRate: 48000,
  resolution: "original",
  normalize: false,
  useGpu: false,
  saveCover: true,
  saveMetadata: true,
  allowPngFallback: false,
  retries: 2,
};

const HISTORY_STORAGE_KEY = "janecoverter.conversionHistory";
const TIMINGS_STORAGE_KEY = "janecoverter.conversionTimings";

function cleanDisplayPath(rawPath: string): string {
  return rawPath.trim().replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
}

function normalizePathKey(rawPath: string): string {
  return cleanDisplayPath(rawPath).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function baseNameFromPath(rawPath: string): string {
  const cleaned = cleanDisplayPath(rawPath).replace(/[\\/]+$/, "");
  const lastSlash = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return lastSlash >= 0 ? cleaned.slice(lastSlash + 1) : cleaned;
}

function extensionFromPath(rawPath: string): string {
  const name = baseNameFromPath(rawPath);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toUpperCase();
}

function extractExportedPathFromMessage(message: string): string | null {
  for (const prefix of ["DONE! Exported:", "Export Directory:"]) {
    const idx = message.indexOf(prefix);
    if (idx >= 0) {
      const value = cleanDisplayPath(message.slice(idx + prefix.length));
      if (value) return value;
    }
  }
  return null;
}

function detectFallbackNote(logs: string[], forcedVideoFallback: boolean): string | null {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const line = logs[i];
    if (/Normalization mode: dynamic/i.test(line)) return "FFmpeg used dynamic loudness normalization to meet the requested targets.";
    if (/Normalization mode: unconfirmed/i.test(line)) return "Loudness normalization was applied; FFmpeg did not confirm whether the processing was linear or dynamic.";
    const pngMatch = line.match(/Recovered from\s+([^\s]+)\s+as\s+([^\s]+)\s+using\s+(.+?)\.?$/i);
    if (pngMatch) {
      return `Forced fallback to ${pngMatch[2].toUpperCase()} (${pngMatch[3]}) after source format recovery.`;
    }
    const recoveryMatch = line.match(/Conversion complete using\s+(.+?)\s+after bounded recovery\.?$/i);
    if (recoveryMatch) {
      return `Forced fallback to ${recoveryMatch[1]} to complete conversion.`;
    }
  }
  if (forcedVideoFallback) {
    return "Forced fallback from Image to Video preset because the post contained video media.";
  }
  return null;
}

function describeOutputFormatAndQuality(
  effectiveSettings: ConverterSettings,
  exportPath: string,
  fallbackNote: string | null,
): { formatLabel: string; qualityLabel: string } {
  const ext = extensionFromPath(exportPath);
  if (effectiveSettings.format === "source") {
    if (fallbackNote && /fallback to PNG/i.test(fallbackNote)) {
      return { formatLabel: "PNG (Fallback)", qualityLabel: "Lossless Image Fallback" };
    }
    return {
      formatLabel: ext ? `${ext} (Source)` : "SOURCE",
      qualityLabel: "Source Quality",
    };
  }
  const formatLabel = (ext || effectiveSettings.format || "MEDIA").toUpperCase();
  if (effectiveSettings.category === "Image") {
    const qualityLabel = formatLabel === "PNG" ? "Lossless" : `${effectiveSettings.bitrate.toUpperCase()} Quality`;
    return { formatLabel, qualityLabel };
  }
  if (effectiveSettings.category === "Video") {
    const res = effectiveSettings.resolution === "original" ? "Original Res" : effectiveSettings.resolution.toUpperCase();
    return { formatLabel, qualityLabel: `${effectiveSettings.bitrate.toUpperCase()} • ${res}` };
  }
  const khz = `${(effectiveSettings.sampleRate / 1000).toFixed(1).replace(/\.0$/, "")}kHz`;
  return { formatLabel, qualityLabel: `${effectiveSettings.bitrate} • ${khz}` };
}

interface ActiveJobContext {
  startedAtMs: number;
  source: string;
  effectiveSettings: ConverterSettings;
  presetName: string;
  forcedVideoFallback: boolean;
  logs: string[];
  exportedPath: string;
}

interface SuccessPromptState {
  fileName: string;
  formatLabel: string;
  qualityLabel: string;
  exportPath: string;
  elapsedMs: number;
  fallbackNote: string | null;
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>("converter");
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [settings, setSettings] = useState<ConverterSettings>(defaultSettings);
  const settingsRef = useRef<ConverterSettings>(defaultSettings);
  settingsRef.current = settings;
  const [events, setEvents] = useState<ConverterEvent[]>([]);
  const [access, setAccess] = useState<AccessStatus>({ active: false, link: "", browser: "", source: null, bridgeConnected: false });
  const [selectedCapture, setSelectedCapture] = useState<FetchedMedia | null>(null);
  const [jobId, setJobId] = useState("");
  const [paused, setPaused] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const captureBusyRef = useRef(false);
  const cancelCaptureRef = useRef<(() => Promise<void>) | null>(null);
  const activeJobRef = useRef("");
  const activeJobSuggestLosslessRef = useRef(false);
  const activeJobContextRef = useRef<ActiveJobContext | null>(null);
  const [failure, setFailure] = useState<{ title: string; message: string; suggestLossless: boolean; elapsedMs?: number } | null>(null);
  const [success, setSuccess] = useState<SuccessPromptState | null>(null);
  const failureCloseRef = useRef<HTMLButtonElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);
  const accessDiagnosticIds = useRef(new Set<number>());
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready. Paste a link or choose a file to begin.");
  const [history, setHistory] = useState<ConversionHistoryItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.timestamp === "string" && typeof item.source === "string" && typeof item.fileName === "string" && typeof item.exportPath === "string" && typeof item.presetName === "string" && typeof item.formatLabel === "string" && typeof item.qualityLabel === "string" && Number.isInteger(item.elapsedMs) && item.elapsedMs >= 0 && ["succeeded", "failed", "partial"].includes(item.status)) : [];
    } catch {
      return [];
    }
  });
  const [conversionTimings, setConversionTimings] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(TIMINGS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    try {
      return (window.localStorage.getItem("janecoverter.theme") as "light" | null) ?? "dark";
    } catch {
      return "dark";
    }
  });

  const [accentColor, setAccentColor] = useState<string>(() => {
    if (typeof window === "undefined") return "#c52b68";
    try {
      return window.localStorage.getItem("janecoverter.accentColor") ?? "#c52b68";
    } catch {
      return "#c52b68";
    }
  });

  const [bgColor, setBgColor] = useState<string>(() => {
    if (typeof window === "undefined") return "#02000a";
    try {
      return window.localStorage.getItem("janecoverter.bgColor") ?? "#02000a";
    } catch {
      return "#02000a";
    }
  });

  useEffect(() => {
    if (!failure) return;
    void bridge.notifyAttention();
    failureCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFailure(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [failure]);

  useEffect(() => {
    if (!success) return;
    void bridge.notifyAttention();
    successCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSuccess(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [success]);

  useEffect(() => {
    if (jobId || captureBusy) {
      const status = paused ? "paused" : "normal";
      const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
      void bridge.setTaskbarProgress(pct, status);
    } else if (failure) {
      void bridge.setTaskbarProgress(100, "error");
    } else {
      void bridge.setTaskbarProgress(undefined, "none");
    }
  }, [jobId, captureBusy, progress, paused, failure]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    const clean = accentColor.replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const num = parseInt(full, 16);
    const r = isNaN(num) ? 197 : (num >> 16) & 255;
    const g = isNaN(num) ? 43 : (num >> 8) & 255;
    const b = isNaN(num) ? 104 : num & 255;

    const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v * 1.15)));
    const hoverHex = `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;

    root.style.setProperty("--accent-color", accentColor);
    root.style.setProperty("--accent-hover", hoverHex);
    root.style.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.35)`);
    root.style.setProperty("--accent-subtle", `rgba(${r}, ${g}, ${b}, 0.12)`);
    root.style.setProperty("--bg-color", bgColor);

    try {
      window.localStorage.setItem("janecoverter.theme", theme);
      window.localStorage.setItem("janecoverter.accentColor", accentColor);
      window.localStorage.setItem("janecoverter.bgColor", bgColor);
    } catch {}
  }, [theme, accentColor, bgColor]);

  const [historyError, setHistoryError] = useState("");
  const pendingHistoryWrites = useRef<Array<() => Promise<void>>>([]);
  const writingHistory = useRef(false);
  function queueHistory(action: () => Promise<void>) {
    pendingHistoryWrites.current.push(action);
    void flushHistory();
  }
  async function flushHistory() {
    if (writingHistory.current) return;
    writingHistory.current = true;
    try {
      while (pendingHistoryWrites.current.length) {
        try {
          await pendingHistoryWrites.current[0]();
          pendingHistoryWrites.current.shift();
        } catch (error) {
          setHistoryError(`History could not be saved: ${String(error)}. Your media is still available.`);
          break;
        }
      }
    } finally { writingHistory.current = false; }
  }
  useEffect(() => {
    queueHistory(async () => {
      const result = await bridge.conversionHistory(history);
      setHistory(result.history);
      setHistoryError(result.warning || "");
      try { window.localStorage.removeItem(HISTORY_STORAGE_KEY); }
      catch { setHistoryError("History was saved, but the legacy browser cache could not be cleared."); }
    });
  }, []);
  function recordHistoryEntry(entry: ConversionHistoryItem) {
    queueHistory(async () => {
      const result = await bridge.conversionHistory([], entry);
      setHistory(result.history);
      if (result.warning) setHistoryError(result.warning);
    });
  }

  function recordTimingForPath(rawPath: string, elapsedMs: number) {
    const key = normalizePathKey(rawPath);
    if (!key) return;
    setConversionTimings((current) => {
      const next = { ...current, [key]: elapsedMs };
      try {
        window.localStorage.setItem(TIMINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function handleRemoveHistoryItem(id: string) {
    queueHistory(async () => {
      const result = await bridge.conversionHistory([], undefined, id);
      setHistory(result.history);
    });
  }
  function handleClearHistory() {
    queueHistory(async () => {
      const result = await bridge.conversionHistory([], undefined, undefined, true);
      await bridge.clearConversionTimings();
      setHistory(result.history);
      setConversionTimings({});
      window.localStorage.removeItem(TIMINGS_STORAGE_KEY);
      statusMessage("Cleared conversion history and timings.");
    });
  }

  function handleAccentChange(color: string) {
    setAccentColor(color);
  }

  function handleBgChange(color: string) {
    setBgColor(color);
    const clean = color.replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const num = parseInt(full, 16);
    if (!isNaN(num)) {
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      const isLight = (r * 299 + g * 587 + b * 114) / 1000 > 135;
      if (isLight && theme !== "light") {
        setTheme("light");
      } else if (!isLight && theme !== "dark") {
        setTheme("dark");
      }
    }
  }

  function handleResetColors() {
    setTheme("dark");
    setAccentColor("#c52b68");
    setBgColor("#02000a");
  }

  useEffect(() => {
    let mounted = true;
    void Promise.all([bridge.runtimeInfo(), bridge.settingsGet(), bridge.accessStatus()]).then(([nextRuntime, nextSettings, nextAccess]) => {
      if (!mounted) return;
      setRuntime(nextRuntime);
      setSettings(nextSettings);
      setAccess(nextAccess);
    }).catch((error) => {
      if (mounted) errorMessage(error instanceof Error ? error.message : String(error));
    });
    let cleanup: (() => void) | undefined;
    void bridge.subscribe((event) => {
      if (!mounted) return;
      setEvents((current) => [...current.slice(-1499), event]);
      if (event.kind === "started" && !activeJobRef.current) {
        activeJobRef.current = event.jobId;
        setJobId(event.jobId);
        if (!activeJobContextRef.current) {
          activeJobContextRef.current = {
            startedAtMs: Date.now(),
            source: "Media source",
            effectiveSettings: settingsRef.current,
            presetName: findPresetName(settingsRef.current),
            forcedVideoFallback: false,
            logs: [],
            exportedPath: "",
          };
        }
      }
      if (event.jobId && event.jobId === activeJobRef.current) {
        if (event.progress !== undefined) setProgress(event.progress);
        setStatus(event.message);
        const ctx = activeJobContextRef.current;
        if (ctx) {
          if (event.message) ctx.logs.push(event.message);
          const parsedPath = (event.output && cleanDisplayPath(event.output)) || extractExportedPathFromMessage(event.message);
          if (parsedPath) {
            ctx.exportedPath = parsedPath;
          }
        }
        if (event.kind === "finished" || event.kind === "partial") {
          const isPartial = event.kind === "partial";
          const effective = ctx?.effectiveSettings ?? settingsRef.current;
          const elapsedMs = Math.max(1, Date.now() - (ctx?.startedAtMs ?? Date.now()));
          const exportPath = cleanDisplayPath(
            event.output || extractExportedPathFromMessage(event.message) || ctx?.exportedPath || effective.outputDir,
          );
          const fallbackNote = isPartial
            ? event.message || "Partial conversion: some media items failed to convert."
            : detectFallbackNote(ctx?.logs ?? [], ctx?.forcedVideoFallback ?? false);
          const { formatLabel, qualityLabel } = describeOutputFormatAndQuality(effective, exportPath, fallbackNote);
          const fileName = baseNameFromPath(exportPath) || baseNameFromPath(ctx?.source || "") || "Converted media";
          setFailure(null);
          if (!captureBusyRef.current) {
            setSuccess({
              fileName,
              formatLabel,
              qualityLabel,
              exportPath,
              elapsedMs,
              fallbackNote,
            });
          }
          recordTimingForPath(exportPath, elapsedMs);
          recordHistoryEntry({
            id: `${event.jobId}-${Date.now()}`,
            timestamp: new Date().toISOString(),
            source: ctx?.source || fileName,
            fileName,
            exportPath,
            presetName: ctx?.presetName || findPresetName(effective),
            formatLabel,
            qualityLabel,
            elapsedMs,
            status: isPartial ? "partial" : "succeeded",
            fallbackNote,
            errorMessage: isPartial ? event.message : undefined,
          });
        }
        if (event.kind === "failed") {
          const effective = ctx?.effectiveSettings ?? settingsRef.current;
          const elapsedMs = Math.max(1, Date.now() - (ctx?.startedAtMs ?? Date.now()));
          const fallbackNote = detectFallbackNote(ctx?.logs ?? [], ctx?.forcedVideoFallback ?? false);
          const { formatLabel, qualityLabel } = describeOutputFormatAndQuality(effective, ctx?.exportedPath || "", fallbackNote);
          setSuccess(null);
          if (!captureBusyRef.current) {
            setFailure({
              title: "Conversion failed",
              message: event.message,
              suggestLossless: activeJobSuggestLosslessRef.current,
              elapsedMs,
            });
          }
          recordHistoryEntry({
            id: `${event.jobId}-${Date.now()}`,
            timestamp: new Date().toISOString(),
            source: ctx?.source || "Media source",
            fileName: baseNameFromPath(ctx?.source || "") || "Failed conversion",
            exportPath: ctx?.exportedPath || effective.outputDir,
            presetName: ctx?.presetName || findPresetName(effective),
            formatLabel,
            qualityLabel,
            elapsedMs,
            status: "failed",
            fallbackNote,
            errorMessage: event.message,
          });
        }
        if (event.kind === "finished" || event.kind === "partial" || event.kind === "failed" || event.kind === "cancelled") {
          activeJobRef.current = "";
          activeJobSuggestLosslessRef.current = false;
          activeJobContextRef.current = null;
          setJobId("");
          setPaused(false);
        }
      }
    }).then((unlisten) => { cleanup = unlisten; });
    return () => { mounted = false; cleanup?.(); };
  }, []);

  useEffect(() => {
    if (!access.active) return;
    let refreshInFlight = false;
    const refreshAccess = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const [nextAccess, diagnostics] = await Promise.all([bridge.accessStatus(), bridge.accessDiagnostics()]);
        setAccess(nextAccess);
        const unseen = diagnostics.filter((entry) => !accessDiagnosticIds.current.has(entry.id));
        if (!unseen.length) return;
        for (const entry of unseen) accessDiagnosticIds.current.add(entry.id);
        setEvents((current) => [...current.slice(-1499), ...unseen.map((entry) => ({ jobId: "browser-session", kind: "status" as const, message: entry.message }))]);
      } catch (error) {
        statusMessage(error instanceof Error ? error.message : String(error));
      } finally {
        refreshInFlight = false;
      }
    };
    void refreshAccess();
    const timer = window.setInterval(() => { void refreshAccess(); }, 1500);
    return () => window.clearInterval(timer);
  }, [access.active]);

  useEffect(() => {
    let mounted = true;
    const timer = window.setTimeout(() => {
      void bridge.checkUpdates().then((result) => {
        const message = result.message;
        if (!mounted || !/update available|check unavailable/i.test(message)) return;
        setStatus(message);
        setEvents((current) => [...current.slice(-1499), { jobId: "ui", kind: "status", message }]);
      }).catch(() => {
        // Startup checks stay quiet when the machine is offline. The Settings
        // view remains available for an explicit retry and full status text.
      });
    }, 1200);
    return () => { mounted = false; window.clearTimeout(timer); };
  }, []);

  function statusMessage(message: string) {
    setStatus(message);
    setEvents((current) => [...current.slice(-1499), { jobId: "ui", kind: "status", message }]);
  }

  function errorMessage(message: string) {
    statusMessage(message);
    setFailure({ title: "Something went wrong", message, suggestLossless: false });
  }

  function dragExportedFile(event: React.DragEvent, exportPath: string) {
    if (!exportPath) return;
    event.preventDefault();
    event.stopPropagation();
    void bridge.dragLibraryFile(exportPath).catch((error: unknown) => {
      statusMessage(error instanceof Error ? error.message : String(error));
    });
  }

  function updateSettings(next: ConverterSettings) {
    setSettings(next);
    void bridge.settingsSave(next).catch((error) => errorMessage(error instanceof Error ? error.message : String(error)));
  }

  async function start(source: string, playlistIndexes?: string, facebookCaptureId?: string, socialCaptureId?: string, detectedMediaKind?: "photo" | "video"): Promise<boolean> {
    try {
      const normalizedSource = source.trim();
      const accessSource = access.source?.trim() || "";
      const browserSession = accessSource && normalizedSource && accessSource === normalizedSource ? access.browser || undefined : undefined;
      let effectiveSettings = settings;
      let forcedVideoFallback = false;
      if (detectedMediaKind === "video" && settings.category === "Image") {
        effectiveSettings = {
          ...settings,
          category: "Video",
          format: settings.format === "source" ? "source" : "mp4",
          bitrate: settings.format === "source" ? "best" : "balanced",
        };
        forcedVideoFallback = true;
        setSettings(effectiveSettings);
      }
      activeJobSuggestLosslessRef.current = effectiveSettings.format === "source" && (effectiveSettings.category === "Image" || Boolean(facebookCaptureId || socialCaptureId));
      activeJobContextRef.current = {
        startedAtMs: Date.now(),
        source: normalizedSource || selectedCapture?.name || "Media source",
        effectiveSettings,
        presetName: findPresetName(effectiveSettings),
        forcedVideoFallback,
        logs: [],
        exportedPath: "",
      };
      const nextJob = await bridge.startConversion({ ...effectiveSettings, source, playlistIndexes, browserSession, browserCapturePath: !normalizedSource ? selectedCapture?.path : undefined, facebookCaptureId, socialCaptureId });
      activeJobRef.current = nextJob;
      setJobId(nextJob);
      setPaused(false);
      setProgress(.02);
      setStatus("Starting conversion...");
      setActiveView("console");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailure({ title: "Conversion could not start", message, suggestLossless: false });
      activeJobSuggestLosslessRef.current = false;
      activeJobContextRef.current = null;
      statusMessage(message);
      return false;
    }
  }

  async function pauseToggle() {
    if (!jobId && !captureBusy) return;
    try {
      if (paused) {
        await bridge.resumeConversion(jobId || undefined);
        setPaused(false);
      } else {
        await bridge.pauseConversion(jobId || undefined);
        setPaused(true);
      }
    } catch (error) {
      errorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function cancel() {
    setPaused(false);
    if (cancelCaptureRef.current) {
      try {
        await cancelCaptureRef.current();
      } catch (error) {
        errorMessage(error instanceof Error ? error.message : String(error));
      }
      if (!jobId) return;
    }
    if (!jobId) return;
    try { await bridge.cancelConversion(jobId); setStatus("Aborting conversion..."); }
    catch (error) { errorMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function createAccess(source: string): Promise<AccessStatus> {
    try {
      const nextAccess = await bridge.createAccessLink(source);
      accessDiagnosticIds.current.clear();
      setAccess(nextAccess);
      statusMessage("Account session initialized. Direct extraction is ready.");
      return nextAccess;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorMessage(message);
      throw error;
    }
  }

  async function clearAccess() {
    try {
      await bridge.clearAccessLink();
      accessDiagnosticIds.current.clear();
      setAccess({ active: false, link: "", browser: "", source: null, bridgeConnected: false });
      setSelectedCapture(null);
      statusMessage("Account access cleared. Public-only extraction is active.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorMessage(message);
      throw error;
    }
  }

  const secondaryContent = activeView === "fetched"
    ? <FetchedMediaView access={access} settings={settings} onSettings={updateSettings} onSelect={(item) => { setSelectedCapture(item); setActiveView("converter"); statusMessage(item.name + " selected and ready to convert."); }} onDiscard={(item) => { if (selectedCapture?.path === item.path) setSelectedCapture(null); }} onStatus={statusMessage} />
    : activeView === "library"
    ? <LibraryView settings={settings} onSettings={updateSettings} onStatus={statusMessage} history={history} conversionTimings={conversionTimings} onClearHistory={handleClearHistory} onRemoveHistoryItem={handleRemoveHistoryItem} />
    : activeView === "hardware"
      ? <HardwarePipelineView runtime={runtime} settings={settings} active={Boolean(jobId) || captureBusy} progress={progress} progressMessage={status} />
    : activeView === "console"
      ? <ConsoleView events={events} running={Boolean(jobId) || captureBusy} paused={paused} onPauseToggle={pauseToggle} onAbort={cancel} onClear={() => setEvents([])} onStatus={statusMessage} />
      : activeView === "settings"
        ? (
          <SettingsView
            runtime={runtime}
            settings={settings}
            onSettings={updateSettings}
            accentColor={accentColor}
            bgColor={bgColor}
            onAccentColorChange={handleAccentChange}
            onBgColorChange={handleBgChange}
            onResetColors={handleResetColors}
            onStatus={statusMessage}
          />
        )
        : null;

  return (
    <div
      data-theme={theme}
      onContextMenu={(event) => event.preventDefault()}
      className="app-shell relative flex h-screen max-h-screen w-screen overflow-hidden transition-colors duration-200"
      style={{
        backgroundColor: "var(--bg-color, #02000a)",
        color: theme === "light" ? "#1f1222" : "#ededed",
      }}
    >
      <div
        className="pointer-events-none absolute -left-32 -top-24 size-[460px] rounded-full blur-3xl ambient-orb transition-colors duration-300"
        style={{ backgroundColor: "var(--accent-subtle, rgba(197, 43, 104, 0.06))" }}
      />
      <div className="pointer-events-none absolute -right-28 -top-36 h-[390px] w-[700px] rounded-full top-right-glow ambient-orb" style={{ animationDelay: "-6s" }} />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,.018),transparent_35%)]" />
      <Sidebar activeView={activeView} onChange={setActiveView} />
      <div className="relative flex min-w-0 flex-1 flex-col h-full overflow-hidden">
        <main className={`min-h-0 flex-1 px-8 py-6 ${activeView === "console" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}>
          <div className={activeView === "converter" ? "block" : "hidden"}>
            <ConverterView
              settings={settings}
              runtime={runtime}
              events={events}
              access={access}
              selectedCapture={selectedCapture}
              running={Boolean(jobId)}
              paused={paused}
              progress={progress}
              status={status}
              onSettings={updateSettings}
              onStart={start}
              onCancel={cancel}
              onPauseToggle={pauseToggle}
              onCaptureBusyChange={(busy, cancelFn) => {
                setCaptureBusy(busy);
                captureBusyRef.current = busy;
                cancelCaptureRef.current = cancelFn ?? null;
                if (!busy && !activeJobRef.current) setPaused(false);
              }}
              onCreateAccess={createAccess}
              onClearAccess={clearAccess}
              onStatus={statusMessage}
              onError={errorMessage}
            />
          </div>
          {activeView !== "converter" && (
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={activeView === "console" ? "flex flex-col flex-1 min-h-0 h-full" : ""}
            >
              {secondaryContent}
            </motion.div>
          )}
        </main>
      </div>
      {historyError && <div role="alert" className="fixed bottom-4 left-4 right-4 z-[60] rounded-lg bg-amber-950 p-3 text-sm text-amber-100">
        {historyError} <button className="underline" onClick={() => {
          setHistoryError("");
          void flushHistory();
        }}>{pendingHistoryWrites.current.length ? "Retry saving history" : "Dismiss"}</button>
      </div>}
      {success && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5 backdrop-blur-md">
          <section
            className="panel relative w-full max-w-lg p-6 shadow-2xl shadow-black/70"
            style={{ backgroundColor: theme === "light" ? "#ffffff" : "#0b0914" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="conversion-success-title"
          >
            <button
              ref={successCloseRef}
              type="button"
              onClick={() => setSuccess(null)}
              className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              aria-label="Close success dialog"
            >
              <X className="size-4" />
            </button>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="size-5" />
              <span className="mono-label">Conversion complete</span>
            </div>
            <h2 id="conversion-success-title" className="mt-2 text-xl font-semibold text-white">
              Success
            </h2>
            <div className="mt-3 space-y-2.5">
              <div className="break-words text-sm font-medium text-white">
                {success.fileName}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                <span className="rounded-md border border-pink-500/30 bg-pink-500/10 px-2 py-0.5 font-mono text-pink-200">
                  {success.formatLabel}
                </span>
                <span className="rounded-md border border-white/[0.10] bg-white/[0.04] px-2 py-0.5 text-zinc-300">
                  {success.qualityLabel}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-zinc-400">
                  <Clock className="size-3 text-zinc-500" />
                  Time elapsed: {formatElapsedMs(success.elapsedMs)}
                </span>
              </div>
              {success.fallbackNote && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                  {success.fallbackNote}
                </div>
              )}
              <div
                draggable
                onDragStartCapture={(e) => dragExportedFile(e, success.exportPath)}
                title="Drag this file into another app (e.g. FL Studio, Explorer, Discord)"
                className="group relative cursor-grab active:cursor-grabbing rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 transition-colors hover:border-pink-500/30 hover:bg-white/[0.05]"
              >
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
                  <span>Exported to</span>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500 group-hover:text-pink-400 transition-colors">
                    <GripVertical className="size-3" /> Draggable
                  </span>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-zinc-300">
                  {success.exportPath}
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                draggable
                onDragStartCapture={(e) => dragExportedFile(e, success.exportPath)}
                onClick={() => statusMessage("Drag this button or the exported card directly into another app (e.g. FL Studio).")}
                className="subtle-button flex items-center gap-1.5 px-3 py-2 text-xs cursor-grab active:cursor-grabbing hover:border-pink-500/40"
                title="Drag this file into another app (e.g. FL Studio, Explorer, Discord)"
                aria-label="Drag this file into another app"
              >
                <GripVertical className="size-3.5 text-pink-400" /> Drag File
              </button>
              <button
                type="button"
                onClick={() => void bridge.openFile(success.exportPath).catch((error) => statusMessage(error instanceof Error ? error.message : String(error)))}
                className="primary-button flex items-center gap-1.5 px-3 py-2 text-xs"
              >
                <Play className="size-3.5" /> Open File
              </button>
              <button
                type="button"
                onClick={() => void bridge.openPath(success.exportPath).catch((error) => statusMessage(error instanceof Error ? error.message : String(error)))}
                className="subtle-button flex items-center gap-1.5 px-3 py-2 text-xs"
              >
                <FolderOpen className="size-3.5" /> Open Path
              </button>
              <button
                type="button"
                onClick={() => setSuccess(null)}
                className="subtle-button px-3 py-2 text-xs"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
      {failure && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5 backdrop-blur-md">
          <section
            className="panel relative w-full max-w-lg p-6 shadow-2xl shadow-black/70"
            style={{ backgroundColor: theme === "light" ? "#ffffff" : "#0b0914" }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="conversion-failure-title"
            aria-describedby="conversion-failure-message"
          >
            <button ref={failureCloseRef} type="button" onClick={() => setFailure(null)} className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200" aria-label="Close error"><X className="size-4" /></button>
            <div className="flex items-center gap-2 text-rose-400"><AlertCircle className="size-5" /><span className="mono-label">Action needed</span></div>
            <h2 id="conversion-failure-title" className="mt-3 text-xl font-semibold text-white">{failure.title}</h2>
            <p id="conversion-failure-message" className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-300">{failure.message}</p>
            {failure.elapsedMs !== undefined && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-xs text-zinc-400">
                <Clock className="size-3.5 text-zinc-500" />
                Time elapsed: {formatElapsedMs(failure.elapsedMs)}
              </div>
            )}
            <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 text-xs leading-relaxed text-zinc-300">
              {/returned (?:a non-image response|an unsupported image (?:type|format)) for photo \d+/i.test(failure.message)
                ? "The photo download failed before conversion. Retry the link when the public post is accessible."
                : /already running/i.test(failure.message)
                ? "Wait for the active operation to complete, or click Abort to stop it before starting a new conversion."
                : /timed out|capture|guest session|no public photos/i.test(failure.message)
                ? "Verify the post link is publicly viewable, or use Account Access with the Browser Capture extension if the post requires sign-in."
                : failure.suggestLossless
                ? <>Try <strong className="text-white">Image → Lossless Image</strong> in Converter, then run the conversion again.</>
                : "Review the message above and try again. If the conversion format is the problem, choose another compatible preset."}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFailure(null)} className="subtle-button px-3 py-2 text-xs">Close</button>
              <button type="button" onClick={() => { setFailure(null); setActiveView("converter"); }} className="primary-button px-3 py-2 text-xs">Open Converter</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
