import {
  FolderOpen,
  ListPlus,
  Pause,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { motion } from "framer-motion";
import type { ConverterEvent } from "../../bridge";

interface ActionBarProps {
  outputDir: string;
  onOutputDirChange: (dir: string) => void;
  onBrowseOutput: () => void;
  onOpenOutput: () => void;
  tempDir?: string;
  onTempDirChange?: (dir: string) => void;
  onBrowseTempDir?: () => void;
  isOperationActive: boolean;
  queueLength: number;
  queueRunning: boolean;
  pendingQueueCount: number;
  onConvert: () => void;
  source: string;
  facebookCaptureBusy: boolean;
  socialCaptureBusy: boolean;
  onAddToQueue: () => void;
  effectivePaused: boolean;
  onPauseToggle: () => void;
  onAbort: () => void;
  status: string;
  progress: number;
  lastEvent?: ConverterEvent | null;
}

export function ActionBar({
  outputDir,
  onOutputDirChange,
  onBrowseOutput,
  onOpenOutput,
  tempDir,
  onTempDirChange,
  onBrowseTempDir,
  isOperationActive,
  queueLength,
  queueRunning,
  pendingQueueCount,
  onConvert,
  source,
  facebookCaptureBusy,
  socialCaptureBusy,
  onAddToQueue,
  effectivePaused,
  onPauseToggle,
  onAbort,
  status,
  progress,
  lastEvent,
}: ActionBarProps) {
  return (
    <section className="panel overflow-hidden p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-center">
        {/* Left Column: Export Destination */}
        <div className="lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
              <FolderOpen className="size-3.5 text-zinc-400" /> Export folder
            </div>
            <span className="hidden sm:inline text-[10px] text-zinc-500 truncate">Default: project-local converted media</span>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              aria-label="Export folder"
              value={outputDir}
              onChange={(event) => onOutputDirChange(event.target.value)}
              className="field h-9 min-w-0 flex-1 px-3 text-xs"
            />
            <button
              type="button"
              onClick={onBrowseOutput}
              className="subtle-button inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 px-3 text-xs whitespace-nowrap"
            >
              Browse
            </button>
            <button
              type="button"
              onClick={onOpenOutput}
              className="subtle-button inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 px-3 text-xs whitespace-nowrap"
            >
              <FolderOpen className="size-3.5" /> Open
            </button>
          </div>

          {/* Temporary scratch folder */}
          <div className="mt-2.5 pt-2 border-t border-white/[0.04]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <span>Temporary scratch folder</span>
              </div>
              <span className="hidden sm:inline text-[10px] text-zinc-500 truncate">Default: project-local temp</span>
            </div>
            <div className="mt-1 flex gap-2">
              <input
                aria-label="Temporary scratch folder"
                placeholder="Default: Project-local temp folder"
                value={tempDir || ""}
                onChange={(event) => onTempDirChange?.(event.target.value)}
                className="field h-8 min-w-0 flex-1 px-2.5 text-[11px]"
              />
              <button
                type="button"
                onClick={onBrowseTempDir}
                className="subtle-button inline-flex h-8 items-center justify-center px-2.5 text-[11px] whitespace-nowrap"
              >
                Browse
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Compact Convert Action & High-Visibility Progress Bar */}
        <div className="flex flex-col justify-center border-t border-white/[0.06] pt-3 lg:col-span-7 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isOperationActive && !(!queueRunning && pendingQueueCount > 0)}
              onClick={onConvert}
              className="primary-button inline-flex h-9.5 flex-1 min-w-[124px] items-center justify-center gap-2 px-3.5 text-xs font-semibold shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              <Play className="size-3.5 fill-current shrink-0" />
              {queueLength > 0 && !queueRunning && pendingQueueCount > 0
                ? `Start queue (${pendingQueueCount} pending)`
                : "Convert media"}
            </button>
            {source.trim() && (
              <button
                type="button"
                disabled={facebookCaptureBusy || socialCaptureBusy}
                onClick={onAddToQueue}
                className="subtle-button inline-flex h-9.5 shrink-0 items-center gap-1.5 px-3 text-xs font-medium text-pink-300 hover:text-pink-200 border-pink-500/25 bg-pink-500/[0.06] disabled:opacity-40 whitespace-nowrap"
                title="Add current source to conversion queue"
              >
                <ListPlus className="size-3.5 shrink-0" />
                Add to queue
              </button>
            )}
            {isOperationActive && (
              <>
                <button
                  type="button"
                  onClick={onPauseToggle}
                  className="subtle-button inline-flex h-9.5 shrink-0 items-center gap-1.5 px-3 text-xs font-medium text-amber-300 hover:text-amber-200 whitespace-nowrap"
                  aria-label={effectivePaused ? "Resume operation" : "Pause operation"}
                >
                  {effectivePaused ? <Play className="size-3 fill-current shrink-0" /> : <Pause className="size-3 shrink-0" />}
                  {effectivePaused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={onAbort}
                  className="danger-button inline-flex h-9.5 shrink-0 items-center gap-1.5 px-3 text-xs whitespace-nowrap"
                  aria-label="Abort operation"
                >
                  <Square className="size-3 shrink-0" /> Abort
                </button>
              </>
            )}
          </div>

          {/* High-visibility progress bar & percentage */}
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className={`truncate ${isOperationActive ? "text-zinc-200 font-medium" : "text-zinc-500"}`}>
                {effectivePaused ? `Paused • ${status || "Operation paused"}` : status || "Ready to convert"}
              </span>
              <span
                className="shrink-0 font-mono font-bold text-xs"
                style={{ color: isOperationActive ? "var(--accent-color, #ec4899)" : "#71717a" }}
              >
                {Math.round(progress * 100)}%
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.06] p-[1px] ring-1 ring-white/10">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: "linear-gradient(to right, var(--accent-color, #c52b68), var(--accent-hover, #e0407b))",
                  boxShadow: "0 0 8px var(--accent-glow, rgba(197,43,104,0.4))",
                }}
                animate={{ width: `${Math.round(progress * 100)}%` }}
                transition={{ ease: "easeOut", duration: 0.25 }}
              />
            </div>
            {lastEvent && (
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500 truncate">
                <RefreshCw
                  className={`size-2.5 shrink-0 ${isOperationActive && !effectivePaused ? "animate-spin" : ""}`}
                  style={isOperationActive ? { color: "var(--accent-color, #ec4899)" } : undefined}
                />
                <span className="truncate">Engine: {lastEvent.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
