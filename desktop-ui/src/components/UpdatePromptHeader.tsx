import { RefreshCw, Sparkles, X } from "lucide-react";
import type { UpdateCheckResult } from "../bridge";

export function isAppUpdateAvailable(repo?: UpdateCheckResult["repo"]): boolean {
  if (!repo || !repo.has_update) return false;
  const current = repo.current_commit?.trim().toLowerCase();
  const latest = repo.latest_commit?.trim().toLowerCase();
  if (current && latest && current !== "unknown" && latest !== "unknown") {
    if (current === latest || current.startsWith(latest) || latest.startsWith(current)) {
      return false;
    }
  }
  const curVer = repo.current_version?.trim().toLowerCase();
  const latVer = repo.latest_version?.trim().toLowerCase();
  if (curVer && latVer && !current && !latest) {
    if (curVer === latVer) {
      return false;
    }
  }
  return true;
}

interface UpdatePromptHeaderProps {
  updateResult: UpdateCheckResult | null;
  dismissed: boolean;
  onOpenChanges: () => void;
  onDismiss: () => void;
  installing?: boolean;
  onInstall?: () => void;
}

export function UpdatePromptHeader({
  updateResult,
  dismissed,
  onOpenChanges,
  onDismiss,
  installing = false,
  onInstall,
}: UpdatePromptHeaderProps) {
  if (dismissed || !updateResult) return null;

  const repo = updateResult.repo;
  const engine = updateResult.engine;
  const hasAppUpdate = isAppUpdateAvailable(repo);

  if (!hasAppUpdate) return null;

  const versionTag = repo?.latest_commit
    ? `build ${repo.latest_commit.slice(0, 7)}`
    : repo?.latest_version
      ? `v${repo.latest_version}`
      : "new release";

  const commitsBehind = repo?.commits_behind ?? 0;

  return (
    <div
      role="status"
      aria-label="Update notification"
      className="sticky top-0 z-30 flex shrink-0 items-center justify-between border-b px-6 py-2 backdrop-blur-xl transition-all duration-200"
      style={{
        backgroundColor: "var(--accent-subtle, rgba(197, 43, 104, 0.08))",
        borderColor: "var(--accent-glow, rgba(197, 43, 104, 0.25))",
        boxShadow: "0 4px 20px -2px var(--accent-subtle, rgba(197, 43, 104, 0.12))",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="relative flex size-2 shrink-0">
          <span
            className="absolute inline-flex size-full animate-ping rounded-full opacity-75"
            style={{ backgroundColor: "var(--accent-color, #c52b68)" }}
          />
          <span
            className="relative inline-flex size-2 rounded-full"
            style={{ backgroundColor: "var(--accent-color, #c52b68)" }}
          />
        </span>
        <div className="flex flex-wrap items-center gap-2 truncate text-xs text-white">
          <span className="font-medium">Update available:</span>
          <span
            className="rounded px-1.5 py-0.5 font-mono font-semibold"
            style={{
              backgroundColor: "var(--accent-subtle, rgba(197, 43, 104, 0.2))",
              color: "var(--accent-color, #c52b68)",
            }}
          >
            {versionTag}
          </span>
          {commitsBehind > 0 && (
            <span className="hidden sm:inline text-zinc-400">
              ({commitsBehind} new {commitsBehind === 1 ? "commit" : "commits"} pushed)
            </span>
          )}
          {engine?.has_update && (
            <span className="hidden md:inline rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300 border border-emerald-500/20">
              Extractor engine upgrade
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-4">
        <button
          type="button"
          onClick={onOpenChanges}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium text-white transition-all hover:brightness-110 active:scale-[0.98]"
          style={{
            borderColor: "var(--accent-glow, rgba(197, 43, 104, 0.45))",
            backgroundColor: "var(--accent-subtle, rgba(197, 43, 104, 0.2))",
            color: "var(--accent-color, #c52b68)",
            boxShadow: "0 0 10px var(--accent-glow, rgba(197, 43, 104, 0.2))",
          }}
        >
          <Sparkles className="size-3.5" />
          <span>View brief changes</span>
        </button>

        {repo?.installer_available && onInstall && (
          <button
            type="button"
            disabled={installing}
            onClick={onInstall}
            className="primary-button flex items-center gap-1.5 px-2.5 py-1 text-xs disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${installing ? "animate-spin" : ""}`} />
            <span>{installing ? "Installing..." : "Update now"}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors"
          title="Dismiss update notice for this session"
          aria-label="Dismiss update notice"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
