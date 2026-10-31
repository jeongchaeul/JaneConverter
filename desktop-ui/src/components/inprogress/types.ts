import type { Category } from "../../bridge";

export type MediaKind = "audio" | "video" | "image";
export type InProgressItemStatus = "queued" | "downloading" | "transcoding" | "ready" | "failed";

export interface InProgressItem {
  id: string;
  index: number;
  total: number;
  title: string;
  artist?: string;
  mediaKind: MediaKind;
  status: InProgressItemStatus;
  progress: number; // 0 to 1
  speed?: string;
  eta?: string;
  detailMessage?: string;
  outputPath?: string;
  coverPath?: string;
  thumbnail?: string;
  errorMessage?: string;
  elapsedMs?: number;
}

export interface InProgressBatchSummary {
  title: string;
  total: number;
  completed: number;
  active: number;
  failed: number;
  queued: number;
  overallProgress: number;
  mediaKind: MediaKind;
  format?: string;
  outputDir?: string;
  coverArtPath?: string;
}

export interface SessionSummary {
  id: string;
  sessionNumber: number;
  title: string;
  total: number;
  completed: number;
  failed: number;
  active: number;
  mediaKind: MediaKind;
  format?: string;
  isLive: boolean;
  isCurrent: boolean;
  overallProgress: number;
  elapsedMs?: number;
}
