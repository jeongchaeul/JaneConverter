import type { Category } from "./bridge";

export const audioFormats = [
  "mp3", "flac", "wav", "aac", "ogg", "m4a", "opus", "aiff", "aif",
  "alac", "ac3", "mp2", "wma", "caf", "au",
];
export const videoFormats = [
  "mp4", "mkv", "webm", "av1", "mov", "gif", "avi", "flv", "m4v", "ts",
  "m2ts", "mpeg", "mpg", "vob", "3gp", "wmv", "asf",
];
export const imageFormats = [
  "jpg", "jpeg", "jfif", "png", "webp", "bmp", "tif", "tiff", "gif",
  "ico", "tga", "ppm", "pgm", "pbm",
];
export const allFormats = ["source", ...Array.from(new Set([...videoFormats, ...audioFormats, ...imageFormats]))];
export const resolutions = ["original", "4k", "1440p", "1080p", "720p", "480p"];

const AUDIO_INPUT_EXTENSIONS = new Set([
  ...audioFormats, "oga", "m4b", "m4p", "ape", "aifc", "amr", "dts", "mka",
  "mpc", "ra", "ram", "tta", "voc", "wv", "wvc", "8svx", "3ga",
]);
const VIDEO_INPUT_EXTENSIONS = new Set([
  ...videoFormats, "3g2", "asx", "avchd", "divx", "dv", "f4v", "m2v", "mjpg",
  "mjpeg", "mts", "mxf", "ogv", "qt", "rm", "rmvb", "yuv",
]);
const IMAGE_INPUT_EXTENSIONS = new Set([
  ...imageFormats, "apng", "avif", "cur", "dib", "emf", "eps", "exr", "heic",
  "heif", "icns", "j2k", "jp2", "jpe", "jfi", "jif", "jxl", "pcx", "pfm",
  "pic", "psd", "ras", "sgi", "svg", "xbm", "xpm", "qoi",
]);

const VIDEO_QUALITY_LABELS: Record<string, string> = {
  original: "Original bitrate — do not compress / untouched",
  best: "Highest quality / least compression",
  high: "High quality / light compression",
  balanced: "Balanced quality / recommended",
  small: "Smaller file / more compression / less detail",
};

export const videoAudioBitrates = ["original", "320k", "256k", "192k", "128k", "96k"];

const VIDEO_AUDIO_BITRATE_LABELS: Record<string, string> = {
  original: "Original — untouched audio bitrate",
  "320k": "320 kbps (Studio High)",
  "256k": "256 kbps (High)",
  "192k": "192 kbps (Standard)",
  "128k": "128 kbps (Compact)",
  "96k": "96 kbps (Speech / Low)",
};

export function videoAudioBitrateLabel(value: string): string {
  return VIDEO_AUDIO_BITRATE_LABELS[value] ?? value;
}

const RESOLUTION_LABELS: Record<string, string> = {
  original: "Keep original size — do not resize",
  "4k": "4K Ultra HD — 2160p",
  "1440p": "2.5K — 1440p",
  "1080p": "Full HD — 1080p",
  "720p": "HD — 720p",
  "480p": "SD — 480p",
};

export function videoQualityLabel(value: string): string {
  return VIDEO_QUALITY_LABELS[value] ?? value;
}

export function resolutionLabel(value: string): string {
  return RESOLUTION_LABELS[value] ?? value;
}

export function imageQualityLabel(value: string, format: string): string {
  if (value !== "best") return value;
  if (["png", "bmp", "tif", "tiff", "ico", "tga", "ppm", "pgm", "pbm"].includes(format)) return "Lossless / every pixel preserved";
  if (format === "webp") return "Highest WebP quality / larger file";
  if (["jpg", "jpeg", "jfif"].includes(format)) return "Highest JPEG quality / larger file";
  return value;
}

export function formatsFor(category: Category): string[] {
  if (category === "Video") return ["source", ...videoFormats];
  if (category === "Image") return ["source", ...imageFormats];
  if (category === "Miscellaneous") return allFormats;
  return ["source", ...audioFormats];
}

export function qualitiesFor(format: string, category?: Category): string[] {
  if (format === "source") return ["best"];
  if (format === "wav") return ["16-bit", "24-bit", "32-bit"];
  if (format === "flac") return ["16-bit", "24-bit"];
  if (["aiff", "aif", "alac", "caf", "au"].includes(format)) return ["best"];
  if (format === "ogg") return ["q10", "q8", "q6", "q4"];
  if (category === "Image" && imageFormats.includes(format)) return ["best"];
  if (videoFormats.includes(format)) return ["original", "best", "high", "balanced", "small"];
  if (imageFormats.includes(format)) return ["best"];
  return ["320k", "256k", "192k", "128k"];
}

export interface IntentPreset {
  id: string;
  name: string;
  description: string;
  group: "Music" | "Video" | "Image" | "Other";
  category: Category;
  format: string;
  bitrate: string;
  audioBitrate?: string;
  sampleRate: number;
  resolution: string;
  normalize: boolean;
  useGpu: boolean;
  preserveQuality?: boolean;
  archivalFallback?: boolean;
}

