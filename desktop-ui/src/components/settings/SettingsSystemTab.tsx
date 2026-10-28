import {
  CheckCircle2,
  ExternalLink,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { RuntimeInfo, UpdateCheckResult } from "../../bridge";
import { bridge } from "../../bridge";
import { isAppUpdateAvailable } from "../UpdatePromptHeader";

export function SettingsSystemTab({
  runtime,
  effectiveUpdateResult,
  checking,
  isCheckingUpdates,
  installing,
  updateDismissed,
  setUpdateDismissed,
  setMessage,
  updates,
  installUpdate,
  onOpenChangesModal,
  setShowLocalChangesModal,
}: {
  runtime: RuntimeInfo | null;
  effectiveUpdateResult: UpdateCheckResult | null;
  checking: boolean;
  isCheckingUpdates?: boolean;
  installing: boolean;
  updateDismissed: boolean;
  setUpdateDismissed: (dismissed: boolean) => void;
  setMessage: (msg: string) => void;
  updates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onOpenChangesModal?: () => void;
  setShowLocalChangesModal: (show: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        <HardDrive className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
        System Diagnostics &amp; Updates
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

      {/* Personal Sovereign Creator Toolbox */}
      <section className="panel space-y-3 border-l-2 border-l-[var(--accent-color,#c52b68)] p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Sparkles className="size-4 text-[var(--accent-color,#d75b88)]" /> Sovereign Creator Toolbox
        </div>
        <p className="text-xs leading-relaxed text-zinc-300">
          <strong className="text-white">JaneConverter is Jane Cerys&apos;s personal creator toolbox.</strong> It is explicitly not just a converter tool. It is Jane&apos;s bespoke Swiss Army knife spanning universal media ingestion, DAW project bit-level engineering (FL Studio &amp; Ableton Live), custom harmonic DSP, and local archival utilities. Jane builds whatever she needs into this suite. If it enhances your creative workflow, welcome aboard.
        </p>
      </section>

      {/* Legal & Privacy Safeguards */}
      <section className="panel space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <ShieldCheck className="size-4 text-emerald-400" /> Legal &amp; Privacy Safeguards
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
            <ExternalLink className="size-3" /> Legal Disclaimer &amp; Terms
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
  );
}
