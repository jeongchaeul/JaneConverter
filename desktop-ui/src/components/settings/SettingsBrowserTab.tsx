import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { ConverterSettings } from "../../bridge";

export function SettingsBrowserTab({
  settings,
  onSettings,
  chromiumPolicy,
  togglingPolicy,
  policyError,
  copiedCmd,
  toggleChromiumPolicy,
  toggleBrowserCookies,
  setCopiedCmd,
  setShowStoryModal,
  setMessage,
  onStatus,
}: {
  settings?: ConverterSettings;
  onSettings?: (next: ConverterSettings) => void;
  chromiumPolicy: boolean;
  togglingPolicy: boolean;
  policyError: string | null;
  copiedCmd: boolean;
  toggleChromiumPolicy: () => Promise<void>;
  toggleBrowserCookies: () => void;
  setCopiedCmd: (copied: boolean) => void;
  setShowStoryModal: (show: boolean) => void;
  setMessage: (msg: string) => void;
  onStatus: (msg: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        <Globe className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
        Browser Authentication &amp; Cookie Sessions
      </div>

      {/* Direct Edge & Chrome Cookie Access (Opt-in Policy) */}
      <section className="panel space-y-4 p-5" aria-labelledby="chromium-cookie-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <ShieldCheck size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="chromium-cookie-heading">Direct Edge &amp; Chrome Cookie Access</span>
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
            <span>How direct Edge &amp; Chrome access works &amp; technical details</span>
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
            <span>View privacy guarantees &amp; supported features</span>
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
                    <span><strong>Friends-only Facebook Reels &amp; posts</strong>: Automatically extracts media when you are logged into your browser.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                    <span><strong>Age-restricted YouTube &amp; anti-bot screens</strong>: Transparently bypasses Error 152 and login-gated videos.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                    <span><strong>Subscriber &amp; members-only media</strong>: Resolves streams from accounts you have authenticated sessions for.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                    <span><strong>Frictionless recovery</strong>: Zero manual cookie export files (.txt) or password entry needed.</span>
                  </li>
                </ul>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-sky-300">
                  <ShieldCheck className="size-3.5 shrink-0" /> Local-only privacy guarantees
                </div>
                <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                  <li className="flex items-start gap-1.5">
                    <span className="font-mono text-sky-400 shrink-0 font-bold">•</span>
                    <span><strong>RAM only (ephemeral)</strong>: Target cookies are extracted into memory during conversion and instantly purged upon completion. Never written to settings or logs.</span>
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
                    <span><strong>Local media &amp; FLP projects</strong>: Full local transcoding and FL Studio downgrade features work without web dependencies.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="size-3 shrink-0 text-emerald-400 mt-0.5" />
                    <span><strong>Zero browser file access</strong>: Local browser SQLite files are strictly never opened, inspected, or queried.</span>
                  </li>
                </ul>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                  <XCircle className="size-3.5 shrink-0" /> What won&apos;t work when disabled
                </div>
                <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                  <li className="flex items-start gap-1.5">
                    <XCircle className="size-3 shrink-0 text-amber-400 mt-0.5" />
                    <span><strong>Friends-only Facebook Reels &amp; posts</strong>: Facebook blocks guest access with &quot;Cannot parse data / Sign-in required&quot;.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <XCircle className="size-3 shrink-0 text-amber-400 mt-0.5" />
                    <span><strong>Age-gated &amp; bot-checked YouTube videos</strong>: Videos requiring sign-in (Error 152) cannot verify your session.</span>
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
            <span>View pre-opening mechanism &amp; details</span>
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

      {/* Ephemeral Stories Extraction (Opt-in Legal Compliance) */}
      <section className="panel space-y-4 p-5" aria-labelledby="ephemeral-stories-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <ShieldAlert size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="ephemeral-stories-heading">Ephemeral Stories Extraction</span>
              <span
                className={
                  "rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase " +
                  (settings?.allowStoryExtraction
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "border-white/[0.10] bg-white/[0.03] text-zinc-400")
                }
              >
                {settings?.allowStoryExtraction ? "Active (Opt-In Acknowledged)" : "Disabled (Protected)"}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              Permits extraction of temporary 24-hour stories from <strong className="text-zinc-200">Instagram</strong> and <strong className="text-zinc-200">Facebook</strong>. Because stories have an ephemeral lifecycle and strict privacy boundaries (Close Friends, Friends Only), enabling this feature requires explicit acknowledgement of legal compliance terms under applicable data privacy laws.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {settings?.allowStoryExtraction && (
              <button
                type="button"
                onClick={() => setShowStoryModal(true)}
                className="subtle-button px-3 py-2 text-xs text-zinc-300 hover:text-white"
              >
                View Terms
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(settings?.allowStoryExtraction)}
              aria-label="Ephemeral Stories Extraction"
              disabled={!settings || !onSettings}
              onClick={() => {
                if (!settings || !onSettings) return;
                if (settings.allowStoryExtraction) {
                  onSettings({ ...settings, allowStoryExtraction: false });
                  const msg = "Ephemeral stories extraction disabled. Protected air-gap restored.";
                  setMessage(msg);
                  onStatus(msg);
                } else {
                  setShowStoryModal(true);
                }
              }}
              className={
                "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
                (settings?.allowStoryExtraction
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                  : "subtle-button text-zinc-200")
              }
            >
              {settings?.allowStoryExtraction ? (
                <>
                  <ShieldCheck className="size-3.5 text-emerald-300" />
                  Stories Extraction Active
                </>
              ) : (
                <>
                  <Lock className="size-3.5 text-zinc-400" />
                  Enable Story Extraction
                </>
              )}
            </button>
          </div>
        </div>

        <details className="group border-t border-white/[0.06] pt-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors list-none select-none">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180 text-zinc-500" />
            <span>View legal compliance, privacy boundaries &amp; Acceptable Use Policy</span>
          </summary>
          <div className="mt-3 grid gap-2.5 md:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                <ShieldAlert className="size-3.5 shrink-0" /> Statutory Compliance Notice
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                Ephemeral stories carry a statutory expectation of expiration. Archiving or distributing audience-restricted stories without authorization may violate privacy laws including the Philippine Data Privacy Act of 2012 (RA 10173), Anti-Photo and Video Voyeurism Act (RA 9995), GDPR, and 18 U.S.C. § 2701.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-sky-300">
                <CheckCircle2 className="size-3.5 shrink-0" /> Permitted Archival Use
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                This feature is strictly intended for archiving stories created by your own accounts or stories where the creator has provided explicit written consent. Users assume 100% individual legal liability for all media archived.
              </p>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
