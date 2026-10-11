import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Category = "Audio" | "Music" | "Video" | "Image" | "Miscellaneous";
export type EventKind = "started" | "log" | "progress" | "status" | "finished" | "partial" | "failed" | "cancelled";

export interface RuntimeInfo {
  mode: "tauri" | "browser";
  pythonReady: boolean;
  ffmpegReady: boolean;
  ffmpegPath: string;
  pythonPath: string;
  dataRoot: string;
  projectRoot: string;
  gpuAvailable: boolean;
  gpuLabel: string;
  packaged: boolean;
}

export interface HardwareSnapshot {
  cpuName: string;
  logicalCores: number;
  cpuSystemPct: number;
  cpuAppPct: number;
  ramSystemPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  ramAppMb: number;
  gpuSystemPct: number;
  gpuVramUsedMb: number;
  gpuVramTotalMb: number;
  gpuAppVramMb: number;
  gpuTempC: number | null;
  gpuName: string;
  telemetrySource: string;
}

export interface ConverterSettings {
  outputDir: string;
  fetchedDir: string;
  category: Category;
  format: string;
  bitrate: string;
  sampleRate: number;
  resolution: string;
  normalize: boolean;
  useGpu: boolean;
  saveCover: boolean;
  saveMetadata: boolean;
  allowPngFallback?: boolean;
  retries: number;
}

export interface UpdateCheckResult {
  message: string;
  engine?: {
    has_update?: boolean;
    online?: boolean;
    current_version?: string;
    latest_version?: string;
  };
  repo?: {
    has_update?: boolean;
    current_commit?: string;
    latest_commit?: string;
    current_version?: string;
    latest_version?: string;
    installer_available?: boolean;
    release_url?: string;
  };
}

export interface ConversionRequest extends Omit<ConverterSettings, "fetchedDir"> {
  source: string;
  playlistIndexes?: string;
  browserSession?: string;
  browserCapturePath?: string;
  facebookCaptureId?: string;
  socialCaptureId?: string;
}

export interface FacebookCaptureResult {
  captureId: string;
  title: string;
  photoCount: number;
  mediaKind: "photo" | "video";
}

export interface SocialCaptureResult {
  captureId: string;
  title: string;
  photoCount: number;
  mediaKind?: "photo" | "video";
}

export interface ConverterEvent {
  jobId: string;
  kind: EventKind;
  message: string;
  progress?: number;
  output?: string;
}

export interface PlaylistItem {
  index: number;
  title: string;
  artist: string;
  duration: string;
  url: string;
}

export interface PlaylistCatalog {
  title: string;
  items: PlaylistItem[];
}

export interface FlpProjectInfo {
  filePath: string;
  fileName: string;
  fileSize: number;
  version: string;
  majorVersion: number;
  build?: number;
  title: string;
  bpm: number;
  ppq: number;
  channels: number;
  registered: boolean;
  registrationName: string;
  eventsCount: number;
}

export interface FlpDowngradeResult {
  success: boolean;
  sourcePath: string;
  outputPath: string;
  sourceVersion: string;
  sourceMajor: number;
  sourceBuild?: number;
  targetVersion: string;
  targetBuild?: number;
  targetMajor?: number;
  targetProfile: string;
  targetLabel: string;
  recordsAdjusted: number;
  eventsCount: number;
  outputSizeBytes: number;
  backupPath?: string | null;
}

export interface InstalledFlStudio {
  name: string;
  fullVersion: string;
  version: string;
  build: number;
  executablePath: string;
}

export interface AccessStatus {
  active: boolean;
  link: string;
  browser: string;
  source?: string | null;
  bridgeConnected: boolean;
  captureCount?: number;
  capturedMediaKind?: "video" | "audio" | "image";
}

export interface FetchedMedia {
  captureMethod?: string;
  sourceUrl?: string;
  capturedAt?: number;
  path: string;
  name: string;
  mediaKind: "video" | "audio" | "image";
  mimeType: string;
  captureMode: "current" | "sequence" | "collect" | "network" | "saved";
  title: string;
  size: number;
}

export interface AccessDiagnostic {
  id: number;
  message: string;
}

export interface LibraryEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  isPlaylist: boolean;
  mediaCount: number;
  totalBytes: number;
  extension: string;
  conversionMs?: number;
}

export interface MoveDirectoryResult {
  destination: string;
  cleanupWarning?: string | null;
}

export interface ConversionHistoryItem {
  id: string;
  timestamp: string;
  source: string;
  fileName: string;
  exportPath: string;
  presetName: string;
  formatLabel: string;
  qualityLabel: string;
  elapsedMs: number;
  status: "succeeded" | "failed" | "partial";
  fallbackNote?: string | null;
  errorMessage?: string | null;
}

