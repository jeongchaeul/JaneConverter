import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, X } from "lucide-react";
import { bridge, type AccessStatus, type ConverterEvent, type ConverterSettings, type FetchedMedia, type RuntimeInfo } from "./bridge";
import { Sidebar, type ViewKey } from "./components/Sidebar";
import { ConverterView } from "./components/ConverterView";
import { LibraryView } from "./components/LibraryView";
import { ConsoleView } from "./components/ConsoleView";
import { HardwarePipelineView } from "./components/HardwarePipelineView";
import { SettingsView } from "./components/SettingsView";
import { FetchedMediaView } from "./components/FetchedMediaView";

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

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>("converter");
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [settings, setSettings] = useState<ConverterSettings>(defaultSettings);
  const [events, setEvents] = useState<ConverterEvent[]>([]);
  const [access, setAccess] = useState<AccessStatus>({ active: false, link: "", browser: "", source: null, bridgeConnected: false });
  const [selectedCapture, setSelectedCapture] = useState<FetchedMedia | null>(null);
  const [jobId, setJobId] = useState("");
  const activeJobRef = useRef("");
  const activeJobSuggestLosslessRef = useRef(false);
  const [failure, setFailure] = useState<{ title: string; message: string; suggestLossless: boolean } | null>(null);
  const failureCloseRef = useRef<HTMLButtonElement>(null);
  const accessDiagnosticIds = useRef(new Set<number>());
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready. Paste a link or choose a file to begin.");
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
    failureCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFailure(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [failure]);

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
      }
      if (event.jobId && event.jobId === activeJobRef.current) {
        if (event.progress !== undefined) setProgress(event.progress);
        setStatus(event.message);
        if (event.kind === "failed") {
          setFailure({ title: "Conversion failed", message: event.message, suggestLossless: activeJobSuggestLosslessRef.current });
        }
        if (event.kind === "finished" || event.kind === "failed" || event.kind === "cancelled") {
          activeJobRef.current = "";
          activeJobSuggestLosslessRef.current = false;
          setJobId("");
        }
      }
    }).then((unlisten) => { cleanup = unlisten; });
    return () => { mounted = false; cleanup?.(); };
  }, []);

  useEffect(() => {
    if (!access.active) return;
    const refreshAccess = async () => {
      try {
        const [nextAccess, diagnostics] = await Promise.all([bridge.accessStatus(), bridge.accessDiagnostics()]);
        setAccess(nextAccess);
        const unseen = diagnostics.filter((entry) => !accessDiagnosticIds.current.has(entry.id));
        if (!unseen.length) return;
        for (const entry of unseen) accessDiagnosticIds.current.add(entry.id);
        setEvents((current) => [...current.slice(-1499), ...unseen.map((entry) => ({ jobId: "browser-session", kind: "status" as const, message: entry.message }))]);
      } catch (error) {
        statusMessage(error instanceof Error ? error.message : String(error));
      }
    };
    void refreshAccess();
    const timer = window.setInterval(() => { void refreshAccess(); }, 700);
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

  function updateSettings(next: ConverterSettings) {
    setSettings(next);
    void bridge.settingsSave(next).catch((error) => errorMessage(error instanceof Error ? error.message : String(error)));
  }

  async function start(source: string, playlistIndexes?: string, facebookCaptureId?: string, socialCaptureId?: string): Promise<boolean> {
    try {
      const normalizedSource = source.trim();
      const accessSource = access.source?.trim() || "";
      const browserSession = accessSource && normalizedSource && accessSource === normalizedSource ? access.browser || undefined : undefined;
      activeJobSuggestLosslessRef.current = settings.format === "source" && (settings.category === "Image" || Boolean(facebookCaptureId || socialCaptureId));
      const nextJob = await bridge.startConversion({ ...settings, source, playlistIndexes, browserSession, browserCapturePath: !normalizedSource ? selectedCapture?.path : undefined, facebookCaptureId, socialCaptureId });
      activeJobRef.current = nextJob;
      setJobId(nextJob);
      setProgress(.02);
      setStatus("Starting conversion...");
      setActiveView("console");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailure({ title: "Conversion could not start", message, suggestLossless: false });
      activeJobSuggestLosslessRef.current = false;
      statusMessage(message);
      return false;
    }
  }

  async function cancel() {
    if (!jobId) return;
    try { await bridge.cancelConversion(jobId); setStatus("Aborting conversion..."); }
    catch (error) { errorMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function createAccess(source: string): Promise<AccessStatus> {
    try {
      const nextAccess = await bridge.createAccessLink(source);
      accessDiagnosticIds.current.clear();
      setAccess(nextAccess);
      await bridge.openUrl(nextAccess.link);
      statusMessage("Temporary access link opened in your browser.");
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

  const content = activeView === "converter"
    ? <ConverterView settings={settings} runtime={runtime} events={events} access={access} selectedCapture={selectedCapture} running={Boolean(jobId)} progress={progress} status={status} onSettings={updateSettings} onStart={start} onCancel={cancel} onCreateAccess={createAccess} onClearAccess={clearAccess} onStatus={statusMessage} onError={errorMessage} />
    : activeView === "fetched"
      ? <FetchedMediaView access={access} settings={settings} onSettings={updateSettings} onSelect={(item) => { setSelectedCapture(item); setActiveView("converter"); statusMessage(item.name + " selected and ready to convert."); }} onDiscard={(item) => { if (selectedCapture?.path === item.path) setSelectedCapture(null); }} onStatus={statusMessage} />
      : activeView === "library"
      ? <LibraryView settings={settings} onSettings={updateSettings} onStatus={statusMessage} />
      : activeView === "hardware"
        ? <HardwarePipelineView runtime={runtime} settings={settings} active={Boolean(jobId)} progress={progress} progressMessage={status} />
      : activeView === "console"
        ? <ConsoleView events={events} onClear={() => setEvents([])} onStatus={statusMessage} />
        : (
          <SettingsView
            runtime={runtime}
            accentColor={accentColor}
            bgColor={bgColor}
            onAccentColorChange={handleAccentChange}
            onBgColorChange={handleBgChange}
            onResetColors={handleResetColors}
            onStatus={statusMessage}
          />
        );

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
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={activeView === "console" ? "flex flex-col flex-1 min-h-0 h-full" : ""}
          >
            {content}
          </motion.div>
        </main>
      </div>
      {failure && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5">
          <section className="panel relative w-full max-w-lg p-6 shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="conversion-failure-title" aria-describedby="conversion-failure-message">
            <button ref={failureCloseRef} type="button" onClick={() => setFailure(null)} className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200" aria-label="Close error"><X className="size-4" /></button>
            <div className="flex items-center gap-2 text-rose-400"><AlertCircle className="size-5" /><span className="mono-label">Action needed</span></div>
            <h2 id="conversion-failure-title" className="mt-3 text-xl font-semibold text-white">{failure.title}</h2>
            <p id="conversion-failure-message" className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-300">{failure.message}</p>
            <div className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 text-xs leading-relaxed text-zinc-300">
              {failure.suggestLossless
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
