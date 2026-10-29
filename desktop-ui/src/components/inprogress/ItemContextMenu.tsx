import { Clock, Copy, FolderOpen, Play, Terminal } from "lucide-react";
import { formatElapsedMs } from "../../options";
import { ItemStatusBadge } from "./ItemStatusBadge";
import type { InProgressItem } from "./types";

interface ItemContextMenuProps {
  contextMenu: { x: number; y: number; item: InProgressItem } | null;
  onClose: () => void;
  fullPath?: string;
  elapsedMs?: number;
  openItemFile: (item: InProgressItem) => void;
  showItemInFolder: (item: InProgressItem) => void;
  openOutputFolder?: () => void;
  onOpenRawConsole: () => void;
  onStatus: (message: string) => void;
  hasOutputDir: boolean;
}

export function ItemContextMenu({
  contextMenu,
  onClose,
  fullPath,
  elapsedMs,
  openItemFile,
  showItemInFolder,
  openOutputFolder,
  onOpenRawConsole,
  onStatus,
  hasOutputDir,
}: ItemContextMenuProps) {
  if (!contextMenu) return null;
  const item = contextMenu.item;
  const hasPath = Boolean(fullPath);

  return (
    <div
      style={{
        position: "fixed",
        left: `${contextMenu.x}px`,
        top: `${contextMenu.y}px`,
        zIndex: 9999,
      }}
      className="context-menu min-w-[240px] rounded-xl border border-white/[0.12] bg-[#0c0914]/95 p-1.5 shadow-2xl shadow-black/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header Info */}
      <div className="border-b border-white/[0.06] px-3 py-2">
        <div className="truncate text-xs font-semibold text-white" title={item.title}>
          {item.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-400">
          <span className="capitalize">{item.mediaKind}</span>
          {item.total > 1 && (
            <>
              <span>•</span>
              <span>#{item.index} of {item.total}</span>
            </>
          )}
          {item.artist && (
            <>
              <span>•</span>
              <span className="truncate">{item.artist}</span>
            </>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px]">
          <span className="text-zinc-400">Status</span>
          <div className="scale-90 origin-right">
            <ItemStatusBadge item={item} />
          </div>
        </div>
        {elapsedMs !== undefined && (
          <div className="mt-1.5 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px]">
            <span className="inline-flex items-center gap-1 text-zinc-400">
              <Clock size={11} style={{ color: "var(--accent-color)" }} /> Conversion time
            </span>
            <span className="font-mono text-zinc-200">
              {formatElapsedMs(elapsedMs)}
            </span>
          </div>
        )}
        {item.eta && (
          <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-zinc-400">
            <span>ETA</span>
            <span className="font-mono text-zinc-300">{item.eta}</span>
          </div>
        )}
        {item.errorMessage && (
          <div className="mt-1.5 rounded bg-rose-500/10 border border-rose-500/20 p-1.5 text-[10px] text-rose-300 break-words">
            {item.errorMessage}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-1 space-y-0.5">
        {item.status === "ready" && hasPath && (
          <>
            <button
              type="button"
              onClick={() => {
                openItemFile(item);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-[var(--accent-subtle)] hover:text-white"
            >
              <Play size={13} style={{ color: "var(--accent-color)" }} />
              {item.mediaKind === "image" ? "Open photo" : "Open / Play file"}
            </button>
            <button
              type="button"
              onClick={() => {
                showItemInFolder(item);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
            >
              <FolderOpen size={13} className="text-zinc-400" /> Show in File Explorer
            </button>
            <button
              type="button"
              onClick={() => {
                if (fullPath) {
                  void navigator.clipboard.writeText(fullPath);
                  onStatus(`Copied path for ${item.title}`);
                }
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
            >
              <Copy size={13} className="text-zinc-400" /> Copy full path
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(item.title);
            onStatus(`Copied title: ${item.title}`);
            onClose();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
        >
          <Copy size={13} className="text-zinc-400" /> Copy title
        </button>

        {hasOutputDir && openOutputFolder && (
          <button
            type="button"
            onClick={() => {
              openOutputFolder();
              onClose();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
          >
            <FolderOpen size={13} className="text-zinc-400" /> Open destination folder
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            onOpenRawConsole();
            onClose();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.06]"
        >
          <Terminal size={13} className="text-zinc-400" /> View terminal logs
        </button>
      </div>
    </div>
  );
}