export interface JaneBridge {
  conversionHistory(legacy?: ConversionHistoryItem[], entry?: ConversionHistoryItem, remove?: string, clear?: boolean): Promise<{ history: ConversionHistoryItem[]; warning?: string | null }>;
  runtimeInfo(): Promise<RuntimeInfo>;
  hardwareSnapshot(): Promise<HardwareSnapshot>;
  settingsGet(): Promise<ConverterSettings>;
  settingsSave(settings: ConverterSettings): Promise<void>;
  setDataRoot(path: string): Promise<string>;
  chooseFile(): Promise<string | null>;
  chooseFiles(): Promise<string[]>;
  chooseFolder(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  openFile(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  startConversion(request: ConversionRequest): Promise<string>;
  captureFacebookAlbum(source: string, captureId: string): Promise<FacebookCaptureResult>;
  cancelFacebookAlbum(captureId: string): Promise<void>;
  captureSocialPostPhotos(source: string, captureId: string): Promise<SocialCaptureResult>;
  cancelSocialPostPhotos(captureId: string): Promise<void>;
  pauseConversion(jobId?: string): Promise<void>;
  resumeConversion(jobId?: string): Promise<void>;
  cancelConversion(jobId: string): Promise<void>;
  loadPlaylist(source: string): Promise<PlaylistCatalog>;
  cancelPlaylist(): Promise<void>;
  subscribe(listener: (event: ConverterEvent) => void): Promise<UnlistenFn>;
  scanLibrary(path: string): Promise<LibraryEntry[]>;
  isConvertedLibraryPath(path: string): Promise<boolean>;
  recentConversions(path: string, limit: number): Promise<LibraryEntry[]>;
  clearConversionTimings(): Promise<void>;
  dragLibraryFile(path: string): Promise<void>;
  getThumbnail(root: string, path: string): Promise<string | null>;
  moveLibrary(source: string, destinationParent: string): Promise<MoveDirectoryResult>;
  moveFetchedFolder(source: string, destinationParent: string): Promise<MoveDirectoryResult>;
  deleteLibraryEntry(root: string, path: string): Promise<void>;
  createAccessLink(source: string): Promise<AccessStatus>;
  accessStatus(): Promise<AccessStatus>;
  fetchedMedia(): Promise<FetchedMedia[]>;
  accessDiagnostics(): Promise<AccessDiagnostic[]>;
  fetchedMediaThumbnail(path: string): Promise<string | null>;
  discardFetchedMedia(path: string): Promise<void>;
  clearAccessLink(): Promise<void>;
  relaunch(): Promise<void>;
  notifyAttention(): Promise<void>;
  checkUpdates(): Promise<UpdateCheckResult>;
  installUpdate(): Promise<void>;
  chooseFlpFile(): Promise<string | null>;
  flpDetectInstalled(): Promise<InstalledFlStudio[]>;
  flpInspect(path: string): Promise<FlpProjectInfo>;
  flpDowngrade(source: string, targetVersion: string, targetBuild?: number, outputPath?: string, overwrite?: boolean): Promise<FlpDowngradeResult>;
  exportLogFile(content: string, defaultFilename?: string): Promise<string | null>;
  setTaskbarProgress(progress?: number, status?: "normal" | "paused" | "error" | "none" | "indeterminate"): Promise<void>;
}

const demoSettings: ConverterSettings = {
  outputDir: "Project-local/converted",
  fetchedDir: "Project-local/fetched",
  category: "Music",
  format: "mp3",
  bitrate: "320k",
  sampleRate: 48000,
  resolution: "original",
  normalize: false,
  useGpu: false,
  saveCover: true,
  saveMetadata: true,
  allowPngFallback: false,
  retries: 2,
};

const demoBridge: JaneBridge = {
  async conversionHistory(legacy = [], entry, remove, clear) {
    const saved: ConversionHistoryItem[] = JSON.parse(window.localStorage.getItem("janeconverter.preview-history") || "null") || legacy;
    const history = clear ? [] : entry ? [entry, ...saved.filter((item) => item.id !== entry.id)] : saved.filter((item) => item.id !== remove);
    window.localStorage.setItem("janeconverter.preview-history", JSON.stringify(history));
    return { history };
  },
  async runtimeInfo() {
    return { mode: "browser", pythonReady: false, ffmpegReady: false, ffmpegPath: "", pythonPath: "", dataRoot: "Project-local", projectRoot: "Project-local", gpuAvailable: false, gpuLabel: "Preview mode", packaged: false };
  },
  async hardwareSnapshot() {
    return { cpuName: "Preview mode", logicalCores: 0, cpuSystemPct: 0, cpuAppPct: 0, ramSystemPct: 0, ramUsedGb: 0, ramTotalGb: 0, ramAppMb: 0, gpuSystemPct: 0, gpuVramUsedMb: 0, gpuVramTotalMb: 0, gpuAppVramMb: 0, gpuTempC: null, gpuName: "Unavailable in browser preview", telemetrySource: "Unavailable" };
  },
  async settingsGet() { return { ...demoSettings }; },
  async settingsSave() {},
  async setDataRoot(path) { return path; },
  async chooseFile() { return null; },
  async chooseFiles() { return []; },
  async chooseFolder() { return null; },
  async openPath() {},
  async openFile() {},
  async openUrl() {},
  async startConversion() { return "preview-job"; },
  async captureFacebookAlbum() { throw new Error("Facebook album capture is available in the JaneConverter desktop app."); },
  async cancelFacebookAlbum() {},
  async captureSocialPostPhotos() { return { captureId: "", title: "", photoCount: 0 }; },
  async cancelSocialPostPhotos() {},
  async pauseConversion() {},
  async resumeConversion() {},
  async cancelConversion() {},
  async loadPlaylist() { return { title: "Preview playlist", items: [] }; },
  async cancelPlaylist() {},
  async subscribe() { return () => {}; },
  async scanLibrary() { return []; },
  async isConvertedLibraryPath() { return false; },
  async recentConversions() { return []; },
  async clearConversionTimings() {},
  async dragLibraryFile() { throw new Error("Drag files into other apps from the desktop build."); },
  async getThumbnail() { return null; },
  async moveLibrary(source) { return { destination: source }; },
  async moveFetchedFolder(source) { return { destination: source }; },
  async deleteLibraryEntry() {},
  async createAccessLink() { return { active: true, link: "Preview mode", browser: "", bridgeConnected: false }; },
  async accessStatus() { return { active: false, link: "", browser: "", bridgeConnected: false }; },
  async fetchedMedia() { return []; },
  async accessDiagnostics() { return []; },
  async fetchedMediaThumbnail() { return null; },
  async discardFetchedMedia() {},
  async clearAccessLink() {},
  async relaunch() {},
  async notifyAttention() {},
  async checkUpdates() { return { message: "Preview mode: update checks are available in the desktop build." }; },
  async installUpdate() {},
  async chooseFlpFile() { return null; },
  async flpDetectInstalled() {
    return [
      {
        name: "FL Studio 21.2.3",
        fullVersion: "21.2.3.4004",
        version: "21.2.3",
        build: 4004,
        executablePath: "D:\\Programs\\FL Studio 21.2.3\\FL64.exe",
      },
    ];
  },
  async flpInspect(path: string) {
    return {
      filePath: path,
      fileName: "Preview_Project.flp",
      fileSize: 1048576,
      version: "26.1.4.5589",
      majorVersion: 26,
      build: 5589,
      title: "Preview Project",
      bpm: 140.0,
      ppq: 96,
      channels: 16,
      registered: true,
      registrationName: "Jane Cerys",
      eventsCount: 1250,
    };
  },
  async flpDowngrade(source: string, targetVersion: string, targetBuild?: number, outputPath?: string, overwrite?: boolean) {
    return {
      success: true,
      sourcePath: source,
      outputPath: overwrite ? source : (outputPath || source.replace(/\.flp$/i, `_downgraded_FL${targetVersion}.flp`)),
      sourceVersion: "26.1.4.5589",
      sourceMajor: 26,
      sourceBuild: 5589,
      targetVersion: targetVersion.includes(".") ? targetVersion : `${targetVersion}.0.0.${targetBuild ?? 0}`,
      targetBuild: targetBuild ?? 4004,
      targetMajor: parseInt(targetVersion, 10) || 21,
      targetProfile: targetVersion,
      targetLabel: `FL Studio ${targetVersion}`,
      recordsAdjusted: 16,
      eventsCount: 1250,
      outputSizeBytes: 1047500,
      backupPath: overwrite ? `${source}.bak` : null,
    };
  },
  async exportLogFile(content: string, defaultFilename = "janeconverter-logs.txt") {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return defaultFilename;
  },
  async setTaskbarProgress() {},
};

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

const tauriBridge: JaneBridge = {
  conversionHistory: (legacy = [], entry, remove, clear = false) => invoke("conversion_history", { legacy, entry: entry ?? null, remove: remove ?? null, clear }),
  runtimeInfo: () => invoke<RuntimeInfo>("runtime_info"),
  hardwareSnapshot: () => invoke<HardwareSnapshot>("hardware_snapshot"),
  settingsGet: () => invoke<ConverterSettings>("settings_get"),
  settingsSave: (settings) => invoke<void>("settings_save", { settings }),
  setDataRoot: (path) => invoke<string>("set_data_root_path", { path }),
  chooseFile: () => invoke<string | null>("choose_file"),
  chooseFiles: () => invoke<string[]>("choose_files"),
  chooseFolder: () => invoke<string | null>("choose_folder"),
  chooseFlpFile: () => invoke<string | null>("choose_flp_file"),
  flpDetectInstalled: () => invoke<InstalledFlStudio[]>("flp_detect_installed"),
  flpInspect: (path: string) => invoke<FlpProjectInfo>("flp_inspect", { path }),
  flpDowngrade: (source: string, targetVersion: string, targetBuild?: number, outputPath?: string, overwrite?: boolean) =>
    invoke<FlpDowngradeResult>("flp_downgrade", {
      source,
      targetVersion,
      targetBuild: targetBuild ?? null,
      outputPath: outputPath ?? null,
      overwrite: overwrite ?? null,
    }),
  openPath: (path) => invoke<void>("open_path", { path }),
  openFile: (path) => invoke<void>("open_file", { path }),
  openUrl: (url) => invoke<void>("open_url", { url }),
  startConversion: (request) => invoke<string>("start_conversion", { request }),
  captureFacebookAlbum: (source, captureId) => invoke<FacebookCaptureResult>("capture_facebook_album", { source, captureId }),
  cancelFacebookAlbum: (captureId) => invoke<void>("cancel_facebook_album", { captureId }),
  captureSocialPostPhotos: (source, captureId) => invoke<SocialCaptureResult>("capture_social_post_photos", { source, captureId }),
  cancelSocialPostPhotos: (captureId) => invoke<void>("cancel_social_post_photos", { captureId }),
  pauseConversion: (jobId) => invoke<void>("pause_conversion", { jobId }),
  resumeConversion: (jobId) => invoke<void>("resume_conversion", { jobId }),
  cancelConversion: (jobId) => invoke<void>("cancel_conversion", { jobId }),
  loadPlaylist: (source) => invoke<PlaylistCatalog>("load_playlist", { source }),
  cancelPlaylist: () => invoke<void>("cancel_playlist"),
  subscribe: (listener) => listen<ConverterEvent>("converter-event", (event) => listener(event.payload)),
  scanLibrary: (path) => invoke<LibraryEntry[]>("scan_library", { path }),
  isConvertedLibraryPath: (path) => invoke<boolean>("is_converted_library_path", { path }),
  recentConversions: (path, limit) => invoke<LibraryEntry[]>("recent_conversions", { path, limit }),
  clearConversionTimings: () => invoke<void>("clear_conversion_timings"),
  dragLibraryFile: (path) => invoke<void>("drag_library_file", { path }),
  getThumbnail: (root, path) => invoke<string | null>("get_thumbnail", { root, path }),
  moveLibrary: (source, destinationParent) => invoke<MoveDirectoryResult>("move_library", { source, destinationParent }),
  moveFetchedFolder: (source, destinationParent) => invoke<MoveDirectoryResult>("move_fetched_folder", { source, destinationParent }),
  deleteLibraryEntry: (root, path) => invoke<void>("delete_library_entry", { root, path }),
  createAccessLink: (source) => invoke<AccessStatus>("create_access_link", { source }),
  accessStatus: () => invoke<AccessStatus>("access_status"),
  fetchedMedia: () => invoke<FetchedMedia[]>("fetched_media"),
  accessDiagnostics: () => invoke<AccessDiagnostic[]>("access_diagnostics"),
  fetchedMediaThumbnail: (path) => invoke<string | null>("fetched_media_thumbnail", { path }),
  discardFetchedMedia: (path) => invoke<void>("discard_fetched_media", { path }),
  clearAccessLink: () => invoke<void>("clear_access_link"),
  relaunch: () => invoke<void>("relaunch"),
  notifyAttention: () => invoke<void>("notify_attention"),
  checkUpdates: () => invoke<UpdateCheckResult>("check_updates"),
  installUpdate: () => invoke<void>("install_update"),
  exportLogFile: (content: string, defaultFilename?: string) =>
    invoke<string | null>("export_log_file", { content, defaultFilename: defaultFilename ?? null }),
  setTaskbarProgress: (progress, status) =>
    invoke<void>("set_taskbar_progress", {
      progress: progress !== undefined ? Math.round(progress) : null,
      status: status ?? null,
    }),
};

export const bridge: JaneBridge = isTauriRuntime() ? tauriBridge : demoBridge;
