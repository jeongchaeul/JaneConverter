import { FolderOpen, GripVertical, Loader2, Play, Trash2 } from "lucide-react";
import { bridge } from "../../bridge";
import type { InProgressItem } from "./types";

interface ItemActionButtonsProps {
  item: InProgressItem;
  fullPath?: string;
  isDeleting?: boolean;
  onStatus: (message: string) => void;
  onOpen: (item: InProgressItem) => void;
  onShowInFolder: (item: InProgressItem) => void;
  onDelete?: (item: InProgressItem) => void;
}

export function ItemActionButtons({
  item,
  fullPath,
  isDeleting = false,
  onStatus,
  onOpen,
  onShowInFolder,
  onDelete,
}: ItemActionButtonsProps) {
  if (item.status !== "ready" || !fullPath) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        draggable
        onDragStartCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (fullPath) {
            void bridge.dragLibraryFile(fullPath).catch((err: unknown) => {
              onStatus(`Could not drag file: ${err instanceof Error ? err.message : String(err)} (${fullPath})`);
            });
          } else {
            onStatus("No file path available to drag.");
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          onStatus("Drag this button into another app (e.g. FL Studio, DAW, or Discord).");
        }}
        className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white cursor-grab active:cursor-grabbing"
        title="Drag this file into another app"
        aria-label={"Drag " + item.title}
      >
        <GripVertical size={12} style={{ color: "var(--accent-color)" }} />
      </button>

      {onDelete && (
        <button
          type="button"
          disabled={isDeleting}
          onClick={(e) => {
            e.stopPropagation();
            if (!isDeleting) {
              onDelete(item);
            }
          }}
          className={`flex size-6 items-center justify-center rounded-lg border transition-colors ${
            isDeleting
              ? "border-red-500/20 bg-red-500/10 text-red-400 opacity-50 cursor-not-allowed pointer-events-none"
              : "border-white/5 bg-white/[0.03] text-zinc-400 hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-400"
          }`}
          title={isDeleting ? "Deleting..." : "Delete file"}
          aria-label={"Delete " + item.title}
        >
          {isDeleting ? <Loader2 size={11} className="animate-spin text-red-400" /> : <Trash2 size={12} />}
        </button>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(item);
        }}
        className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
        title={item.mediaKind === "image" ? "Open photo" : "Open / Play file"}
        aria-label={"Open " + item.title}
      >
        <Play size={11} className="fill-current" style={{ color: "var(--accent-color)" }} />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onShowInFolder(item);
        }}
        className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/10 hover:bg-white/10 hover:text-white"
        title="Show in File Explorer"
        aria-label={"Show in folder for " + item.title}
      >
        <FolderOpen size={12} />
      </button>
    </div>
  );
}
