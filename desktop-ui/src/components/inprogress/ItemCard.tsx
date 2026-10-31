import { Clock, Film, Image as ImageIcon, Music } from "lucide-react";
import { formatElapsedMs } from "../../options";
import { ItemActionButtons } from "./ItemActionButtons";
import { ItemStatusBadge } from "./ItemStatusBadge";
import type { InProgressItem } from "./types";

interface ItemCardProps {
  item: InProgressItem;
  layoutMode: "grid" | "list";
  preview?: string;
  fullPath?: string;
  elapsedMs?: number;
  isDeleting?: boolean;
  onContextMenu: (e: React.MouseEvent, item: InProgressItem) => void;
  onImageError: (url: string) => void;
  onStatus: (message: string) => void;
  onOpen: (item: InProgressItem) => void;
  onShowInFolder: (item: InProgressItem) => void;
  onDelete?: (item: InProgressItem) => void;
}

export function ItemCard({
  item,
  layoutMode,
  preview,
  fullPath,
  elapsedMs,
  isDeleting = false,
  onContextMenu,
  onImageError,
  onStatus,
  onOpen,
  onShowInFolder,
  onDelete,
}: ItemCardProps) {
  const isActive = item.status === "downloading" || item.status === "transcoding";

  if (layoutMode === "grid") {
    return (
      <div
        onContextMenu={(e) => onContextMenu(e, item)}
        className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-white/[0.025] hover:bg-white/[0.04] p-3.5 transition-all select-none ${
          isActive
            ? "border-fuchsia-500/40 shadow-[0_0_24px_rgba(197,43,104,.18)]"
            : item.status === "ready"
              ? "border-white/[0.08] hover:border-white/[0.16]"
              : "border-white/[0.04] opacity-75 hover:opacity-100"
        }`}
      >
        {/* Thumbnail Container */}
        <div
          className={`relative mb-3 overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.03] ${
            item.mediaKind === "video" ? "aspect-video" : "aspect-square"
          }`}
        >
          {preview ? (
            <img
              src={preview}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => onImageError(preview)}
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 text-zinc-600">
              {item.mediaKind === "video" ? (
                <Film size={28} className={isActive ? "text-fuchsia-400" : "text-zinc-600"} />
              ) : item.mediaKind === "image" ? (
                <ImageIcon size={28} className={isActive ? "text-fuchsia-400" : "text-zinc-600"} />
              ) : (
                <Music size={28} className={isActive ? "text-fuchsia-400" : "text-zinc-600"} />
              )}
              <span className="font-mono text-[10px] text-zinc-500">#{item.index}</span>
            </div>
          )}

          {/* Corner format chip */}
          <div className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-300 backdrop-blur-md">
            {item.mediaKind}
          </div>

          {/* Active transcode/download pulsing ring */}
          {isActive && (
            <div className="pointer-events-none absolute inset-0 border-2 border-fuchsia-400/30 animate-pulse rounded-xl" />
          )}
        </div>

        {/* Item Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <h3
              title={item.title}
              className="truncate text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors"
            >
              {item.title}
            </h3>
          </div>
          {item.artist && (
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">{item.artist}</p>
          )}
        </div>

        {/* Micro Progress Bar (for active items) */}
        {isActive && (
          <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${Math.round(item.progress * 100)}%`,
                backgroundColor: "var(--accent-color, #c52b68)",
              }}
            />
          </div>
        )}

        {/* Card Footer: Status Badge + Conversion Time + Action Buttons */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-white/[0.05]">
          <div className="flex items-center gap-1.5 min-w-0">
            <ItemStatusBadge item={item} />
            {elapsedMs !== undefined && (
              <span
                className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 border border-white/5"
                title={`Conversion took ${formatElapsedMs(elapsedMs)}`}
              >
                <Clock size={10} className="text-zinc-500" />
                {formatElapsedMs(elapsedMs)}
              </span>
            )}
          </div>

          <ItemActionButtons
            item={item}
            fullPath={fullPath}
            isDeleting={isDeleting}
            onStatus={onStatus}
            onOpen={onOpen}
            onShowInFolder={onShowInFolder}
            onDelete={onDelete}
          />
        </div>
      </div>
    );
  }

  // List Mode Rack
  return (
    <div
      onContextMenu={(e) => onContextMenu(e, item)}
      className={`flex flex-wrap items-center gap-3.5 px-4 py-3 transition-colors select-none ${
        isActive ? "bg-fuchsia-500/[0.04]" : "hover:bg-white/[0.02]"
      }`}
    >
      <span className="w-6 text-center font-mono text-xs text-zinc-500">#{item.index}</span>

      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-sm">
        {preview ? (
          <img
            src={preview}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => onImageError(preview)}
            className="size-full object-cover transition-transform duration-300 hover:scale-105"
          />
        ) : item.mediaKind === "video" ? (
          <Film size={18} className="text-zinc-500" />
        ) : item.mediaKind === "image" ? (
          <ImageIcon size={18} className="text-zinc-500" />
        ) : (
          <Music size={18} className="text-zinc-500" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-zinc-200">{item.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
          {item.artist && <span>{item.artist}</span>}
          {item.speed && (
            <>
              <span>•</span>
              <span className="font-mono text-zinc-400">{item.speed}</span>
            </>
          )}
          {item.eta && (
            <>
              <span>•</span>
              <span>ETA {item.eta}</span>
            </>
          )}
        </div>
      </div>

      {isActive && (
        <div className="w-28">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${Math.round(item.progress * 100)}%`,
                backgroundColor: "var(--accent-color, #c52b68)",
              }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        <ItemStatusBadge item={item} />
        {elapsedMs !== undefined && (
          <span
            className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 border border-white/5"
            title={`Conversion took ${formatElapsedMs(elapsedMs)}`}
          >
            <Clock size={10} className="text-zinc-500" />
            {formatElapsedMs(elapsedMs)}
          </span>
        )}
      </div>

      <ItemActionButtons
        item={item}
        fullPath={fullPath}
        isDeleting={isDeleting}
        onStatus={onStatus}
        onOpen={onOpen}
        onShowInFolder={onShowInFolder}
        onDelete={onDelete}
      />
    </div>
  );
}
