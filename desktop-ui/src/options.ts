import type { Category } from "./bridge";

export const audioFormats = [
  "mp3", "flac", "wav", "aac", "ogg", "m4a", "opus", "aiff", "aif",
  "alac", "ac3", "mp2", "wma", "caf", "au",
];
export const videoFormats = [
  "mp4", "mkv", "webm", "mov", "gif", "avi", "flv", "m4v", "ts",
  "m2ts", "mpeg", "mpg", "vob", "3gp", "wmv", "asf",
];
export const imageFormats = [
  "jpg", "jpeg", "jfif", "png", "webp", "bmp", "tif", "tiff", "gif",
  "ico", "tga", "ppm", "pgm", "pbm",
];
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
  best: "Highest quality / least compression",
  high: "High quality / light compression",
  balanced: "Balanced quality / recommended",
  small: "Smaller file / more compression / less detail",
};

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
  if (category === "Miscellaneous") return ["source", ...new Set([...videoFormats, ...audioFormats, ...imageFormats])];
  return ["source", ...audioFormats];
}

export function qualitiesFor(format: string, category?: Category): string[] {
  if (format === "source") return ["best"];
  if (format === "wav") return ["16-bit", "24-bit", "32-bit"];
  if (format === "flac") return ["16-bit", "24-bit"];
  if (["aiff", "aif", "alac", "caf", "au"].includes(format)) return ["best"];
  if (format === "ogg") return ["q10", "q8", "q6", "q4"];
  if (category === "Image" && imageFormats.includes(format)) return ["best"];
  if (videoFormats.includes(format)) return ["best", "high", "balanced", "small"];
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
  sampleRate: number;
  resolution: string;
  normalize: boolean;
  useGpu: boolean;
  preserveQuality?: boolean;
}

export const intentPresets: IntentPreset[] = [
  {
    id: "preserve-quality",
    name: "Preserve Quality",
    description: "Keep source quality: takes the raw file or highest-quality stream without re-encoding",
    group: "Other",
    category: "Video",
    format: "source",
    bitrate: "best",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: false,
    preserveQuality: true,
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
  },
  {
    id: "universal-video",
    name: "Universal Video",
    description: "Standard 1080p Full HD MP4 with recommended picture quality",
    group: "Video",
    category: "Video",
    format: "mp4",
    bitrate: "balanced",
    sampleRate: 48000,
    resolution: "1080p",
    normalize: false,
    useGpu: true,
  },
  {
    id: "studio-cinematic",
    name: "Studio Cinematic",
    description: "Source-resolution MKV at the highest quality; preserves original video and audio streams when compatible",
    group: "Video",
    category: "Video",
    format: "mkv",
    bitrate: "best",
    sampleRate: 48000,
    resolution: "original",
    normalize: false,
    useGpu: false,
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