export const intentPresets: IntentPreset[] = [
  {
    id: "preserve-quality",
    name: "Preserve Quality",
    description: "Keep source quality: takes the raw file or highest-quality stream without re-encoding",
    group: "Other",
    category: "Audio",
    format: "source",
    bitrate: "best",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: false,
    preserveQuality: true,
    archivalFallback: false,
  },
  {
    id: "studio-master",
    name: "Studio Master",
    description: "32-bit uncompressed WAV at 48kHz without dynamic compression, with cover art and credits",
    group: "Music",
    category: "Audio",
    format: "wav",
    bitrate: "32-bit",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: false,
    archivalFallback: false,
  },
  {
    id: "universal-music",
    name: "Universal Music",
    description: "High-bitrate 320k MP3 with EBU R128 (-14 LUFS) streaming volume leveling, cover art, and credits",
    group: "Music",
    category: "Audio",
    format: "mp3",
    bitrate: "320k",
    sampleRate: 48000,
    resolution: "original",
    normalize: true,
    useGpu: false,
    archivalFallback: false,
  },
  {
    id: "fast-music",
    name: "Fast MP3",
    description: "High-bitrate 320k MP3 without loudness normalization for faster conversion",
    group: "Music",
    category: "Audio",
    format: "mp3",
    bitrate: "320k",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: false,
    archivalFallback: false,
  },
  {
    id: "lossless-flac",
    name: "Lossless FLAC",
    description: "Pristine 24-bit FLAC archive at 48kHz with cover art and credits",
    group: "Music",
    category: "Audio",
    format: "flac",
    bitrate: "24-bit",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: false,
    archivalFallback: false,
  },
  {
    id: "universal-video",
    name: "Universal Video",
    description: "Standard 1080p Full HD MP4 with original source video and audio quality",
    group: "Video",
    category: "Video",
    format: "mp4",
    bitrate: "original",
    audioBitrate: "original",
    sampleRate: 48000,
    resolution: "1080p",
    normalize: false,
    useGpu: true,
    archivalFallback: false,
  },
  {
    id: "studio-cinematic",
    name: "Studio Cinematic",
    description: "Source-resolution MKV preserving original video and audio streams untouched",
    group: "Video",
    category: "Video",
    format: "mkv",
    bitrate: "original",
    audioBitrate: "original",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: false,
    archivalFallback: false,
  },
  {
    id: "av1-archive",
    name: "AV1 Next-Gen Archive",
    description: "Modern high-efficiency AV1 video encoding at original source quality",
    group: "Video",
    category: "Video",
    format: "av1",
    bitrate: "original",
    audioBitrate: "original",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: true,
    archivalFallback: false,
  },
  {
    id: "lossless-image",
    name: "Lossless Image",
    description: "Uncompressed pixel-for-pixel PNG preserving original full image dimensions and clarity",
    group: "Image",
    category: "Image",
    format: "png",
    bitrate: "best",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: false,
    archivalFallback: false,
  },
];

export const intentPresetGroups = ["Music", "Video", "Image", "Other"] as const;

export function detectCategoryFromPath(pathOrUrl: string): Category | null {
  if (!pathOrUrl || !pathOrUrl.trim()) return null;
  const cleanPath = pathOrUrl.trim().split("?")[0].split("#")[0];
  const lastDot = cleanPath.lastIndexOf(".");
  const lastSeparator = Math.max(cleanPath.lastIndexOf("/"), cleanPath.lastIndexOf("\\"));
  if (lastDot <= lastSeparator) return null;
  const ext = cleanPath.slice(lastDot + 1).toLowerCase();
  if (IMAGE_INPUT_EXTENSIONS.has(ext)) return "Image";
  if (AUDIO_INPUT_EXTENSIONS.has(ext)) return "Audio";
  if (VIDEO_INPUT_EXTENSIONS.has(ext)) return "Video";
  return null;
}

export function formatElapsedMs(ms?: number | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}

export function findPresetName(settings: {
  category: Category;
  format: string;
  bitrate: string;
  audioBitrate?: string;
  sampleRate: number;
  resolution: string;
  normalize: boolean;
  useGpu: boolean;
}): string {
  if (settings.format === "source") return "Preserve Quality";
  const matched = intentPresets.find((preset) => {
    const categoryMatches =
      preset.category === settings.category ||
      (preset.category === "Audio" && settings.category === "Music");
    const audioBitrateMatches = !preset.audioBitrate || preset.audioBitrate === (settings.audioBitrate ?? "original");
    return (
      categoryMatches &&
      preset.format === settings.format &&
      preset.bitrate === settings.bitrate &&
      audioBitrateMatches &&
      preset.sampleRate === settings.sampleRate &&
      preset.resolution === settings.resolution &&
      preset.normalize === settings.normalize
    );
  });
  return matched ? matched.name : "Custom";
}
