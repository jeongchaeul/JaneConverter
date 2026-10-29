import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  History,
  Pause,
  Play,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

interface InProgressHeaderProps {
  distinctJobCount: number;
  currentIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  running: boolean;
  paused: boolean;
  isViewingLive: boolean;
  liveJobId?: string;
  hasEvents: boolean;
  isClosePageDisabled: boolean;
  isOngoing: boolean;
  isSinglePage: boolean;
  hasOutputDir: boolean;
  onNavigateSession: (offset: number) => void;
  onOpenSessionModal: () => void;
  onJumpToLive?: () => void;
  onPauseToggle?: () => Promise<void> | void;
  onAbort?: () => Promise<void> | void;
  onClear: () => void;
  onClosePage: () => void;
  onOpenOutputFolder?: () => void;
  onOpenRawConsole: () => void;
}

export function InProgressHeader({
  distinctJobCount,
  currentIndex,
  hasPrevious,
  hasNext,
  running,
  paused,
  isViewingLive,
  liveJobId,
  hasEvents,
  isClosePageDisabled,
  isOngoing,
  isSinglePage,
  hasOutputDir,
  onNavigateSession,
  onOpenSessionModal,
  onJumpToLive,
  onPauseToggle,
  onAbort,
  onClear,
  onClosePage,
  onOpenOutputFolder,
  onOpenRawConsole,
}: InProgressHeaderProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
      <div>
        <div className="mono-label">Active Workspace</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-.04em] text-white">In Progress View.</h1>
        <p className="mt-1 text-xs text-zinc-400">
          Visual monitoring rack for downloading media, music albums, videos, and photo carousels.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Session carousel shuffle controls */}
        {(distinctJobCount > 0 || running) && (
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1 shadow-inner backdrop-blur-md">
            <button
              type="button"
              onClick={() => onNavigateSession(-1)}
              disabled={!hasPrevious}
              className="flex size-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
              title="Previous conversion session"
              aria-label="Previous session"
            >
              <ChevronLeft size={14} />
            </button>

            <button
              type="button"
              onClick={onOpenSessionModal}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
              title="Click to view all conversion sessions"
            >
              <span className="font-mono text-[11px] font-medium text-zinc-300">
                Session {currentIndex >= 0 ? currentIndex + 1 : 1} / {Math.max(1, distinctJobCount)}
              </span>
              {isViewingLive ? (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="inline-flex items-center rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 border border-white/5">
                  History
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigateSession(1)}
              disabled={!hasNext}
              className="flex size-7 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
              title="Next conversion session"
              aria-label="Next session"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Quick jump back to live session */}
        {running && !isViewingLive && liveJobId && onJumpToLive && (
          <button
            type="button"
            onClick={onJumpToLive}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-all shadow-[0_0_12px_rgba(16,185,129,.2)]"
            title="Return to the active live conversion"
          >
            <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
            Jump to Live
          </button>
        )}

        {/* Live controls (Pause/Resume/Abort) only shown if viewing the live job */}
        {isViewingLive && (running || paused) && (
          <>
            {onPauseToggle && (
              <button
                type="button"
                onClick={() => void onPauseToggle()}
                className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 hover:text-amber-200"
              >
                {paused ? <Play size={13} className="fill-current" /> : <Pause size={13} />}
                {paused ? "Resume" : "Pause"}
              </button>
            )}
            {onAbort && (
              <button
                type="button"
                onClick={() => void onAbort()}
                className="danger-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <Square size={12} /> Abort
              </button>
            )}
          </>
        )}

        {/* Clear button */}
        {!isViewingLive && hasEvents && (
          <button
            type="button"
            onClick={onClear}
            className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            title="Clear this session from view"
          >
            <Trash2 size={13} /> Clear
          </button>
        )}

        {/* Close Page button */}
        <button
          type="button"
          onClick={onClosePage}
          disabled={isClosePageDisabled}
          aria-disabled={isClosePageDisabled}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-all ${
            isClosePageDisabled
              ? "border-white/[0.04] bg-black/60 text-zinc-600 opacity-25 cursor-not-allowed pointer-events-none select-none shadow-none"
              : "subtle-button text-zinc-300 hover:text-white"
          }`}
          title={
            isOngoing
              ? "Cannot close page while conversion is ongoing (abort first)"
              : isSinglePage
                ? "Cannot close the only remaining conversion page"
                : "Close this conversion page"
          }
        >
          <X size={13} /> Close Page
        </button>

        {/* Conversion Sessions History */}
        <button
          type="button"
          onClick={onOpenSessionModal}
          className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
          title="View conversion session history"
        >
          <History size={13} /> History
        </button>

        {/* Output Folder */}
        {hasOutputDir && onOpenOutputFolder && (
          <button
            type="button"
            onClick={onOpenOutputFolder}
            className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            title="Open output destination folder"
          >
            <FolderOpen size={13} /> Output Folder
          </button>
        )}

        {/* Raw Console */}
        <button
          type="button"
          onClick={onOpenRawConsole}
          className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
          title="Inspect full diagnostic terminal logs"
        >
          <Terminal size={13} /> Raw Console
        </button>
      </div>
    </div>
  );
}
