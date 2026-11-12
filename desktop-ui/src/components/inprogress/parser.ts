import type { Category, ConverterEvent } from "../../bridge";
import type { InProgressBatchSummary, InProgressItem, InProgressItemStatus, MediaKind } from "./types";

// Regex matchers for engine output streams
export const PLAYLIST_ITEM_RE = /^(?:\[\d+%\]\s*)?\[(\d+)\/(\d+)\]\s*(?:(Fetching|Converted|Failed)\s*)?(?:#(\d+):\s*)?(.*)$/i;
export const ADAPTIVE_RETRY_RE = /^(?:\[\d+%\]\s*)?\[Adaptive Recovery\]\s*Retrying\s*#(\d+):\s*(.*?)(?:\s+via alternate audio paths\.{0,3})?$/i;
export const ADAPTIVE_FAILED_RE = /\[\!\]\s*Adaptive Pass:\s*Track\s*#(\d+)\s*'(.*?)'\s*could not be resolved:\s*(.*)/i;
export const CONVERTED_RE = /\[\+\]\s*(?:Adapted & )?(?:Converted|Saved photo):\s*(?:(\d+)\.\s*)?(.*)/i;
export const READY_RE = /Ready:\s*(?:(\d+)\.\s*)?(.*)/i;
export const ERROR_RE = /\[\!\]\s*Error converting track\s*#(\d+)\s*'(.*?)':\s*(.*)/i;
export const REQUEUE_RE = /\[\*\]\s*Requeuing\s*(?:track\s*)?#(\d+)/i;
export const PLAYLIST_HEADER_RE = /(?:Playlist:\s*(.*)|\[\*\]\s*Found\s*(\d+)\s*tracks\s*in\s*'(.*?)')/i;
export const PHOTO_ALBUM_HEADER_RE = /Found\s*(\d+)\s*photos\s*in\s*['"]?(.*?)['"]?\.\s*Starting/i;
export const PHOTO_PROGRESS_RE = /Downloading\s*(?:Facebook|Instagram|Pinterest|social)?\s*photo\s*(\d+)\s*of\s*(\d+)/i;
export const PHOTO_COMPLETED_RE = /(?:Downloaded|Saved)\s*(?:all\s*)?(\d+)\s*(?:public\s*)?(?:Facebook|Instagram|Pinterest)?\s*photo/i;
export const COVER_ART_RE = /\[\*\]\s*Playlist Cover Art:\s*(.*)/i;
export const TRACK_MANIFEST_RE = /\[\*\]\s*Track\s*#(\d+)\s*Manifest:\s*(.*?)(?:\t(.*?))?(?:\t(.*?))?(?:\t(.*?))?$/i;
export const TRACK_THUMBNAIL_RE = /\[\*\]\s*Track\s*#(\d+)\s*(?:Thumbnail|Source):\s*(.*)/i;
export const TRACK_COVER_RE = /\[\*\]\s*Track\s*#(\d+)\s*Cover:\s*(.*)/i;
export const PHOTO_SOURCE_RE = /\[\*\]\s*Photo\s*#(\d+)\s*Source:\s*(.*)/i;
export const PHOTO_SAVED_RE = /\[\*\]\s*Photo\s*#(\d+)\s*Saved:\s*(.*)/i;
export const MEDIA_THUMBNAIL_RE = /\[\*\]\s*Media\s*Thumbnail(?:\s*URL)?:\s*(.*)/i;
export const TARGET_DIR_RE = /(?:Target Directory:\s*(.*)|Export Directory:\s*(.*)|DONE! Exported:\s*(.*))/i;
export const SINGLE_READY_RE = /(?:Ready!\s*File exported to:\s*(.*)|DONE!\s*Exported:\s*(.*))/i;

const KNOWN_DETAIL_PREFIX_RE = /^(?:ready:|recovered from\s|3d model ready:|transcoding\b|preserve quality fallback:|\[download\]|downloading\b|fetching\b|evaluating search candidate|connecting to media\b|parsing media\b|verifying media\b|synchronizing with media\b|stream link established|archival stream|reading facebook\b|copying\b|remuxing\b|extracting\b|normalizing\b|analyzing\b|\d+(?:\.\d+)?%)/i;

type PlaylistActionKind = "fetching" | "converted" | "failed" | null;
type PlaylistDetailPhase = "ready" | "transcoding" | "downloading";

interface ParsedPlaylistLine {
  totalIdx: number;
  trackIdx: number;
  action: PlaylistActionKind;
  title: string;
  detail: string;
}

function splitPlaylistTitleAndDetail(body: string): { title: string; detail: string } {
  const sepRe = /\s+—\s+/g;
  const matches: Array<{ index: number; length: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = sepRe.exec(body)) !== null) {
    matches.push({ index: m.index, length: m[0].length });
  }
  if (matches.length > 0) {
    // Prefer the earliest em-dash separator whose right-hand side starts with a known engine status phrase
    // so titles containing " — " (including inside "Ready: 1. Artist — Song.mp3") stay intact.
    for (const candidate of matches) {
      const rhs = body.slice(candidate.index + candidate.length).trim();
      if (KNOWN_DETAIL_PREFIX_RE.test(rhs)) {
        return {
          title: body.slice(0, candidate.index).replace(/\.{3}$/, "").trim(),
          detail: rhs,
        };
      }
    }
    const last = matches[matches.length - 1];
    return {
      title: body.slice(0, last.index).replace(/\.{3}$/, "").trim(),
      detail: body.slice(last.index + last.length).trim(),
    };
  }
  const pctOnlyMatch = /^(.*?)\s*\((\d+(?:\.\d+)?)%\)$/.exec(body);
  if (pctOnlyMatch) {
    return {
      title: pctOnlyMatch[1].replace(/\.{3}$/, "").trim(),
      detail: `${pctOnlyMatch[2]}%`,
    };
  }
  return {
    title: body.replace(/\.{3}$/, "").trim(),
    detail: "",
  };
}

function parsePlaylistProgressLine(rawMsg: string): ParsedPlaylistLine | null {
  const m = PLAYLIST_ITEM_RE.exec(rawMsg);
  if (!m) return null;
  const doneIdx = parseInt(m[1], 10);
  const totalIdx = parseInt(m[2], 10);
  const action = m[3] ? (m[3].toLowerCase() as Exclude<PlaylistActionKind, null>) : null;
  const explicitTrackIdx = m[4] ? parseInt(m[4], 10) : undefined;
  const body = (m[5] || "").trim();

  if (action) {
    if (explicitTrackIdx === undefined || Number.isNaN(explicitTrackIdx)) return null;
    return {
      totalIdx,
      trackIdx: explicitTrackIdx,
      action,
      title: body.replace(/\.{3}$/, "").trim(),
      detail: "",
    };
  }

  const { title, detail } = splitPlaylistTitleAndDetail(body);
  if (explicitTrackIdx === undefined && !detail) {
    return null;
  }

  return {
    totalIdx,
    trackIdx: explicitTrackIdx ?? doneIdx,
    action: null,
    title,
    detail,
  };
}

function classifyPlaylistDetail(detail: string): PlaylistDetailPhase {
  const lower = detail.trim().toLowerCase();
  if (
    lower === "ready" ||
    lower === "converted" ||
    lower.startsWith("ready:") ||
    lower.startsWith("recovered from ") ||
    lower.startsWith("3d model ready:")
  ) {
    return "ready";
  }
  if (lower.startsWith("transcoding") || lower.startsWith("preserve quality fallback:") || /\btranscoding\b/i.test(lower)) {
    return "transcoding";
  }
  return "downloading";
}

export function extractYouTubeThumbnail(urlOrId?: string): string | undefined {
  if (!urlOrId) return undefined;
  const trimmed = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://i.ytimg.com/vi/${trimmed}/hqdefault.jpg`;
  }
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  if (match) {
    return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
  }
  return undefined;
}

