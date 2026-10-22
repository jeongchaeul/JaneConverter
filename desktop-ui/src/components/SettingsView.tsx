import { useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Copy,
  Cpu,
  ExternalLink,
  FolderOpen,
  Globe,
  HardDrive,
  HelpCircle,
  KeyRound,
  Lock,
  Music,
  Paintbrush,
  Palette,
  Pipette,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import type { ConverterSettings, RuntimeInfo, UpdateCheckResult } from "../bridge";
import { bridge } from "../bridge";
import { UpdateChangesModal } from "./UpdateChangesModal";
import { isAppUpdateAvailable } from "./UpdatePromptHeader";

const ACCENT_PRESETS = [
  { name: "Hot Pink (Default)", hex: "#c52b68" },
  { name: "Neon Rose", hex: "#f43f5e" },
  { name: "Electric Purple", hex: "#8b5cf6" },
  { name: "Cyber Cyan", hex: "#06b6d4" },
  { name: "Sky Blue", hex: "#3b82f6" },
  { name: "Emerald Green", hex: "#10b981" },
  { name: "Amber Gold", hex: "#f59e0b" },
  { name: "Sunset Coral", hex: "#f97316" },
];

const BG_PRESETS = [
  { name: "Void Black (Default)", hex: "#02000a" },
  { name: "Deep Obsidian", hex: "#09090b" },
  { name: "Midnight Navy", hex: "#0b0f17" },
  { name: "Abyssal Plum", hex: "#12071a" },
  { name: "Rosy Pearl (Light)", hex: "#fdf7fa" },
  { name: "Pure White", hex: "#ffffff" },
  { name: "Soft Zinc", hex: "#f4f4f5" },
  { name: "Warm Cream", hex: "#faf8f5" },
];

export type SettingsTab = "browser" | "hardware" | "theme" | "system" | "guide";

export function SettingsView({
  runtime,
  settings,
  onSettings,
  accentColor = "#c52b68",
  bgColor = "#02000a",
  onAccentColorChange,
  onBgColorChange,
  onResetColors,
  onStatus,
  initialTab = "browser",
  updateResult: propUpdateResult,
  onCheckUpdates,
  isCheckingUpdates = false,
  onOpenChangesModal,
}: {
  runtime: RuntimeInfo | null;
  settings?: ConverterSettings;
  onSettings?: (next: ConverterSettings) => void;
  accentColor?: string;
  bgColor?: string;
  onAccentColorChange?: (color: string) => void;
  onBgColorChange?: (color: string) => void;
  onResetColors?: () => void;
  onStatus: (message: string) => void;
  initialTab?: SettingsTab;
  updateResult?: UpdateCheckResult | null;
  onCheckUpdates?: () => Promise<UpdateCheckResult>;
  isCheckingUpdates?: boolean;
  onOpenChangesModal?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [localUpdateResult, setLocalUpdateResult] = useState<UpdateCheckResult | null>(null);
  const effectiveUpdateResult = propUpdateResult !== undefined ? propUpdateResult : localUpdateResult;
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showLocalChangesModal, setShowLocalChangesModal] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [message, setMessage] = useState(effectiveUpdateResult?.message ?? "");
  const [dataRootPath, setDataRootPath] = useState(runtime?.dataRoot ?? "");
  const [changingDataRoot, setChangingDataRoot] = useState(false);
  const [chromiumPolicy, setChromiumPolicy] = useState(false);
  const [togglingPolicy, setTogglingPolicy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  useEffect(() => {
    if (effectiveUpdateResult?.message && !message) {
      setMessage(effectiveUpdateResult.message);
    }
  }, [effectiveUpdateResult]);

  useEffect(() => {
    setDataRootPath(runtime?.dataRoot ?? "");
  }, [runtime?.dataRoot]);

  useEffect(() => {
    bridge
      .getChromiumCookiePolicy()
      .then(setChromiumPolicy)
      .catch(() => {});
  }, []);

  function toggleAdaptiveGpu() {
    if (!settings || !onSettings) return;
    const nextUseGpu = !settings.useGpu;
    onSettings({ ...settings, useGpu: nextUseGpu });
    const nextMessage = nextUseGpu
      ? `Adaptive GPU Acceleration enabled (${runtime?.gpuLabel || "GPU when supported, CPU otherwise"}).`
      : "Adaptive GPU Acceleration disabled. Conversions will use CPU multi-core mode.";
    setMessage(nextMessage);
    onStatus(nextMessage);
  }

  function toggleBrowserCookies() {
    if (!settings || !onSettings) return;
    const nextValue = !settings.readBrowserCookies;
    onSettings({ ...settings, readBrowserCookies: nextValue });
    const nextMessage = nextValue
      ? "Browser session cookie reading enabled. Private and friends-only media can now use your browser sessions."
      : "Browser session cookie reading disabled. Conversions will use strictly public air-gapped extraction.";
    setMessage(nextMessage);
    onStatus(nextMessage);
  }

  async function toggleChromiumPolicy() {
    if (togglingPolicy) return;
    setTogglingPolicy(true);
    setPolicyError(null);
    try {
      const next = !chromiumPolicy;
      const result = await bridge.setChromiumCookiePolicy(next);
      setChromiumPolicy(result);
      const nextMsg = result
        ? "Direct Edge & Chrome cookie access enabled. Restart Edge/Chrome to apply standard DPAPI encryption to new sessions."
        : "Direct Edge & Chrome cookie access disabled. Restored default App-Bound encryption.";
      setMessage(nextMsg);
      onStatus(nextMsg);
    } catch (error) {
      const failMsg = error instanceof Error ? error.message : String(error);
      setPolicyError(failMsg);
      setMessage(`Could not update Chromium cookie policy: ${failMsg}`);
      onStatus(`Could not update Chromium cookie policy: ${failMsg}`);
    } finally {
      setTogglingPolicy(false);
    }
  }

  async function chooseDataRoot() {
    const path = await bridge.chooseFolder();
    if (path) setDataRootPath(path);
  }

  async function changeDataRoot() {
    const path = dataRootPath.trim();
    if (!path) {
      const nextMessage = "Choose a data root folder first.";
      setMessage(nextMessage);
      onStatus(nextMessage);
      return;
    }
    setChangingDataRoot(true);
    setMessage("Saving the data root and relaunching JaneConverter...");
    try {
      const saved = await bridge.setDataRoot(path);
      await bridge.relaunch();
      setMessage("Data root changed to " + saved + ".");
      onStatus("Data root changed to " + saved + ".");
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      setMessage(nextMessage);
      onStatus(nextMessage);
    } finally {
      setChangingDataRoot(false);
    }
  }

  async function relaunch() {
    setRelaunching(true);
    setMessage("Relaunching JaneConverter...");
    try {
      await bridge.relaunch();
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      setRelaunching(false);
      setMessage(nextMessage);
      onStatus(nextMessage);
    }
  }

  async function updates() {
    if (onCheckUpdates) {
      setMessage("Checking for updates...");
      try {
        const result = await onCheckUpdates();
        setUpdateDismissed(false);
        setMessage(result.message);
        onStatus(result.message);
      } catch (error) {
        const nextMessage = error instanceof Error ? error.message : String(error);
        setMessage(nextMessage);
        onStatus(nextMessage);
      }
      return;
    }
    setChecking(true);
    setMessage("Checking for updates...");
    try {
      const result = await bridge.checkUpdates();
      setLocalUpdateResult(result);
      setUpdateDismissed(false);
      setMessage(result.message);
      onStatus(result.message);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      setMessage(nextMessage);
      onStatus(nextMessage);
    } finally {
      setChecking(false);
    }
  }

  async function installUpdate() {
    const repo = effectiveUpdateResult?.repo;
    if (!repo?.has_update || !repo.installer_available) {
      const nextMessage =
        "This update cannot be installed automatically here. Open the published release to update manually.";
      setMessage(nextMessage);
      onStatus(nextMessage);
      return;
    }
    setInstalling(true);
    const revision = repo.latest_commit?.slice(0, 7);
    const nextMessage = revision
      ? `Downloading and verifying JaneConverter build ${revision}...`
      : `Downloading and verifying JaneConverter v${repo.latest_version ?? "latest"}...`;
    setMessage(nextMessage);
    onStatus(nextMessage);
    try {
      await bridge.installUpdate();
      setMessage("The update is ready. JaneConverter will close and reopen to finish installing it.");
      onStatus("The JaneConverter update is being installed.");
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      setMessage(`The update could not be installed: ${failure}`);
      onStatus(`The update could not be installed: ${failure}`);
    } finally {
      setInstalling(false);
    }
  }

  const gpuEnabled = Boolean(settings?.useGpu);

  return (
    <div className="mx-auto max-w-[980px] space-y-6 pb-12">
      {/* Header and Category Pills */}
      <div>
        <div className="mono-label">Settings & Configuration</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] text-white">Customize your conversion engine.</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          {runtime?.packaged ? "Running from a production package." : "Running from a source checkout."} Configure
          hardware acceleration, session authentication, and personalization.
        </p>

        {/* Tab Filter Pills */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] pb-3" role="tablist" aria-label="Settings categories">
          {[
            { id: "browser" as const, label: "Browser & Sessions", icon: Globe },
            { id: "hardware" as const, label: "Hardware & Engine", icon: Zap },
            { id: "theme" as const, label: "Appearance", icon: Palette },
            { id: "system" as const, label: "System & Updates", icon: HardDrive },
            { id: "guide" as const, label: "User Manual", icon: BookOpen },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-tab={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-white/[0.12] text-white shadow-sm ring-1 ring-white/20"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                }`}
              >
                <Icon
                  size={13}
                  style={isSelected ? { color: "var(--accent-color, #c52b68)" } : undefined}
                />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* BROWSER & SESSIONS CATEGORY                                               */}
      {/* ========================================================================= */}
      {activeTab === "browser" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Globe className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
            Browser Authentication & Cookie Sessions
          </div>

          {/* Direct Edge & Chrome Cookie Access (Opt-in Policy) */}
          <section className="panel space-y-4 p-5" aria-labelledby="chromium-cookie-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <ShieldCheck size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
                  <span id="chromium-cookie-heading">Direct Edge & Chrome Cookie Access</span>
                  <span
                    className={
                      "rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase " +
                      (chromiumPolicy
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border-white/[0.10] bg-white/[0.03] text-zinc-400")
                    }
                  >
                    {chromiumPolicy ? "Active (Standard DPAPI)" : "Default (App-Bound)"}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  Allows JaneConverter to read active sessions directly from <strong className="text-zinc-200">Microsoft Edge</strong> and <strong className="text-zinc-200">Google Chrome</strong> with zero browser extensions or manual exports.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={chromiumPolicy}
                aria-label="Direct Edge & Chrome Cookie Access"
                disabled={togglingPolicy}
                onClick={() => void toggleChromiumPolicy()}
                className={
                  "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-colors disabled:cursor-wait " +
                  (chromiumPolicy
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                    : "subtle-button text-zinc-200")
                }
              >
                {togglingPolicy ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin text-zinc-400" />
                    <span>Applying...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className={"size-3.5 " + (chromiumPolicy ? "text-emerald-300" : "text-zinc-400")} />
                    <span>{chromiumPolicy ? "Direct Access Active" : "Enable Direct Access"}</span>
                  </>
                )}
              </button>
            </div>

            {policyError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 space-y-2">
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldAlert className="size-4 shrink-0 text-rose-400" />
                  <span>Windows Administrator Permission Needed</span>
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  {policyError}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const cmd = 'reg add "HKCU\\Software\\Policies\\Microsoft\\Edge" /v ApplicationBoundEncryptionEnabled /t REG_DWORD /d 0 /f & reg add "HKCU\\Software\\Policies\\Google\\Chrome" /v ApplicationBoundEncryptionEnabled /t REG_DWORD /d 0 /f';
                      void navigator.clipboard.writeText(cmd);
                      setCopiedCmd(true);
                      setTimeout(() => setCopiedCmd(false), 2500);
                      onStatus("Copied 1-line admin registry command to clipboard.");
                    }}
                    className="subtle-button flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-zinc-200 hover:text-white"
                  >
                    {copiedCmd ? <CheckCircle2 className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                    <span>{copiedCmd ? "Copied Command!" : "Copy Admin Command"}</span>
                  </button>
                  <span className="text-[11px] text-zinc-400">Run once in PowerShell as Administrator, then restart Edge.</span>
                </div>
              </div>
            )}

            <details className="group border-t border-white/[0.06] pt-3">
              <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors list-none select-none">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180 text-zinc-500" />
                <span>How direct Edge & Chrome access works & technical details</span>
              </summary>
              <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                    <Sparkles className="size-3.5 shrink-0" /> Zero Extension Requirement
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    Configures the official Windows Chromium policy (<span className="font-mono text-zinc-300 text-[10px]">ApplicationBoundEncryptionEnabled = 0</span>) in the registry. This instructs Edge and Chrome to store session cookies using standard Windows DPAPI (the exact format used by Vivaldi and Firefox), eliminating the need to install or run browser extensions.
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                    <RotateCw className="size-3.5 shrink-0" /> Restart Browser After Enabling
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    Edge and Chrome read this policy when starting up. After enabling this setting, completely restart Edge or Chrome so the browser writes future session cookies in standard decryptable format.
                  </p>
                </div>
              </div>
            </details>
          </section>

          {/* Read Browser Cookies (Session Recovery) */}
          <section className="panel space-y-4 p-5" aria-labelledby="read-browser-cookies-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <KeyRound size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
                  <span id="read-browser-cookies-heading">Read Browser Cookies (Session Recovery)</span>
                  <span
                    className={
                      "rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase " +
                      (settings?.readBrowserCookies
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border-white/[0.10] bg-white/[0.03] text-zinc-400")
                    }
                  >
                    {settings?.readBrowserCookies ? "Enabled (Session Recovery)" : "Disabled (Air-Gap Mode)"}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  Controls whether JaneConverter is permitted to read session cookies from your desktop browsers (Vivaldi, Chrome, Edge, Brave, Firefox, etc.) to resolve private, friends-only, or anti-bot restricted media.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(settings?.readBrowserCookies)}
                aria-label="Read browser cookies for session recovery"
                disabled={!settings || !onSettings}
                onClick={toggleBrowserCookies}
                className={
                  "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
                  (settings?.readBrowserCookies
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                    : "subtle-button text-zinc-200")
                }
              >
                {settings?.readBrowserCookies ? (
                  <>
                    <ShieldCheck className="size-3.5 text-emerald-300" />
                    Session Reading Active
                  </>
                ) : (
                  <>
                    <Lock className="size-3.5 text-zinc-400" />
                    Enable Cookie Reading
                  </>
                )}
              </button>
            </div>

            {settings?.readBrowserCookies && (
              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-white/[0.06]">
                <div>
                  <div className="text-xs font-medium text-zinc-200">Preferred Session Browser</div>
                  <div className="text-[11px] text-zinc-400">Choose which browser JaneConverter prioritizes for session cookies.</div>
                </div>
                <select
                  aria-label="Preferred session browser"
                  value={settings?.browserSession || "auto"}
                  onChange={(e) => {
                    if (!settings || !onSettings) return;
                    const nextBrowser = e.target.value;
                    onSettings({ ...settings, browserSession: nextBrowser });
                    const label = e.target.options[e.target.selectedIndex].text;
                    const msg = `Preferred session browser set to ${label}.`;
                    setMessage(msg);
                    onStatus(msg);
                  }}
                  className="field rounded-xl px-3 py-1.5 text-xs text-zinc-200 bg-black/30 border border-white/10"
                >
                  <option value="auto">Auto-detect (Active Running Browser)</option>
                  <option value="edge">Microsoft Edge</option>
                  <option value="vivaldi">Vivaldi</option>
                  <option value="chrome">Google Chrome</option>
                  <option value="firefox">Mozilla Firefox</option>
                  <option value="brave">Brave</option>
                  <option value="opera">Opera</option>
                </select>
              </div>
            )}

            <details className="group border-t border-white/[0.06] pt-3">
              <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors list-none select-none">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180 text-zinc-500" />
                <span>View privacy guarantees & supported features</span>
              </summary>
              {settings?.readBrowserCookies ? (
                <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                  <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                      <Sparkles className="size-3.5 shrink-0" /> What works when enabled
                    </div>
                    <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                        <span><strong>Friends-only Facebook Reels & posts</strong>: Automatically extracts media when you are logged into your browser.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                        <span><strong>Age-restricted YouTube & anti-bot screens</strong>: Transparently bypasses Error 152 and login-gated videos.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                        <span><strong>Subscriber & members-only media</strong>: Resolves streams from accounts you have authenticated sessions for.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                        <span><strong>Frictionless recovery</strong>: Zero manual cookie export files (.txt) or password entry needed.</span>
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-sky-300">
                      <ShieldCheck className="size-3.5 shrink-0" /> Air-gapped privacy guarantees
                    </div>
                    <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                      <li className="flex items-start gap-1.5">
                        <span className="font-mono text-sky-400 shrink-0 font-bold">•</span>
                        <span><strong>RAM only (0 bytes to disk)</strong>: Cookies exist temporarily in memory during extraction and are instantly purged. Never written to disk.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="font-mono text-sky-400 shrink-0 font-bold">•</span>
                        <span><strong>Domain-scoped</strong>: Only cookies matching the target link (e.g. facebook.com, youtube.com) are queried. All other sites are ignored.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="font-mono text-sky-400 shrink-0 font-bold">•</span>
                        <span><strong>Non-locking shadow copy</strong>: Reads browser SQLite tables via safe snapshot so your browser is never locked or disrupted.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="font-mono text-sky-400 shrink-0 font-bold">•</span>
                        <span><strong>100% local, zero telemetry</strong>: JaneConverter has no cloud servers and transmits zero telemetry or credentials anywhere.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                  <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                      <CheckCircle2 className="size-3.5 shrink-0" /> What works when disabled
                    </div>
                    <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                        <span><strong>All public media</strong>: 1,000+ platforms (YouTube, SoundCloud, Spotify, Reddit, Vimeo, TikTok, etc.) convert normally.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                        <span><strong>Public photo albums</strong>: Public Facebook albums and public Instagram videos/posts work out-of-the-box.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                        <span><strong>Local media & FLP projects</strong>: Full local transcoding and FL Studio downgrade features work without web dependencies.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                        <span><strong>Zero browser file access</strong>: Local browser SQLite files are strictly never opened, inspected, or queried.</span>
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                      <XCircle className="size-3.5 shrink-0" /> What won't work when disabled
                    </div>
                    <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                      <li className="flex items-start gap-1.5">
                        <XCircle className="size-3 shrink-0 text-amber-400 mt-0.5" />
                        <span><strong>Friends-only Facebook Reels & posts</strong>: Facebook blocks guest access with "Cannot parse data / Sign-in required".</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <XCircle className="size-3 shrink-0 text-amber-400 mt-0.5" />
                        <span><strong>Age-gated & bot-checked YouTube videos</strong>: Videos requiring sign-in (Error 152) cannot verify your session.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <XCircle className="size-3 shrink-0 text-amber-400 mt-0.5" />
                        <span><strong>Private or followers-only accounts</strong>: Instagram private posts and subscriber-only streams will fail without session access.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </details>
          </section>

          {/* Browser Integration & Session Warm-Up */}
          <section className="panel space-y-4 p-5" aria-labelledby="browser-integration-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <Globe size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
                  <span id="browser-integration-heading">Source Browser Pre-Opening</span>
                  <span
                    className={
                      "rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase " +
                      (settings?.openInBrowser
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border-white/[0.10] bg-white/[0.03] text-zinc-400")
                    }
                  >
                    {settings?.openInBrowser ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  Automatically opens online source URLs in your default browser when conversion starts. Warmed-up browser sessions solve anti-bot checks and provide fresh session cookies.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(settings?.openInBrowser)}
                aria-label="Open source media in browser before conversion"
                disabled={!settings || !onSettings}
                onClick={() => {
                  if (settings && onSettings) {
                    onSettings({ ...settings, openInBrowser: !settings.openInBrowser });
                  }
                }}
                className={
                  "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
                  (settings?.openInBrowser
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                    : "subtle-button text-zinc-200")
                }
              >
                <Globe className={"size-3.5 " + (settings?.openInBrowser ? "text-emerald-300" : "text-zinc-400")} />
                {settings?.openInBrowser ? "Auto-Open Active" : "Enable Auto-Open"}
              </button>
            </div>

            <details className="group border-t border-white/[0.06] pt-3">
              <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors list-none select-none">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180 text-zinc-500" />
                <span>View pre-opening mechanism & details</span>
              </summary>
              <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                    <ShieldCheck className="size-3.5 shrink-0" /> Freshens Session Cookies
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    Visiting the link in your browser completes anti-bot challenges and writes the latest authentication tokens to your local profile database (Vivaldi, Chrome, Edge, Brave, etc.).
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-sky-300">
                    <Sparkles className="size-3.5 shrink-0" /> Zero File Exports
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    JaneConverter reads cookies directly in-memory through shadow-copy readers and clears them immediately after extraction. No credentials or cookie files are saved to disk.
                  </p>
                </div>
              </div>
            </details>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* HARDWARE & ENGINE CATEGORY                                                */}
      {/* ========================================================================= */}
      {activeTab === "hardware" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Zap className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
            Hardware Acceleration & Storage
          </div>

          {/* Adaptive GPU Acceleration */}
          <section className="panel space-y-4 p-5" aria-labelledby="adaptive-gpu-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <Zap size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
                  <span id="adaptive-gpu-heading">Adaptive GPU Acceleration</span>
                  <span
                    className={
                      "rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase " +
                      (gpuEnabled
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border-white/[0.10] bg-white/[0.03] text-zinc-400")
                    }
                  >
                    {gpuEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  Universal hardware acceleration for <strong className="text-zinc-200">{runtime?.gpuLabel || "your GPU"}</strong>. Automatically speeds up conversion with NVENC / AMF / Quick Sync and falls back to CPU when appropriate.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={gpuEnabled}
                aria-label="Adaptive GPU Acceleration"
                disabled={!settings || !onSettings}
                onClick={toggleAdaptiveGpu}
                className={
                  "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
                  (gpuEnabled
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                    : "subtle-button text-zinc-200")
                }
              >
                <Zap className={"size-3.5 " + (gpuEnabled ? "text-emerald-300" : "text-zinc-400")} />
                {gpuEnabled ? "Adaptive GPU Active" : "Enable Adaptive GPU"}
              </button>
            </div>

            <details className="group border-t border-white/[0.06] pt-3">
              <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors list-none select-none">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180 text-zinc-500" />
                <span>View GPU acceleration details and safety net</span>
              </summary>
              <div className="mt-3 grid gap-2.5 md:grid-cols-3">
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                    <Zap className="size-3.5 shrink-0" /> 1. Speeds up video encoding
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    Uses your GPU encoder when converting or resizing videos into <span className="font-mono text-zinc-300">MP4</span>, <span className="font-mono text-zinc-300">MKV</span>, or <span className="font-mono text-zinc-300">MOV</span>.
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-sky-300">
                    <Cpu className="size-3.5 shrink-0" /> 2. Skips when not needed
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    Automatically bypasses the GPU for <strong className="text-zinc-300">Preserve Quality (Source)</strong>, audio (<span className="font-mono text-zinc-300">MP3</span>, <span className="font-mono text-zinc-300">FLAC</span>), and images so original audio/pixel fidelity is uncompressed.
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                    <ShieldCheck className="size-3.5 shrink-0" /> 3. Automatic CPU safety net
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    If a video uses an unusual format that the GPU rejects, JaneConverter automatically switches to multi-core CPU so the conversion still finishes cleanly.
                  </p>
                </div>
              </div>
            </details>
          </section>

          {/* Application Data Folder */}
          <section className="panel p-5">
            <div className="flex items-center gap-2 text-sm text-zinc-200">
              <FolderOpen size={16} className="text-zinc-500" /> Application Data Folder
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              Choose where JaneConverter keeps its settings, captured media, and converted-library defaults. Existing files stay where they are; the application relaunches after applying.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                aria-label="Application data folder"
                value={dataRootPath}
                onChange={(event) => setDataRootPath(event.target.value)}
                className="field min-w-0 flex-1 px-3 py-2 text-xs"
              />
              <button type="button" className="subtle-button px-3 text-xs" onClick={() => void chooseDataRoot()}>
                Browse
              </button>
              <button
                type="button"
                disabled={changingDataRoot}
                className="primary-button flex items-center gap-2 px-3 text-xs disabled:cursor-wait disabled:opacity-60"
                onClick={() => void changeDataRoot()}
              >
                <FolderOpen className={"size-3.5 " + (changingDataRoot ? "animate-pulse" : "")} />
                {changingDataRoot ? "Applying..." : "Apply and relaunch"}
              </button>
            </div>
          </section>

          {/* Relaunch JaneConverter */}
          <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="text-sm font-medium text-zinc-200">Relaunch JaneConverter</div>
              <div className="mt-1 text-xs text-zinc-500">Restart the current desktop application to apply system changes.</div>
            </div>
            <button
              type="button"
              disabled={relaunching}
              onClick={() => void relaunch()}
              className="subtle-button flex items-center gap-2 px-4 py-2 text-xs disabled:cursor-wait disabled:opacity-60"
            >
              <RotateCw className={"size-3.5 " + (relaunching ? "animate-spin" : "")} />
              {relaunching ? "Relaunching..." : "Relaunch now"}
            </button>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* APPEARANCE CATEGORY                                                       */}
      {/* ========================================================================= */}
      {activeTab === "theme" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Palette className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
            Appearance & Visual Theme
          </div>

          <section className="panel p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <Palette size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
                  Interface Theme & Color Palette
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Personalize JaneConverter in real-time. Pick custom accent & background colors or choose preset styles.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onResetColors?.();
                  onStatus("Theme colors reset to default palette.");
                }}
                className="subtle-button flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 hover:text-white"
                title="Reset accent and background to default"
              >
                <RotateCcw className="size-3" /> Reset colors
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-white/[0.06]">
              {/* Accent Color Customizer */}
              <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                    <Pipette className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
                    Accent Color
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Accent color picker"
                      value={accentColor}
                      onChange={(event) => onAccentColorChange?.(event.target.value)}
                      className="size-7 cursor-pointer rounded-lg border border-white/20 bg-transparent p-0.5"
                    />
                    <span className="font-mono text-xs uppercase text-zinc-400">{accentColor}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {ACCENT_PRESETS.map((swatch) => (
                    <button
                      key={swatch.hex}
                      type="button"
                      onClick={() => onAccentColorChange?.(swatch.hex)}
                      title={swatch.name}
                      className={`size-6 rounded-lg transition-transform hover:scale-110 relative ${
                        accentColor.toLowerCase() === swatch.hex.toLowerCase()
                          ? "ring-2 ring-white ring-offset-2 ring-offset-black scale-105"
                          : "border border-white/10"
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                    />
                  ))}
                </div>
              </div>

              {/* Main Theme Color (Background) Customizer */}
              <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                    <Paintbrush className="size-3.5 text-zinc-400" />
                    Main Theme Color (Background)
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Theme background color picker"
                      value={bgColor}
                      onChange={(event) => onBgColorChange?.(event.target.value)}
                      className="size-7 cursor-pointer rounded-lg border border-white/20 bg-transparent p-0.5"
                    />
                    <span className="font-mono text-xs uppercase text-zinc-400">{bgColor}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {BG_PRESETS.map((swatch) => (
                    <button
                      key={swatch.hex}
                      type="button"
                      onClick={() => onBgColorChange?.(swatch.hex)}
                      title={swatch.name}
                      className={`size-6 rounded-lg transition-transform hover:scale-110 relative ${
                        bgColor.toLowerCase() === swatch.hex.toLowerCase()
                          ? "ring-2 ring-white ring-offset-2 ring-offset-black scale-105"
                          : "border border-white/10"
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SYSTEM & UPDATES CATEGORY                                                 */}
      {/* ========================================================================= */}
      {activeTab === "system" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <HardDrive className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
            System Diagnostics & Updates
          </div>

          {/* Runtime Readiness */}
          <section className="panel p-5">
            <div className="flex items-center gap-2 text-sm text-zinc-200">
              <HardDrive size={16} className="text-zinc-500" /> Runtime Readiness
            </div>
            <div className="mt-3.5 grid gap-2 md:grid-cols-2">
              {[
                ["Python", runtime?.pythonReady, runtime?.pythonPath],
                ["FFmpeg", runtime?.ffmpegReady, runtime?.ffmpegPath || "Required by conversion and media probing"],
                ["GPU", runtime?.gpuAvailable, runtime?.gpuLabel],
                ["Data root", true, runtime?.dataRoot],
              ].map(([label, ready, detail]) => (
                <div key={String(label)} className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-zinc-300">
                    {ready ? (
                      <CheckCircle2 className="size-3.5 text-emerald-400" />
                    ) : (
                      <span className="size-3.5 rounded-full border border-amber-400/50" />
                    )}
                    {label}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">{String(detail ?? "Checking...")}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Check for updates */}
          <section className="panel space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-zinc-200">Check for Updates</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Checks for the latest JaneConverter repository build and extractor service updates.
                </div>
              </div>
              <button
                type="button"
                disabled={checking || isCheckingUpdates || installing}
                onClick={() => void updates()}
                className="subtle-button flex items-center gap-2 px-4 py-2 text-xs disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw className={`size-3.5 ${(checking || isCheckingUpdates) ? "animate-spin" : ""}`} />
                {(checking || isCheckingUpdates) ? "Checking..." : "Check now"}
              </button>
            </div>
            {(() => {
              const hasAppUpdate = isAppUpdateAvailable(effectiveUpdateResult?.repo);
              if (hasAppUpdate && !updateDismissed) {
                return (
                  <div
                    className="rounded-xl border border-[var(--accent-color,#c52b68)]/30 bg-[var(--accent-color,#c52b68)]/[0.06] p-4"
                    role="region"
                    aria-label="JaneConverter application update"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-100">
                          JaneConverter{" "}
                          {effectiveUpdateResult?.repo?.latest_commit
                            ? `build ${effectiveUpdateResult.repo.latest_commit.slice(0, 7)}`
                            : `v${effectiveUpdateResult?.repo?.latest_version}`}{" "}
                          is available
                        </div>
                        <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-400">
                          Download and verify the update, then JaneConverter will restart to finish installing it. Your files and settings stay in place.
                        </p>
                        {!effectiveUpdateResult?.repo?.installer_available && (
                          <p className="mt-2 text-xs text-amber-300">
                            An automatic installer is not available for this package. Open the published release to update manually.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (onOpenChangesModal) onOpenChangesModal();
                            else setShowLocalChangesModal(true);
                          }}
                          className="subtle-button flex items-center gap-1.5 px-3 py-2 text-xs"
                        >
                          <Sparkles className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
                          <span>View changes</span>
                        </button>
                        {effectiveUpdateResult?.repo?.installer_available ? (
                          <button
                            type="button"
                            disabled={installing}
                            onClick={() => void installUpdate()}
                            className="primary-button flex items-center gap-2 px-3 py-2 text-xs disabled:cursor-wait disabled:opacity-60"
                          >
                            <RefreshCw className={`size-3.5 ${installing ? "animate-spin" : ""}`} />
                            {installing ? "Installing..." : "Update now"}
                          </button>
                        ) : null}
                        {effectiveUpdateResult?.repo?.release_url ? (
                          <button
                            type="button"
                            onClick={() => void bridge.openUrl(effectiveUpdateResult?.repo?.release_url ?? "")}
                            className="subtle-button flex items-center gap-2 px-3 py-2 text-xs"
                          >
                            <ExternalLink className="size-3.5" /> Open release
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={installing}
                          onClick={() => {
                            setUpdateDismissed(true);
                            setMessage("Update dismissed. You can check again anytime.");
                          }}
                          className="subtle-button px-3 py-2 text-xs disabled:opacity-60"
                        >
                          Not now
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4"
                  role="region"
                  aria-label="JaneConverter update status"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
                        <CheckCircle2 className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-100 flex items-center gap-2">
                          <span>JaneConverter is up to date</span>
                          <span className="font-mono text-xs text-emerald-400 font-normal">
                            ({effectiveUpdateResult?.repo?.latest_commit
                              ? `build ${effectiveUpdateResult.repo.latest_commit.slice(0, 7)}`
                              : effectiveUpdateResult?.repo?.latest_version
                                ? `v${effectiveUpdateResult.repo.latest_version}`
                                : "latest build"})
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-400">
                          {effectiveUpdateResult
                            ? "Your installed build matches the latest GitHub release."
                            : "No new updates found. Your application is running the current version."}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (onOpenChangesModal) onOpenChangesModal();
                          else setShowLocalChangesModal(true);
                        }}
                        className="subtle-button flex items-center gap-1.5 px-3 py-2 text-xs"
                      >
                        <Sparkles className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
                        <span>View changelog</span>
                      </button>
                      {effectiveUpdateResult?.repo?.release_url ? (
                        <button
                          type="button"
                          onClick={() => void bridge.openUrl(effectiveUpdateResult.repo?.release_url ?? "")}
                          className="subtle-button flex items-center gap-2 px-3 py-2 text-xs"
                        >
                          <ExternalLink className="size-3.5" /> Release notes
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* Legal & Privacy Safeguards */}
          <section className="panel space-y-3 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <ShieldCheck className="size-4 text-emerald-400" /> Legal & Privacy Safeguards
            </div>
            <p className="text-xs leading-relaxed text-zinc-400">
              JaneConverter is free, open-source software by <span className="text-zinc-200 font-medium">project//aspyr</span>. All conversions, audio resampling, and project patchings run 100% locally on your hardware with zero telemetry. The software complies with DMCA § 1201 and does not decrypt or circumvent DRM.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void bridge.openUrl("https://github.com/jeongchaeul/JaneConverter/blob/main/DISCLAIMER.md")}
                className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <ExternalLink className="size-3" /> Legal Disclaimer & Terms
              </button>
              <button
                type="button"
                onClick={() => void bridge.openUrl("https://github.com/jeongchaeul/JaneConverter/blob/main/SECURITY.md")}
                className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <ExternalLink className="size-3" /> Security Policy
              </button>
              <button
                type="button"
                onClick={() => void bridge.openUrl("https://github.com/jeongchaeul/JaneConverter/blob/main/packaging/THIRD-PARTY-NOTICES.md")}
                className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <ExternalLink className="size-3" /> Third-Party Notices
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* USER MANUAL & GUIDE CATEGORY                                              */}
      {/* ========================================================================= */}
      {activeTab === "guide" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <BookOpen className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
              User Manual & Quick Reference
            </div>
            <button
              type="button"
              onClick={() => void bridge.openUrl("https://github.com/jeongchaeul/JaneConverter/blob/main/USER_MANUAL.md")}
              className="subtle-button flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              <ExternalLink className="size-3" /> View USER_MANUAL.md on GitHub
            </button>
          </div>

          {/* 1. Quick Start Guide */}
          <section className="panel space-y-4 p-5" aria-labelledby="guide-quickstart-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Sparkles size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-quickstart-heading">Quick Start: Convert in 3 Steps</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              JaneConverter is ready to use immediately with zero mandatory setup.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.1] text-[11px] font-mono" style={{ color: "var(--accent-color, #c52b68)" }}>1</span>
                  Input Your Media
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Paste any URL (YouTube, Instagram, TikTok, Spotify...) or drag and drop a local file/folder into the window.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.1] text-[11px] font-mono" style={{ color: "var(--accent-color, #c52b68)" }}>2</span>
                  Select Format or Preset
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Choose a Quick Preset (e.g. <em>Universal Video</em>, <em>Fast MP3</em>, <em>Lossless Image</em>) or custom format.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.1] text-[11px] font-mono" style={{ color: "var(--accent-color, #c52b68)" }}>3</span>
                  Convert & Done
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Hit <strong>Convert</strong>. Your media is streamed, converted, and saved directly into your Export Library.
                </p>
              </div>
            </div>
          </section>

          {/* 2. Supported Sources & Platforms */}
          <section className="panel space-y-4 p-5" aria-labelledby="guide-platforms-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Globe size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-platforms-heading">Supported Platforms & What They Do</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-red-400 font-bold">●</span> YouTube & YouTube Music
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Extracts 1080p/4K video or 320k audio instantly without requiring login or cookies. Handles individual videos and playlists.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-pink-400 font-bold">●</span> Instagram (Posts, Reels & Carousels)
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Downloads single photos, full multi-photo carousel albums, and Reels at maximum available resolution.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-blue-400 font-bold">●</span> Facebook (Albums, Posts & Reels)
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Automatically extracts public or friends-only photo albums with original titles and high-definition video.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-emerald-400 font-bold">●</span> Spotify & Apple Music Matching
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Reads catalog metadata and automatically finds the best public audio recording, embedding genuine cover art and ID3 tags.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-amber-400 font-bold">●</span> TikTok, SoundCloud, Pinterest & Reddit
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Watermark-free TikToks, SoundCloud tracks with artwork, Pinterest original pins/boards, and Reddit media.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-purple-400 font-bold">●</span> Local Files & Batch Folders
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Drag and drop local audio, video, or image files to convert, compress, or change format with hardware speed.
                </p>
              </div>
            </div>
          </section>

          {/* 3. Browser Cookies & Private Media */}
          <section className="panel space-y-3 p-5" aria-labelledby="guide-browser-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <ShieldCheck size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-browser-heading">Browser Cookies & Private Media (Zero Extensions)</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Public links work immediately with zero configuration. For private videos, members-only posts, or friends-only Facebook/Instagram photos, JaneConverter can read your existing browser sessions directly.
            </p>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-2 text-xs">
              <div className="font-medium text-zinc-300">How to use your browser session:</div>
              <ul className="list-disc pl-4 space-y-1 text-zinc-400 text-[11px]">
                <li>Go to the <strong className="text-zinc-200">Browser & Sessions</strong> tab above.</li>
                <li>Ensure <strong className="text-zinc-200">Read Browser Cookies</strong> is turned ON.</li>
                <li>For Microsoft Edge or Google Chrome, enable <strong className="text-zinc-200">Direct Edge & Chrome Cookie Access</strong> (one-time setup).</li>
                <li>No browser extension or manual cookie file export is required!</li>
              </ul>
            </div>
          </section>

          {/* 4. FL Studio Downgrades */}
          <section className="panel space-y-3 p-5" aria-labelledby="guide-flp-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Music size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-flp-heading">FL Studio (.flp) Project Downgrader</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Collaborating with other music producers who use older versions of FL Studio (e.g. FL 20 or 21)? Older FL Studio versions reject newer project files with a blocking error.
            </p>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-1.5 text-xs">
              <div className="font-medium text-zinc-300">How to downgrade an FL Studio project:</div>
              <ol className="list-decimal pl-4 space-y-1 text-zinc-400 text-[11px]">
                <li>Click <strong className="text-zinc-200">FL Studio Tools</strong> in the left sidebar.</li>
                <li>Select your <code className="text-zinc-300">.flp</code> file. JaneConverter will display its tempo, PPQ, and channel count.</li>
                <li>Choose your target version (e.g. FL 20.8.4, FL 21.0.3) and click <strong>Downgrade Project</strong>.</li>
                <li>Your original file is kept completely safe; a new downgraded file is created next to it.</li>
              </ol>
            </div>
          </section>

          {/* 5. Presets Cheat Sheet */}
          <section className="panel space-y-3 p-5" aria-labelledby="guide-presets-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Zap size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-presets-heading">Presets & Format Cheat Sheet</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Fast MP3</span>
                  <span className="mono-label text-[10px]">320k</span>
                </div>
                <p className="text-[11px] text-zinc-400">Fastest audio extraction without volume normalization. Great for samples and quick listens.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Universal Music</span>
                  <span className="mono-label text-[10px]">-14 LUFS</span>
                </div>
                <p className="text-[11px] text-zinc-400">320kbps MP3 with EBU R128 loudness leveling, cover art, and clean track tags.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Lossless Audio</span>
                  <span className="mono-label text-[10px]">FLAC / WAV</span>
                </div>
                <p className="text-[11px] text-zinc-400">Bit-perfect uncompressed audio for music production and master archives.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Universal Video</span>
                  <span className="mono-label text-[10px]">1080p MP4</span>
                </div>
                <p className="text-[11px] text-zinc-400">Standard Full HD MP4 compatible with phones, TVs, Discord, and editors.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Lossless Image</span>
                  <span className="mono-label text-[10px]">PNG</span>
                </div>
                <p className="text-[11px] text-zinc-400">Full uncompressed original resolution for social photos, artwork, and wallpapers.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Stream Copy</span>
                  <span className="mono-label text-[10px]">Instant</span>
                </div>
                <p className="text-[11px] text-zinc-400">When source and target match, audio/video streams copy losslessly in milliseconds.</p>
              </div>
            </div>
          </section>

          {/* 6. Quick FAQ & Troubleshooting */}
          <section className="panel space-y-3 p-5" aria-labelledby="guide-faq-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <HelpCircle size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-faq-heading">Quick Troubleshooting & FAQ</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-medium text-zinc-200">Where are my files saved?</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Inside your JaneConverter Export Library, organized by category (Music, Video, Images). You can change this location anytime in <strong>Settings → System & Updates → Data Root Folder</strong>.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-medium text-zinc-200">A video says "Sign-in required" or "Confirm you're not a bot"</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Go to <strong>Settings → Browser & Sessions</strong> and verify <strong>Read Browser Cookies</strong> is enabled so JaneConverter can authenticate automatically using your desktop browser.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-medium text-zinc-200">How do I make conversions faster?</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Make sure <strong>Adaptive GPU Acceleration</strong> is enabled in <strong>Settings → Hardware & Engine</strong>. For audio, choose the <strong>Fast MP3</strong> preset to bypass volume analysis.
                </p>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Status Bar */}
      <div
        className={`rounded-lg border px-3 py-2 text-[11px] ${
          message ? "border-[#3b82f6]/15 bg-[#3b82f6]/[0.04] text-zinc-300" : "border-transparent text-zinc-600"
        }`}
        role="status"
        aria-live="polite"
      >
        {message || "Update and relaunch results appear here."}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-zinc-700">
        <ExternalLink size={12} />{" "}
        {runtime?.packaged ? "Application data uses your OS user-data directory." : "Project-local storage is the default."}{" "}
        User-selected folders are always respected.
      </div>

      <UpdateChangesModal
        open={showLocalChangesModal}
        onClose={() => setShowLocalChangesModal(false)}
        updateResult={effectiveUpdateResult}
        installing={installing}
        onInstall={() => void installUpdate()}
        theme={bgColor === "#ffffff" || bgColor === "#fdf7fa" || bgColor === "#f4f4f5" ? "light" : "dark"}
      />
    </div>
  );
}
