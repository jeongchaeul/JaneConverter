import {
  AlertCircle,
  CheckCircle2,
  FileAudio,
  FileImage,
  Files,
  FileVideo,
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { QueueItem } from "./queueUtils";

interface ConverterQueueProps {
  queue: QueueItem[];
  queueRunning: boolean;
  running: boolean;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onClearCompleted: () => void;
  onClearAll: () => void;
  onRetryItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onConfigureItem: (item: QueueItem) => void;
  onOpenFile: (path: string) => void;
}

export function ConverterQueue({
  queue,
  queueRunning,
  running,
  onStartQueue,
  onPauseQueue,
  onClearCompleted,
  onClearAll,
  onRetryItem,
  onRemoveItem,
  onConfigureItem,
  onOpenFile,
}: ConverterQueueProps) {
  if (queue.length === 0) return null;

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Files className="size-4 text-[#c52b68]" />
          <div className="text-sm font-medium text-white">Conversion Queue</div>
          <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-mono text-zinc-300">
            {queue.filter((it) => it.status === "completed").length}/{queue.length} completed
          </span>
          {queueRunning && (
            <span className="inline-flex items-center gap-1 rounded-full border border-pink-500/30 bg-pink-500/10 px-2 py-0.5 text-[10px] text-pink-300 animate-pulse">
              <LoaderCircle className="size-2.5 animate-spin" /> Processing queue
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!queueRunning ? (
            <button
              type="button"
              disabled={!queue.some((it) => it.status === "queued" || it.status === "converting")}
              onClick={onStartQueue}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-pink-300 hover:text-pink-200 border-pink-500/25 bg-pink-500/[0.06] disabled:opacity-40"
            >
              <Play className="size-3 fill-current" /> Start queue
            </button>
          ) : (
            <button
              type="button"
              onClick={onPauseQueue}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-300 hover:text-amber-200 border-amber-500/25 bg-amber-500/[0.06]"
            >
              <Pause className="size-3" /> Pause queue
            </button>
          )}
          {queue.some((it) => it.status === "completed") && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="subtle-button px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Clear completed
            </button>
          )}
          <button
            type="button"
            onClick={onClearAll}
            className="subtle-button px-2.5 py-1.5 text-xs text-zinc-400 hover:text-rose-400"
          >
            Clear all
          </button>
        </div>
      </div>

      <div className="mt-3 divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-black/20">
        {queue.map((item, index) => {
          const isUrl = /^https?:\/\//i.test(item.source);
          const trackCount = item.playlistIndexes
            ? item.playlistIndexes.split(",").length
            : item.playlistCatalog
            ? item.playlistCatalog.items.length
            : null;

          return (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-xs">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="font-mono text-[10px] text-zinc-600 w-4 text-right shrink-0">
                  #{index + 1}
                </span>
                {item.category === "Image" ? (
                  <FileImage className="size-4 text-sky-400 shrink-0" />
                ) : item.category === "Video" ? (
                  <FileVideo className="size-4 text-purple-400 shrink-0" />
                ) : (
                  <FileAudio className="size-4 text-pink-400 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-200 truncate max-w-xs">{item.name}</span>
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-mono uppercase text-zinc-400">
                      {item.category}
                    </span>
                    {item.presetName && (
                      <span className="rounded bg-pink-500/15 border border-pink-500/25 px-1.5 py-0.5 text-[9px] font-medium text-pink-300">
                        {item.presetName}
                      </span>
                    )}
                    {trackCount !== null && (
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-mono text-zinc-400">
                        {trackCount} tracks
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-zinc-600 truncate max-w-sm mt-0.5">{item.source}</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                {item.status === "converting" && (
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10">
                      <div
                        className="h-full rounded-full bg-[#c52b68] transition-all duration-200"
                        style={{ width: `${Math.round(item.progress * 100)}%` }}
                      />
                    </div>
                    <span className="flex items-center gap-1 text-[11px] text-amber-300 font-mono font-medium">
                      <LoaderCircle className="size-3 animate-spin" />
                      {Math.round(item.progress * 100)}%
                    </span>
                  </div>
                )}

                {item.status === "completed" && (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                      <CheckCircle2 className="size-3.5" /> Converted
                    </span>
                    {item.outputPath && (
                      <button
                        type="button"
                        onClick={() => onOpenFile(item.outputPath!)}
                        className="subtle-button px-2 py-0.5 text-[10px] text-emerald-300"
                      >
                        Open
                      </button>
                    )}
                  </div>
                )}

                {item.status === "failed" && (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-[11px] text-rose-400" title={item.errorMessage}>
                      <AlertCircle className="size-3.5" /> Failed
                    </span>
                    <button
                      type="button"
                      onClick={() => onRetryItem(item.id)}
                      className="subtle-button flex items-center gap-1 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-white"
                    >
                      <RotateCcw className="size-2.5" /> Retry
                    </button>
                  </div>
                )}

                {item.status === "queued" && (
                  <>
                    <span className="text-[11px] text-zinc-500 font-mono">Queued</span>
                    {isUrl && (
                      <button
                        type="button"
                        onClick={() => onConfigureItem(item)}
                        className="subtle-button flex items-center gap-1 px-2 py-1 text-[11px] text-pink-300 hover:text-pink-200"
                        title="Configure which tracks to include or exclude before conversion starts"
                      >
                        <ListMusic className="size-3" />
                        {item.playlistIndexes ? "Edit tracks" : "Configure tracks"}
                      </button>
                    )}
                  </>
                )}

                <button
                  type="button"
                  disabled={item.status === "converting"}
                  onClick={() => onRemoveItem(item.id)}
                  className="p-1 text-zinc-500 hover:text-rose-400 disabled:opacity-30 transition-colors"
                  title="Remove from queue"
                  aria-label={`Remove ${item.name} from queue`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