export function extractYouTubeUrlFromThumbnail(thumbOrUrl?: string): string | undefined {
  if (!thumbOrUrl) return undefined;
  const match = thumbOrUrl.match(/\/vi\/([\w-]{11})\//i);
  if (match) {
    return `https://www.youtube.com/watch?v=${match[1]}`;
  }
  const idMatch = thumbOrUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  if (idMatch) {
    return `https://www.youtube.com/watch?v=${idMatch[1]}`;
  }
  return undefined;
}

export function inferMediaKind(category?: Category, format?: string, filename?: string): MediaKind {
  const target = `${category || ""} ${format || ""} ${filename || ""}`.toLowerCase();
  if (target.includes("video") || target.includes("mp4") || target.includes("mkv") || target.includes("webm") || target.includes("mov")) {
    return "video";
  }
  if (target.includes("image") || target.includes("png") || target.includes("jpg") || target.includes("jpeg") || target.includes("webp") || target.includes("photo")) {
    return "image";
  }
  return "audio";
}

function getTransientProgressSignature(event: ConverterEvent): string | null {
  if (event.kind !== "progress") return null;
  const rawMsg = event.message.trim();
  if (
    !rawMsg ||
    rawMsg.startsWith("[+]") ||
    rawMsg.startsWith("[*]") ||
    rawMsg.startsWith("[!]") ||
    rawMsg.startsWith("===") ||
    rawMsg.startsWith("PLAYLIST") ||
    rawMsg.startsWith("DONE!") ||
    rawMsg.startsWith("Ready") ||
    rawMsg.startsWith("Target Directory:") ||
    rawMsg.startsWith("Export Directory:")
  ) {
    return null;
  }
  const parsed = parsePlaylistProgressLine(rawMsg);
  if (parsed) {
    if (parsed.action === "converted" || parsed.action === "failed") return null;
    if (parsed.action === "fetching") return `${event.jobId}:track:${parsed.trackIdx}:download`;
    const phase = classifyPlaylistDetail(parsed.detail);
    if (phase === "ready") return null;
    if (phase === "transcoding") return `${event.jobId}:track:${parsed.trackIdx}:transcode`;
    return `${event.jobId}:track:${parsed.trackIdx}:download`;
  }
  if (rawMsg.includes("[download]") || rawMsg.includes("Downloading stream:")) {
    return `${event.jobId}:single:download`;
  }
  if (rawMsg.startsWith("Transcoding ") || rawMsg.includes("Transcoding ")) {
    return `${event.jobId}:single:transcode`;
  }
  return null;
}

export function appendOrCollapseProgressEvent(
  current: ConverterEvent[],
  next: ConverterEvent,
  maxLen = 10000,
): ConverterEvent[] {
  if (current.length > 0) {
    const prev = current[current.length - 1];
    if (prev.jobId === next.jobId) {
      const prevSig = getTransientProgressSignature(prev);
      if (prevSig && prevSig === getTransientProgressSignature(next)) {
        const copy = current.slice(-(maxLen));
        copy[copy.length - 1] = next;
        return copy;
      }
    }
  }
  return [...current.slice(-(maxLen - 1)), next];
}

export function extractDistinctJobIds(
  events: ConverterEvent[],
  jobId?: string | null,
  running?: boolean,
  category?: Category,
  format?: string,
): string[] {
  const rawIds: string[] = [];
  const grouped = new Map<string, ConverterEvent[]>();
  for (const evt of events) {
    if (evt.jobId && evt.jobId !== "ui" && evt.jobId !== "browser-session") {
      let bucket = grouped.get(evt.jobId);
      if (!bucket) {
        bucket = [];
        grouped.set(evt.jobId, bucket);
        rawIds.push(evt.jobId);
      }
      bucket.push(evt);
    }
  }
  if (jobId && jobId !== "ui" && jobId !== "browser-session" && !grouped.has(jobId)) {
    rawIds.push(jobId);
  }
  return rawIds.filter((id) => {
    if (running && jobId && id === jobId) return true;
    const jobEvents = grouped.get(id);
    if (!jobEvents?.length) return false;
    const parsed = parseConversionEvents(jobEvents, category, format, undefined, id, false);
    return parsed.items.length > 0;
  });
}

export function parseConversionEvents(
  events: ConverterEvent[],
  defaultCategory?: Category,
  defaultFormat?: string,
  initialSource?: string,
  targetJobId?: string,
  isRunning = false,
): { items: InProgressItem[]; summary: InProgressBatchSummary; latestLogLine: string } {
  // 1. Filter events by active job so multiple jobs never mix together
  let scopedEvents: ConverterEvent[];
  if (targetJobId) {
    scopedEvents = events.filter((e) => e.jobId === targetJobId);
  } else {
    const jobEvents = events.filter((e) => e.jobId && e.jobId !== "ui" && e.jobId !== "browser-session");
    if (jobEvents.length > 0) {
      const lastJobId = jobEvents[jobEvents.length - 1].jobId;
      scopedEvents = jobEvents.filter((e) => e.jobId === lastJobId);
    } else {
      scopedEvents = [];
    }
  }

  let detectedTitle = initialSource || "";
  let detectedTotal = 0;
  let detectedOutputDir = "";
  let detectedCoverArt: string | undefined;
  let detectedKind: MediaKind = inferMediaKind(defaultCategory, defaultFormat, initialSource);
  const itemsMap = new Map<number, InProgressItem>();
  let latestLogLine = "";

  // Single file fallback state
  let isSingleMedia = false;
  let singleTitle = initialSource || "Media file";
  let singleThumbnail: string | undefined = extractYouTubeThumbnail(initialSource);
  let singleProgress = 0;
  let singleStatus: InProgressItemStatus = "downloading";
  let singleSpeed: string | undefined;
  let singleEta: string | undefined;
  let singleDetail = "";
  let singleError: string | undefined;
  let singleOutputPath: string | undefined;

  for (const event of scopedEvents) {
    const rawMsg = event.message.trim();
    if (!rawMsg) continue;
    latestLogLine = rawMsg;

    // 1. Detect target directory: Target Directory: <path> or Export Directory: <path> or DONE! Exported: <path>
    const dirMatch = TARGET_DIR_RE.exec(rawMsg);
    if (dirMatch) {
      const matched = (dirMatch[1] || dirMatch[2] || dirMatch[3] || "").trim();
      if (matched) {
        if (/\.[a-zA-Z0-9]{2,5}$/.test(matched)) {
          const idx = Math.max(matched.lastIndexOf("\\"), matched.lastIndexOf("/"));
          detectedOutputDir = idx > 0 ? matched.slice(0, idx) : matched;
        } else {
          detectedOutputDir = matched;
        }
      }
    }

    // 2. Detect cover art and manifest tags
    const coverMatch = COVER_ART_RE.exec(rawMsg);
    if (coverMatch) {
      detectedCoverArt = coverMatch[1].trim();
    }

    const manifestMatch = TRACK_MANIFEST_RE.exec(rawMsg);
    if (manifestMatch) {
      const mIdx = parseInt(manifestMatch[1], 10);
      const mTitle = (manifestMatch[2] || "").trim();
      const mArtist = (manifestMatch[3] || "").trim();
      const mThumb = (manifestMatch[4] || "").trim();
      const mUrl = (manifestMatch[5] || "").trim();
      if (mIdx > detectedTotal) detectedTotal = mIdx;
      let item = itemsMap.get(mIdx);
      if (!item) {
        item = {
          id: `item-${mIdx}`,
          index: mIdx,
          total: detectedTotal || mIdx,
          title: mTitle || `Track #${mIdx}`,
          artist: mArtist || undefined,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, mTitle),
          status: "queued",
          progress: 0,
          thumbnail: mThumb || undefined,
          url: mUrl || extractYouTubeUrlFromThumbnail(mThumb) || undefined,
        };
        itemsMap.set(mIdx, item);
      } else {
        if (mTitle) item.title = mTitle;
        if (mArtist) item.artist = mArtist;
        if (mThumb) item.thumbnail = mThumb;
        if (mUrl) item.url = mUrl;
        else if (!item.url && mThumb) item.url = extractYouTubeUrlFromThumbnail(mThumb);
      }
      continue;
    }

    const photoSrcMatch = PHOTO_SOURCE_RE.exec(rawMsg);
    if (photoSrcMatch) {
      const pIdx = parseInt(photoSrcMatch[1], 10);
      const pUrl = photoSrcMatch[2].trim();
      if (pIdx > detectedTotal) detectedTotal = pIdx;
      detectedKind = "image";
      let item = itemsMap.get(pIdx);
      if (!item) {
        item = {
          id: `item-${pIdx}`,
          index: pIdx,
          total: detectedTotal || pIdx,
          title: `Photo #${pIdx}`,
          mediaKind: "image",
          status: "queued",
          progress: 0,
          thumbnail: pUrl,
          url: pUrl,
        };
        itemsMap.set(pIdx, item);
      } else {
        item.thumbnail = pUrl;
        item.url = pUrl;
      }
      continue;
    }

    const photoSavedMatch = PHOTO_SAVED_RE.exec(rawMsg);
    if (photoSavedMatch) {
      const pIdx = parseInt(photoSavedMatch[1], 10);
      const pPath = photoSavedMatch[2].trim();
      let item = itemsMap.get(pIdx);
      if (!item) {
        item = {
          id: `item-${pIdx}`,
          index: pIdx,
          total: detectedTotal || pIdx,
          title: `Photo #${pIdx}`,
          mediaKind: "image",
          status: "ready",
          progress: 1,
          coverPath: pPath,
          outputPath: pPath,
        };
        itemsMap.set(pIdx, item);
      } else {
        item.coverPath = pPath;
        item.outputPath = pPath;
        item.status = "ready";
        item.progress = 1;
      }
      continue;
    }

    const trackThumbMatch = TRACK_THUMBNAIL_RE.exec(rawMsg);
    if (trackThumbMatch) {
      const tIdx = parseInt(trackThumbMatch[1], 10);
      const tThumb = trackThumbMatch[2].trim();
      let item = itemsMap.get(tIdx);
      if (item) {
        item.thumbnail = tThumb;
      }
      continue;
    }

    const mediaThumbMatch = MEDIA_THUMBNAIL_RE.exec(rawMsg);
    if (mediaThumbMatch) {
      const mThumb = mediaThumbMatch[1].trim();
      if (mThumb) {
        singleThumbnail = mThumb;
        if (!detectedCoverArt) detectedCoverArt = mThumb;
      }
      continue;
    }

    const trackCoverMatch = TRACK_COVER_RE.exec(rawMsg);
    if (trackCoverMatch) {
      const tIdx = parseInt(trackCoverMatch[1], 10);
      const tPath = trackCoverMatch[2].trim();
      let item = itemsMap.get(tIdx);
      if (item) {
        item.coverPath = tPath;
      }
      continue;
    }

    // 3. Detect playlist header: Playlist: <title> or Found <n> tracks in '<title>'
    const headerMatch = PLAYLIST_HEADER_RE.exec(rawMsg);
    if (headerMatch) {
      if (headerMatch[1]) detectedTitle = headerMatch[1].trim();
      if (headerMatch[2] && headerMatch[3]) {
        detectedTotal = parseInt(headerMatch[2], 10);
        detectedTitle = headerMatch[3].trim();
      }
    }

    // 4. Detect Facebook or Social Photo Album header: Found <n> photos in '<title>'. Starting download...
    const photoHeaderMatch = PHOTO_ALBUM_HEADER_RE.exec(rawMsg);
    if (photoHeaderMatch) {
      detectedTotal = parseInt(photoHeaderMatch[1], 10);
      if (photoHeaderMatch[2]) detectedTitle = photoHeaderMatch[2].trim();
      detectedKind = "image";
    }

    // 5. Match Facebook/Social Photo progress: Downloading Facebook photo 1 of 12...
    const photoProgMatch = PHOTO_PROGRESS_RE.exec(rawMsg);
    if (photoProgMatch) {
      const totPhoto = parseInt(photoProgMatch[2], 10);
      if (totPhoto > detectedTotal) detectedTotal = totPhoto;
      detectedKind = "image";

      // Mark queued items as downloading during active transfer
      for (const it of itemsMap.values()) {
        if (it.status === "queued") {
          it.status = "downloading";
          it.progress = 0.5;
          it.detailMessage = rawMsg;
        }
      }
      continue;
    }

    // 6. Match photo album completion: Downloaded all 12 public Facebook photos.
    const photoDoneMatch = PHOTO_COMPLETED_RE.exec(rawMsg);
    if (photoDoneMatch) {
      const doneCount = parseInt(photoDoneMatch[1], 10);
      if (doneCount > detectedTotal) detectedTotal = doneCount;
      detectedKind = "image";
      for (let p = 1; p <= doneCount; p++) {
        let it = itemsMap.get(p);
        if (!it) {
          itemsMap.set(p, {
            id: `item-${p}`,
            index: p,
            total: doneCount,
            title: `Photo #${p}`,
            mediaKind: "image",
            status: "ready",
            progress: 1,
          });
        } else if (it.status !== "failed") {
          it.status = "ready";
          it.progress = 1;
        }
      }
      continue;
    }

    // 7. Match converted item: e.g. [+] Converted: 35. Runaway with Peace (feat. Caylune).mp3
    const convMatch = CONVERTED_RE.exec(rawMsg);
    if (convMatch) {
      const rawConverted = rawMsg.replace(/^\[\+\]\s*(?:Adapted & )?(?:Converted|Saved photo):\s*/i, "").trim();
      const idx = convMatch[1] ? parseInt(convMatch[1], 10) : undefined;
      const cleanTitle = convMatch[2].trim();
      const actualFile = rawConverted || (idx !== undefined ? `${idx}. ${cleanTitle}` : cleanTitle);
      if (idx !== undefined) {
        let item = itemsMap.get(idx);
        const isPhoto = detectedKind === "image" || rawMsg.toLowerCase().includes("saved photo");
        if (!item) {
          item = {
            id: `item-${idx}`,
            index: idx,
            total: detectedTotal || idx,
            title: isPhoto ? `Photo #${idx}` : cleanTitle.replace(/\.[a-zA-Z0-9]+$/, ""),
            mediaKind: inferMediaKind(defaultCategory, defaultFormat, actualFile),
            status: "ready",
            progress: 1,
            outputPath: actualFile,
          };
          itemsMap.set(idx, item);
        } else {
          item.status = "ready";
          item.progress = 1;
          item.speed = undefined;
          item.eta = undefined;
          item.outputPath = actualFile;
          if (!isPhoto && (!item.title || item.title.startsWith("Track #"))) {
            item.title = cleanTitle.replace(/\.[a-zA-Z0-9]+$/, "");
          }
        }
      } else {
        isSingleMedia = true;
        singleTitle = cleanTitle.replace(/\.[a-zA-Z0-9]+$/, "");
        singleStatus = "ready";
        singleProgress = 1;
        singleSpeed = undefined;
        singleEta = undefined;
        if (!singleOutputPath) {
          singleOutputPath = actualFile;
        }
      }
      continue;
    }

    // 7.5 Match requeue: e.g. [*] Requeuing track #13 as next conversion: Can't Understand
    const reqMatch = REQUEUE_RE.exec(rawMsg);
    if (reqMatch) {
      const reqIdx = parseInt(reqMatch[1], 10);
      const item = itemsMap.get(reqIdx);
      if (item) {
        item.status = "queued";
        item.errorMessage = undefined;
        item.progress = 0;
        item.speed = undefined;
        item.eta = undefined;
        item.detailMessage = undefined;
      }
      continue;
    }

    // 8. Match error: e.g. [!] Error converting track #35 'Runaway with Peace': <error>
    const errMatch = ERROR_RE.exec(rawMsg);
    if (errMatch) {
      const errIdx = parseInt(errMatch[1], 10);
      const errTitle = errMatch[2];
      const errDetail = errMatch[3];
      let item = itemsMap.get(errIdx);
      if (!item) {
        item = {
          id: `item-${errIdx}`,
          index: errIdx,
          total: detectedTotal || errIdx,
          title: errTitle || `Track #${errIdx}`,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, errTitle),
          status: "failed",
          progress: 0,
          errorMessage: errDetail,
        };
        itemsMap.set(errIdx, item);
      } else {
        item.status = "failed";
        item.errorMessage = errDetail;
        item.speed = undefined;
        item.eta = undefined;
      }
      continue;
    }

    // 8.5 Match Adaptive Pass error: e.g. [!] Adaptive Pass: Track #13 'Title' could not be resolved: <error>
    const adaptiveErrMatch = ADAPTIVE_FAILED_RE.exec(rawMsg);
    if (adaptiveErrMatch) {
      const errIdx = parseInt(adaptiveErrMatch[1], 10);
      const errTitle = adaptiveErrMatch[2];
      const errDetail = adaptiveErrMatch[3];
      let item = itemsMap.get(errIdx);
      if (!item) {
        item = {
          id: `item-${errIdx}`,
          index: errIdx,
          total: detectedTotal || errIdx,
          title: errTitle || `Track #${errIdx}`,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, errTitle),
          status: "failed",
          progress: 0,
          errorMessage: errDetail,
        };
        itemsMap.set(errIdx, item);
      } else {
        item.status = "failed";
        item.errorMessage = errDetail;
        item.speed = undefined;
        item.eta = undefined;
      }
      continue;
    }

    // 8.75 Match Adaptive Recovery retry: [Adaptive Recovery] Retrying #13: <title> via alternate audio paths...
    const adaptiveRetryMatch = ADAPTIVE_RETRY_RE.exec(rawMsg);
    if (adaptiveRetryMatch) {
      const retryIdx = parseInt(adaptiveRetryMatch[1], 10);
      const retryTitle = (adaptiveRetryMatch[2] || "").trim();
      let item = itemsMap.get(retryIdx);
      if (!item) {
        item = {
          id: `item-${retryIdx}`,
          index: retryIdx,
          total: detectedTotal || retryIdx,
          title: retryTitle || `Track #${retryIdx}`,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, retryTitle),
          status: "downloading",
          progress: 0.05,
          detailMessage: "Retrying via alternate audio paths...",
        };
        itemsMap.set(retryIdx, item);
      } else {
        item.status = "downloading";
        item.errorMessage = undefined;
        item.progress = Math.max(item.progress, 0.05);
        item.speed = undefined;
        item.eta = undefined;
        item.detailMessage = "Retrying via alternate audio paths...";
        if (retryTitle && (!item.title || item.title.startsWith("Track #"))) {
          item.title = retryTitle;
        }
      }
      continue;
    }

    // 9. Match playlist track item log: e.g. [35/47] #35: Runaway with Peace (feat. Caylune) — Transcoding MP3: 70% (speed 90.3x)
    const parsedLine = parsePlaylistProgressLine(rawMsg);
    if (parsedLine) {
      const { totalIdx, trackIdx, action, title: rawTitle, detail } = parsedLine;
      if (totalIdx > detectedTotal) detectedTotal = totalIdx;

      let item = itemsMap.get(trackIdx);
      if (!item) {
        const initialStatus: InProgressItemStatus =
          action === "converted" ? "ready" : action === "failed" ? "failed" : "downloading";
        item = {
          id: `item-${trackIdx}`,
          index: trackIdx,
          total: totalIdx,
          title: rawTitle || `Track #${trackIdx}`,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, rawTitle),
          status: initialStatus,
          progress: initialStatus === "ready" ? 1 : initialStatus === "failed" ? 0 : 0.05,
        };
        itemsMap.set(trackIdx, item);
      } else if (rawTitle && (!item.title || item.title.startsWith("Track #"))) {
        item.title = rawTitle;
      }

      if (action === "converted") {
        item.status = "ready";
        item.progress = 1;
        item.speed = undefined;
        item.eta = undefined;
        item.detailMessage = undefined;
        continue;
      }

      if (action === "failed") {
        item.status = "failed";
        item.speed = undefined;
        item.eta = undefined;
        item.detailMessage = undefined;
        continue;
      }

      if (action === "fetching") {
        if (item.status !== "ready") {
          item.status = "downloading";
          item.progress = Math.max(item.progress, 0.05);
          if (item.speed && item.speed.endsWith("x")) {
            item.speed = undefined;
          }
          item.eta = undefined;
          item.detailMessage = "Fetching media stream...";
        }
        continue;
      }

      if (item.status === "ready") {
        continue;
      }

      const phase = classifyPlaylistDetail(detail);
      if (detail) {
        item.detailMessage = detail;
      }

      const pctMatch = /(\d+(?:\.\d+)?)\s*%/i.exec(detail);
      const parsedPct = pctMatch ? parseFloat(pctMatch[1]) / 100 : undefined;

      if (phase === "ready") {
        item.status = "ready";
        item.progress = 1;
        item.speed = undefined;
        item.eta = undefined;
        const readyFileMatch = /^Ready:\s*(.+)$/i.exec(detail);
        if (readyFileMatch && !item.outputPath) {
          item.outputPath = readyFileMatch[1].trim();
        }
      } else if (phase === "transcoding") {
        item.status = "transcoding";
        const spdMatch = /speed\s+([\d\.]+x)/i.exec(detail);
        if (spdMatch) {
          item.speed = spdMatch[1];
        } else if (item.speed && !item.speed.endsWith("x")) {
          item.speed = undefined;
        }
        item.eta = undefined;
        if (parsedPct !== undefined) item.progress = Math.max(item.progress, parsedPct);
      } else {
        item.status = "downloading";
        const spdMatch = /at\s+([\d\.]+\s*[KMGT]?i?B\/s)/i.exec(detail);
        if (spdMatch) {
          item.speed = spdMatch[1];
        } else if (item.speed && item.speed.endsWith("x")) {
          item.speed = undefined;
        }
        const etaMatch = /ETA\s+([\d:]+)/i.exec(detail);
        if (etaMatch) item.eta = etaMatch[1];
        item.progress = parsedPct !== undefined ? parsedPct : Math.max(item.progress, 0.05);
      }
      continue;
    }

    // 10. Match standalone Ready: e.g. Ready: 9. am.mp3
    const readyMatch = READY_RE.exec(rawMsg);
    if (readyMatch) {
      const rawReady = rawMsg.replace(/^Ready:\s*/i, "").trim();
      const idx = readyMatch[1] ? parseInt(readyMatch[1], 10) : undefined;
      const cleanTitle = (readyMatch[2] || "").trim();
      const actualFile = rawReady || (idx !== undefined ? `${idx}. ${cleanTitle}` : cleanTitle);
      const item = idx !== undefined ? itemsMap.get(idx) : undefined;
      if (item) {
        item.status = "ready";
        item.progress = 1;
        item.speed = undefined;
        item.eta = undefined;
        if (!item.outputPath) {
          item.outputPath = actualFile;
        }
      } else if (itemsMap.size === 0) {
        isSingleMedia = true;
        singleStatus = "ready";
        singleProgress = 1;
        singleSpeed = undefined;
        singleEta = undefined;
        if (!singleOutputPath) {
          singleOutputPath = actualFile;
        }
      }
      continue;
    }

    // 11. Single file progress heuristics (when not in a batch)
    if (itemsMap.size === 0) {
      const singleReadyMatch = SINGLE_READY_RE.exec(rawMsg);
      if (singleReadyMatch) {
        const exportedTarget = (singleReadyMatch[1] || singleReadyMatch[2] || "").trim();
        isSingleMedia = true;
        singleStatus = "ready";
        singleProgress = 1;
        singleSpeed = undefined;
        singleEta = undefined;
        if (exportedTarget) {
          singleOutputPath = exportedTarget;
          const fname = exportedTarget.split(/[\\/]/).pop() || "";
          if (fname) {
            singleTitle = fname.replace(/\.[a-zA-Z0-9]+$/, "");
          }
        }
      } else if (rawMsg.includes("[download]") || rawMsg.includes("Downloading stream:")) {
        isSingleMedia = true;
        singleStatus = "downloading";
        const pctMatch = /(\d+(?:\.\d+)?)\s*%/i.exec(rawMsg);
        if (pctMatch) singleProgress = parseFloat(pctMatch[1]) / 100;
        const spdMatch = /at\s+([\d\.]+\s*[KMGT]?i?B\/s)/i.exec(rawMsg);
        if (spdMatch) {
          singleSpeed = spdMatch[1];
        } else if (singleSpeed && singleSpeed.endsWith("x")) {
          singleSpeed = undefined;
        }
        const etaMatch = /ETA\s+([\d:]+)/i.exec(rawMsg);
        if (etaMatch) singleEta = etaMatch[1];
        singleDetail = rawMsg;
      } else if (rawMsg.includes("Transcoding ")) {
        isSingleMedia = true;
        singleStatus = "transcoding";
        const pctMatch = /(\d+(?:\.\d+)?)\s*%/i.exec(rawMsg);
        if (pctMatch) singleProgress = parseFloat(pctMatch[1]) / 100;
        const spdMatch = /speed\s+([\d\.]+x)/i.exec(rawMsg);
        if (spdMatch) {
          singleSpeed = spdMatch[1];
        } else if (!singleSpeed || !singleSpeed.endsWith("x")) {
          singleSpeed = undefined;
        }
        singleEta = undefined;
        singleDetail = rawMsg;
      } else if (rawMsg.startsWith("[!] Error") || event.kind === "failed") {
        isSingleMedia = true;
        singleStatus = "failed";
        singleSpeed = undefined;
        singleEta = undefined;
        singleError = rawMsg;
      }
    }

    if (event.kind === "finished") {
      if (itemsMap.size === 0) {
        isSingleMedia = true;
        if (singleStatus !== "failed") {
          singleStatus = "ready";
          singleProgress = 1;
        }
        singleSpeed = undefined;
        singleEta = undefined;
        if (event.output) {
          singleOutputPath = event.output;
          const fname = event.output.split(/[\\/]/).pop() || "";
          if (fname) {
            singleTitle = fname.replace(/\.[a-zA-Z0-9]+$/, "");
          }
        }
      } else {
        for (const item of itemsMap.values()) {
          if (item.status === "downloading" || item.status === "transcoding") {
            item.status = "ready";
            item.progress = 1;
            item.speed = undefined;
            item.eta = undefined;
          }
        }
      }
    }
  }

  // Build items array
  let items: InProgressItem[] = [];

  if (itemsMap.size > 0) {
    const maxIdx = Math.max(detectedTotal, ...Array.from(itemsMap.keys()));
    for (let i = 1; i <= maxIdx; i++) {
      const existing = itemsMap.get(i);
      if (existing) {
        items.push(existing);
      } else {
        items.push({
          id: `item-${i}`,
          index: i,
          total: maxIdx,
          title: detectedKind === "image" ? `Photo #${i}` : `Track #${i}`,
          mediaKind: detectedKind,
          status: "queued",
          progress: 0,
        });
      }
    }
    items.sort((a, b) => a.index - b.index);
  } else if (
    isSingleMedia ||
    (Boolean(initialSource) && Boolean(targetJobId) && targetJobId !== "ui" && targetJobId !== "browser-session" && isRunning)
  ) {
    items = [
      {
        id: "single-item-1",
        index: 1,
        total: 1,
        title: singleTitle || detectedTitle || "Media file",
        url: initialSource || undefined,
        mediaKind: inferMediaKind(defaultCategory, defaultFormat, singleOutputPath || singleTitle),
        status: singleStatus,
        progress: singleProgress,
        speed: singleSpeed,
        eta: singleEta,
        detailMessage: singleDetail,
        coverPath: detectedCoverArt,
        thumbnail: singleThumbnail || extractYouTubeThumbnail(initialSource),
        errorMessage: singleError,
        outputPath: singleOutputPath,
      },
    ];
  }

  // Calculate summary counts
  const total = items.length;
  const completed = items.filter((it) => it.status === "ready").length;
  const active = items.filter((it) => it.status === "downloading" || it.status === "transcoding").length;
  const failed = items.filter((it) => it.status === "failed").length;
  const queued = items.filter((it) => it.status === "queued").length;

  let overallProgress = 0;
  if (total > 0) {
    const sum = items.reduce((acc, it) => acc + (it.status === "ready" ? 1 : it.progress), 0);
    overallProgress = Math.min(1, Math.max(0, sum / total));
  }

  const primaryKind = items[0]?.mediaKind || detectedKind;

  return {
    items,
    summary: {
      title: total === 1 && items[0]?.title
        ? items[0].title
        : (detectedTitle || (total > 1 ? (primaryKind === "image" ? "Photo Album" : "Batch Conversion") : "Media Conversion")),
      total,
      completed,
      active,
      failed,
      queued,
      overallProgress,
      mediaKind: primaryKind,
      format: defaultFormat,
      outputDir: detectedOutputDir,
      coverArtPath: detectedCoverArt,
    },
    latestLogLine,
  };
}
