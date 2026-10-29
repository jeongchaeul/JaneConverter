import { AlertCircle, Check, Clock, RefreshCw } from "lucide-react";
import type { InProgressItem } from "./types";

export function ItemStatusBadge({ item }: { item: InProgressItem }) {
  switch (item.status) {
    case "ready":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
          <Check size={11} className="stroke-[2.5]" /> Ready
        </span>
      );
    case "transcoding":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-medium text-fuchsia-300">
          <RefreshCw size={10} className="animate-spin" />
          Transcoding {item.speed ? `(${item.speed})` : `${Math.round(item.progress * 100)}%`}
        </span>
      );
    case "downloading":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
          <RefreshCw size={10} className="animate-spin" />
          Downloading {item.speed ? `(${item.speed})` : `${Math.round(item.progress * 100)}%`}
        </span>
      );
    case "failed":
      return (
        <span
          title={item.errorMessage}
          className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300 cursor-help"
        >
          <AlertCircle size={11} /> Failed
        </span>
      );
    case "queued":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-400">
          <Clock size={10} /> Queued
        </span>
      );
  }
}
