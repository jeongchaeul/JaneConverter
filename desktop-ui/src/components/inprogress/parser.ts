import type { Category, ConverterEvent } from "../../bridge";
import type { InProgressBatchSummary, InProgressItem, InProgressItemStatus, MediaKind } from "./types";

// Regex matchers for engine output streams
export const PLAYLIST_ITEM_RE = /\[(\d+)\/(\d+)\]\s*(?:(?:#(\d+)|Fetching\s*#(\d+)):\s*)?(.*?)(?:\s*(?:—|-)\s*(.*))?$/;
export const CONVERTED_RE = /\[\+\]\s*(?:Adapted & )?(?:Converted|Saved photo):\s*(?:(\d+)\.\s*)?(.*)/i;
export const READY_RE = /Ready:\s*(?:(\d+)\.\s*)?(.*)/i;
export const ERROR_RE = /\[\!\]\s*Error converting track\s*#(\d+)\s*'(.*?)':\s*(.*)/i;
export const PLAYLIST_HEADER_RE = /(?:Playlist:\s*(.*)|\[\*\]\s*Found\s*(\d+)\s*tracks\s*in\s*'(.*?)')/i;
export const PHOTO_ALBUM_HEADER_RE = /Found\s*(\d+)\s*photos\s*in\s*['"]?(.*?)['"]?\.\s*Starting/i;
export const PHOTO_PROGRESS_RE = /Downloading\s*(?:Facebook|Instagram|Pinterest|social)?\s*photo\s*(\d+)\s*of\s*(\d+)/i;
export const PHOTO_COMPLETED_RE = /(?:Downloaded|Saved)\s*(?:all\s*)?(\d+)\s*(?:public\s*)?(?:Facebook|Instagram|Pinterest)?\s*photo/i;
export const COVER_ART_RE = /\[\*\]\s*Playlist Cover Art:\s*(.*)/i;
export const TRACK_MANIFEST_RE = /\[\*\]\s*Track\s*#(\d+)\s*Manifest:\s*(.*?)(?:\t(.*?))?(?:\t(.*?))?$/i;
export const TRACK_THUMBNAIL_RE = /\[\*\]\s*Track\s*#(\d+)\s*(?:Thumbnail|Source):\s*(.*)/i;
export const TRACK_COVER_RE = /\[\*\]\s*Track\s*#(\d+)\s*Cover:\s*(.*)/i;
export const PHOTO_SOURCE_RE = /\[\*\]\s*Photo\s*#(\d+)\s*Source:\s*(.*)/i;
export const PHOTO_SAVED_RE = /\[\*\]\s*Photo\s*#(\d+)\s*Saved:\s*(.*)/i;
export const MEDIA_THUMBNAIL_RE = /\[\*\]\s*Media\s*Thumbnail(?:\s*URL)?:\s*(.*)/i;
export const TARGET_DIR_RE = /(?:Target Directory:\s*(.*)|Export Directory:\s*(.*)|DONE! Exported:\s*(.*))/i;
export const SINGLE_READY_RE = /(?:Ready!\s*File exported to:\s*(.*)|DONE!\s*Exported:\s*(.*))/i;

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
        };
        itemsMap.set(mIdx, item);
      } else {
        if (mTitle) item.title = mTitle;
        if (mArtist) item.artist = mArtist;
        if (mThumb) item.thumbnail = mThumb;
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
        };
        itemsMap.set(pIdx, item);
      } else {
        item.thumbnail = pUrl;
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
      const curPhoto = parseInt(photoProgMatch[1], 10);
      const totPhoto = parseInt(photoProgMatch[2], 10);
      if (totPhoto > detectedTotal) detectedTotal = totPhoto;
      detectedKind = "image";

      // Mark earlier photos as ready if they haven't failed
      for (let p = 1; p < curPhoto; p++) {
        let prevItem = itemsMap.get(p);
        if (!prevItem) {
          itemsMap.set(p, {
            id: `item-${p}`,
            index: p,
            total: totPhoto,
            title: `Photo #${p}`,
            mediaKind: "image",
            status: "ready",
            progress: 1,
          });
        } else if (prevItem.status !== "failed") {
          prevItem.status = "ready";
          prevItem.progress = 1;
        }
      }

      let curItem = itemsMap.get(curPhoto);
      if (!curItem) {
        curItem = {
          id: `item-${curPhoto}`,
          index: curPhoto,
          total: totPhoto,
          title: `Photo #${curPhoto}`,
          mediaKind: "image",
          status: "downloading",
          progress: 0.5,
          detailMessage: rawMsg,
        };
        itemsMap.set(curPhoto, curItem);
      } else {
        curItem.status = "downloading";
        curItem.progress = 0.5;
        curItem.detailMessage = rawMsg;
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

    // 7. Match playlist track item log: e.g. [35/47] #35: Runaway with Peace (feat. Caylune) — Transcoding MP3: 70% (speed 90.3x)
    const pMatch = PLAYLIST_ITEM_RE.exec(rawMsg);
    if (pMatch) {
      const totalIdx = parseInt(pMatch[2], 10);
      const trackIdx = parseInt(pMatch[3] || pMatch[4] || pMatch[1], 10);
      const rawTitle = (pMatch[5] || "").replace(/\.{3}$/, "").trim();
      const detail = (pMatch[6] || "").trim();

      if (totalIdx > detectedTotal) detectedTotal = totalIdx;

      let item = itemsMap.get(trackIdx);
      if (!item) {
        item = {
          id: `item-${trackIdx}`,
          index: trackIdx,
          total: totalIdx,
          title: rawTitle || `Track #${trackIdx}`,
          mediaKind: inferMediaKind(defaultCategory, defaultFormat, rawTitle),
          status: "downloading",
          progress: 0.05,
        };
        itemsMap.set(trackIdx, item);
      } else if (rawTitle && (!item.title || item.title.startsWith("Track #"))) {
        item.title = rawTitle;
      }

      if (detail) {
        item.detailMessage = detail;
        const speedMatch = /(?:at\s+([\d\.]+\s*[KMGT]?i?B\/s)|speed\s+([\d\.]+x))/i.exec(detail);
        if (speedMatch) item.speed = speedMatch[1] || speedMatch[2];

        const etaMatch = /ETA\s+([\d:]+)/i.exec(detail);
        if (etaMatch) item.eta = etaMatch[1];

        const pctMatch = /(\d+(?:\.\d+)?)\s*%/i.exec(detail);
        const parsedPct = pctMatch ? parseFloat(pctMatch[1]) / 100 : undefined;

        if (detail.toLowerCase().includes("transcoding")) {
          item.status = "transcoding";
          if (parsedPct !== undefined) item.progress = Math.max(item.progress, parsedPct);
        } else if (detail.toLowerCase().includes("download") || detail.toLowerCase().includes("fetching")) {
          item.status = "downloading";
          if (parsedPct !== undefined) item.progress = parsedPct;
        } else if (detail.toLowerCase().includes("ready") || detail.toLowerCase().includes("converted")) {
          item.status = "ready";
          item.progress = 1;
        }
      }
      continue;
    }

    // 8. Match converted item: e.g. [+] Converted: 35. Runaway with Peace (feat. Caylune).mp3
    const convMatch = CONVERTED_RE.exec(rawMsg);
    if (convMatch) {
      const rawConverted = rawMsg.replace(/^\[\+\]\s*(?:Adapted & )?(?:Converted|Saved photo):\s*/i, "").trim();
      const idx = convMatch[1] ? parseInt(convMatch[1], 10) : undefined;
      const cleanTitle = convMatch[2].trim();
      const actualFile = rawConverted || (idx !== undefined ? `${idx}. ${cleanTitle}` : cleanTitle);
      if (idx !== undefined) {
        let item = itemsMap.get(idx);
        if (!item) {
          item = {
            id: `item-${idx}`,
            index: idx,
            total: detectedTotal || idx,
            title: cleanTitle.replace(/\.[a-zA-Z0-9]+$/, ""),
            mediaKind: inferMediaKind(defaultCategory, defaultFormat, actualFile),
            status: "ready",
            progress: 1,
            outputPath: actualFile,
          };
          itemsMap.set(idx, item);
        } else {
          item.status = "ready";
          item.progress = 1;
          item.outputPath = actualFile;
          if (!item.title || item.title.startsWith("Track #")) {
            item.title = cleanTitle.replace(/\.[a-zA-Z0-9]+$/, "");
          }
        }
      } else {
        isSingleMedia = true;
        singleTitle = cleanTitle.replace(/\.[a-zA-Z0-9]+$/, "");
        singleStatus = "ready";
        singleProgress = 1;
        if (!singleOutputPath) {
          singleOutputPath = actualFile;
        }
      }
      continue;
    }

    // 9. Match Ready: e.g. Ready: 9. am.mp3
    const readyMatch = READY_RE.exec(rawMsg);
    if (readyMatch) {
      const rawReady = rawMsg.replace(/^Ready:\s*/i, "").trim();
      const idx = readyMatch[1] ? parseInt(readyMatch[1], 10) : undefined;
      const cleanTitle = (readyMatch[2] || "").trim();
      const actualFile = rawReady || (idx !== undefined ? `${idx}. ${cleanTitle}` : cleanTitle);
      if (idx !== undefined) {
        const item = itemsMap.get(idx);
        if (item) {
          item.status = "ready";
          item.progress = 1;
          if (!item.outputPath) {
            item.outputPath = actualFile;
          }
        }
      } else {
        isSingleMedia = true;
        singleStatus = "ready";
        singleProgress = 1;
        if (!singleOutputPath) {
          singleOutputPath = actualFile;
        }
      }
      continue;
    }

    // 10. Match error: e.g. [!] Error converting track #35 'Runaway with Peace': <error>
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
        if (spdMatch) singleSpeed = spdMatch[1];
        const etaMatch = /ETA\s+([\d:]+)/i.exec(rawMsg);
        if (etaMatch) singleEta = etaMatch[1];
        singleDetail = rawMsg;
      } else if (rawMsg.includes("Transcoding ")) {
        isSingleMedia = true;
        singleStatus = "transcoding";
        const pctMatch = /(\d+(?:\.\d+)?)\s*%/i.exec(rawMsg);
        if (pctMatch) singleProgress = parseFloat(pctMatch[1]) / 100;
        const spdMatch = /speed\s+([\d\.]+x)/i.exec(rawMsg);
        if (spdMatch) singleSpeed = spdMatch[1];
        singleDetail = rawMsg;
      } else if (rawMsg.startsWith("[!] Error") || event.kind === "failed") {
        isSingleMedia = true;
        singleStatus = "failed";
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
