import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, GitCommit, Loader2, RefreshCw, Sparkles, X, Zap } from "lucide-react";
import type { UpdateCheckResult } from "../bridge";
import { bridge } from "../bridge";
import { isAppUpdateAvailable } from "./UpdatePromptHeader";

interface UpdateChangesModalProps {
  open: boolean;
  onClose: () => void;
  updateResult: UpdateCheckResult | null;
  installing?: boolean;
  onInstall?: () => void;
  theme?: string;
}

function parseCommitLine(line: string): { hash?: string; message: string } {
  const trimmed = line.trim();
  // Match lines like "4328840 fix(desktop-ui): message" or "4328840 - message"
  const match = trimmed.match(/^([0-9a-f]{7,40})\s+[-:]?\s*(.+)$/i);
  if (match) {
    return { hash: match[1], message: match[2] };
  }
  return { message: trimmed };
}

export function UpdateChangesModal({
  open,
  onClose,
  updateResult,
  installing = false,
  onInstall,
  theme = "dark",
}: UpdateChangesModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [remoteCommits, setRemoteCommits] = useState<string[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const repo = updateResult?.repo;
  const engine = updateResult?.engine;
  const isAppUpdate = isAppUpdateAvailable(repo);

  const rawCommits = repo?.commits ?? [];
  const meaningfulRaw = rawCommits.filter(
    (c) => !/full changelog/i.test(c) && !c.trim().startsWith("http")
  );

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (meaningfulRaw.length > 0) return;

    let active = true;
    setLoadingRemote(true);
    fetch("https://api.github.com/repos/jeongchaeul/JaneConverter/commits?per_page=10")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: unknown) => {
        if (!active || !Array.isArray(data)) return;
        const lines = data
          .map((item: { sha?: string; commit?: { message?: string } }) => {
            const hash = item.sha?.slice(0, 7) || "";
            const msg = item.commit?.message?.split("\n")[0]?.trim() || "";
            return hash && msg ? `${hash} ${msg}` : msg;
          })
          .filter(Boolean);
        if (lines.length > 0) {
          setRemoteCommits(lines);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingRemote(false);
      });

    return () => {
      active = false;
    };
  }, [open, meaningfulRaw.length]);

  if (!open) return null;

  const commits = meaningfulRaw.length > 0 ? meaningfulRaw : remoteCommits;
  const latestRev = repo?.latest_commit?.slice(0, 7) || repo?.latest_version;
  const currentRev = repo?.current_commit?.slice(0, 7) || repo?.current_version;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5 backdrop-blur-md animate-in fade-in duration-200"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="panel relative w-full max-w-lg p-6 shadow-2xl shadow-black/70 animate-in zoom-in-95 duration-200 border"
        style={{
          backgroundColor: theme === "light" ? "#ffffff" : "#0c0a15",
          borderColor: "var(--accent-glow, rgba(197, 43, 104, 0.3))",
          boxShadow: "0 0 35px var(--accent-subtle, rgba(197, 43, 104, 0.15))",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors"
          aria-label="Close update changes window"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-center gap-2">
          <Sparkles className="size-4" style={{ color: "var(--accent-color, #c52b68)" }} />
          <span className="mono-label">
            {isAppUpdate ? "Push updates & changes" : "Changelog & build history"}
          </span>
        </div>

        <h2 id="update-modal-title" className="mt-2 text-xl font-semibold text-white">
          {isAppUpdate ? "JaneConverter Update" : "JaneConverter Changelog"}
        </h2>

        {/* Version progression pill or Up-to-date badge */}
        {isAppUpdate ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.10] bg-white/[0.04] px-2.5 py-1 font-mono text-zinc-300">
              <span className="text-zinc-500">Current:</span> {currentRev || "installed"}
            </span>
            <span className="text-zinc-500">→</span>
            <span
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono font-medium"
              style={{
                borderColor: "var(--accent-glow, rgba(197, 43, 104, 0.4))",
                backgroundColor: "var(--accent-subtle, rgba(197, 43, 104, 0.15))",
                color: "var(--accent-color, #c52b68)",
              }}
            >
              <span className="text-zinc-400">Latest:</span> {latestRev || "new build"}
            </span>
            {repo?.commits_behind && repo.commits_behind > 0 ? (
              <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-400">
                {repo.commits_behind} {repo.commits_behind === 1 ? "commit" : "commits"} behind
              </span>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-emerald-300 font-medium">
              <Check className="size-3.5 text-emerald-400" />
              <span>Up to date</span>
              <span className="text-emerald-400/60">•</span>
              <span>{currentRev ? `build ${currentRev}` : (repo?.current_version ? `v${repo.current_version}` : "latest build")}</span>
            </span>
          </div>
        )}

        {/* Changes list / Commit history */}
        <div className="mt-4">
          <div className="text-xs font-medium uppercase tracking-wider text-zinc-400 mb-2">
            {isAppUpdate ? "Summary of Changes" : "Recent Build Changes"}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
            {loadingRemote && commits.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-zinc-400 py-3 justify-center">
                <Loader2 className="size-3.5 animate-spin text-zinc-400" />
                <span>Fetching recent changelog...</span>
              </div>
            ) : commits.length > 0 ? (
              commits.map((line, idx) => {
                const { hash, message } = parseCommitLine(line);
                return (
                  <div key={idx} className="flex items-start gap-2.5 text-xs leading-relaxed text-zinc-300">
                    <GitCommit
                      className="size-3.5 shrink-0 mt-0.5"
                      style={{ color: "var(--accent-color, #c52b68)" }}
                    />
                    <div className="min-w-0 flex-1">
                      {hash && (
                        <span className="mr-2 font-mono text-[11px] font-semibold text-zinc-400 bg-white/[0.06] px-1.5 py-0.5 rounded">
                          {hash}
                        </span>
                      )}
                      <span>{message}</span>
                    </div>
                  </div>
                );
              })
            ) : repo?.notes && !/^\s*(?:\*\*)?full changelog/i.test(repo.notes) ? (
              <div className="whitespace-pre-wrap text-xs text-zinc-300 font-sans leading-relaxed">
                {repo.notes}
              </div>
            ) : (
              <div className="space-y-2 py-1 text-xs text-zinc-400 leading-relaxed">
                <p>
                  This release contains the latest media conversion fixes, extractor engine updates, and stability improvements.
                </p>
                {repo?.release_url ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (repo.release_url) void bridge.openUrl(repo.release_url);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white underline underline-offset-2"
                  >
                    <span>View full release notes on GitHub</span>
                    <ExternalLink className="size-3" />
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Engine update notice if yt-dlp was also updated */}
        {engine?.has_update && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
            <Zap className="size-3.5 shrink-0 text-emerald-400" />
            <span>
              Extractor engine upgrade ready: <strong>v{engine.current_version}</strong> → <strong>v{engine.latest_version}</strong>
            </span>
          </div>
        )}

        {/* Modal actions */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
          <div className="flex items-center gap-2">
            {isAppUpdate && repo?.installer_available && onInstall ? (
              <button
                type="button"
                disabled={installing}
                onClick={onInstall}
                className="primary-button flex items-center gap-2 px-3.5 py-2 text-xs disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw className={`size-3.5 ${installing ? "animate-spin" : ""}`} />
                <span>{installing ? "Installing update..." : "Update now"}</span>
              </button>
            ) : null}

            {repo?.release_url && (
              <button
                type="button"
                onClick={() => void bridge.openUrl(repo.release_url || "")}
                className="subtle-button flex items-center gap-2 px-3.5 py-2 text-xs"
              >
                <ExternalLink className="size-3.5" />
                <span>Open release notes</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="subtle-button px-4 py-2 text-xs"
          >
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
