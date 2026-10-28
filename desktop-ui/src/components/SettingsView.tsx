function isColorLight(hex: string): boolean {
  const clean = (hex || "").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  if (isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 135;
}

import { useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  ExternalLink,
  Globe,
  HardDrive,
  Palette,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ConverterSettings, RuntimeInfo, UpdateCheckResult } from "../bridge";
import { bridge } from "../bridge";
import { StoryTermsModal } from "./StoryTermsModal";
import { UpdateChangesModal } from "./UpdateChangesModal";
import { SettingsBrowserTab } from "./settings/SettingsBrowserTab";
import { SettingsHardwareTab } from "./settings/SettingsHardwareTab";
import { SettingsThemeTab } from "./settings/SettingsThemeTab";
import { SettingsSystemTab } from "./settings/SettingsSystemTab";
import { SettingsGuideTab } from "./settings/SettingsGuideTab";

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
  const [showStoryModal, setShowStoryModal] = useState(false);
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
      : "Browser session cookie reading disabled. Conversions will use strictly public guest extraction.";
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

  return (
    <div className="mx-auto max-w-[980px] space-y-6 pb-12">
      {/* Header and Category Pills */}
      <div>
        <div className="mono-label">Settings &amp; Configuration</div>
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
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-[var(--accent-color,#c52b68)] text-white shadow-sm ring-1 ring-white/20"
                    : "subtle-button text-zinc-300 hover:text-white"
                }`}
              >
                <Icon size={14} className={isSelected ? "text-white" : "text-zinc-400"} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Panels */}
      {activeTab === "browser" && (
        <SettingsBrowserTab
          settings={settings}
          onSettings={onSettings}
          chromiumPolicy={chromiumPolicy}
          togglingPolicy={togglingPolicy}
          policyError={policyError}
          copiedCmd={copiedCmd}
          toggleChromiumPolicy={toggleChromiumPolicy}
          toggleBrowserCookies={toggleBrowserCookies}
          setCopiedCmd={setCopiedCmd}
          setShowStoryModal={setShowStoryModal}
          setMessage={setMessage}
          onStatus={onStatus}
        />
      )}

      {activeTab === "hardware" && (
        <SettingsHardwareTab
          settings={settings}
          onSettings={onSettings}
          runtime={runtime}
          dataRootPath={dataRootPath}
          setDataRootPath={setDataRootPath}
          changingDataRoot={changingDataRoot}
          relaunching={relaunching}
          toggleAdaptiveGpu={toggleAdaptiveGpu}
          chooseDataRoot={chooseDataRoot}
          changeDataRoot={changeDataRoot}
          relaunch={relaunch}
        />
      )}

      {activeTab === "theme" && (
        <SettingsThemeTab
          accentColor={accentColor}
          bgColor={bgColor}
          onAccentColorChange={onAccentColorChange}
          onBgColorChange={onBgColorChange}
          onResetColors={onResetColors}
          onStatus={onStatus}
        />
      )}

      {activeTab === "system" && (
        <SettingsSystemTab
          runtime={runtime}
          effectiveUpdateResult={effectiveUpdateResult}
          checking={checking}
          isCheckingUpdates={isCheckingUpdates}
          installing={installing}
          updateDismissed={updateDismissed}
          setUpdateDismissed={setUpdateDismissed}
          setMessage={setMessage}
          updates={updates}
          installUpdate={installUpdate}
          onOpenChangesModal={onOpenChangesModal}
          setShowLocalChangesModal={setShowLocalChangesModal}
        />
      )}

      {activeTab === "guide" && (
        <SettingsGuideTab onNavigateTab={(tab) => setActiveTab(tab)} />
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

      {/* Modals */}
      <StoryTermsModal
        isOpen={showStoryModal}
        accentColor={accentColor}
        onClose={() => setShowStoryModal(false)}
        onConfirm={() => {
          if (settings && onSettings) {
            onSettings({ ...settings, allowStoryExtraction: true });
            const msg = "Ephemeral stories extraction enabled. Terms of Usage acknowledged.";
            setMessage(msg);
            onStatus(msg);
          }
        }}
      />

      <UpdateChangesModal
        open={showLocalChangesModal}
        onClose={() => setShowLocalChangesModal(false)}
        updateResult={effectiveUpdateResult}
        installing={installing}
        onInstall={() => void installUpdate()}
        theme={isColorLight(bgColor) ? "light" : "dark"}
      />
    </div>
  );
}
