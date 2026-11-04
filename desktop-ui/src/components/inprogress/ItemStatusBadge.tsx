import { AlertCircle, Check, Clock, RefreshCw } from "lucide-react";
import type { InProgressItem } from "./types";

export function formatBriefError(error?: string): string {
  if (!error) return "Failed";
  const lower = error.toLowerCase();

  if (
    lower.includes("country") ||
    lower.includes("region") ||
    lower.includes("geoblock") ||
    lower.includes("geo restricted") ||
    lower.includes("not available in your")
  ) {
    return "Failed: Region Blocked";
  }
  if (
    lower.includes("private video") ||
    lower.includes("video is private") ||
    lower.includes("needs_auth")
  ) {
    return "Failed: Private Video";
  }
  if (
    lower.includes("bot") ||
    lower.includes("sign in to confirm") ||
    lower.includes("bot challenge")
  ) {
    return "Failed: Bot Challenge";
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "Failed: 403 Forbidden";
  }
  if (
    lower.includes("not available") ||
    lower.includes("unavailable") ||
    lower.includes("deleted video") ||
    lower.includes("video deleted") ||
    lower.includes("dead or unavailable") ||
    lower.includes("no matching streams")
  ) {
    return "Failed: Unavailable";
  }
  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("connection reset") ||
    lower.includes("unreachable") ||
    lower.includes("network error")
  ) {
    return "Failed: Network Error";
  }
  if (lower.includes("aborted") || lower.includes("aborted by user")) {
    return "Aborted";
  }
  return "Failed";
}

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
    case "failed": {
      const briefLabel = formatBriefError(item.errorMessage);
      return (
        <span
          title={item.errorMessage || "Conversion failed"}
          className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300 cursor-help max-w-[190px]"
        >
          <AlertCircle size={11} className="shrink-0" />
          <span className="truncate">{briefLabel}</span>
        </span>
      );
    }
    case "queued":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-400">
          <Clock size={10} /> Queued
        </span>
      );
  }
}
