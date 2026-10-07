import { useState, useRef, useEffect, type DragEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileMusic,
  FolderOpen,
  HardDrive,
  Info,
  LoaderCircle,
  Play,
  RefreshCw,
  Sliders,
  Sparkles,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { FlpDowngradeResult, FlpProjectInfo, InstalledFlStudio } from "../bridge";
import { bridge } from "../bridge";

interface FlpConverterViewProps {
  onStatus: (message: string) => void;
}

interface VersionPreset {
  key: string;
  label: string;
  version: string;
  build: number;
  description: string;
}

const POPULAR_PRESETS: VersionPreset[] = [
  {
    key: "24.2.2",
    label: "FL Studio 24.2.2",
    version: "24.2.2",
    build: 4597,
    description: "FL 24 latest stable build. Modern audio clips & mixer routing.",
  },
  {
    key: "24.1.2",
    label: "FL Studio 24.1.2",
    version: "24.1.2",
    build: 4398,
    description: "FL 24 baseline release. Modern plugin wrapper compatibility.",
  },
  {
    key: "21.2.3",
    label: "FL Studio 21.2.3",
    version: "21.2.3",
    build: 4004,
    description: "Universal collaborative release. High compatibility across producers.",
  },
  {
    key: "21.0.3",
    label: "FL Studio 21.0.3",
    version: "21.0.3",
    build: 3517,
    description: "FL 21 baseline. Supported across all FL 21 studio rigs.",
  },
  {
    key: "20.9.2",
    label: "FL Studio 20.9.2",
    version: "20.9.2",
    build: 2963,
    description: "Legacy industry standard. High stability for older FL 20 machines.",
  },
  {
    key: "20.7.3",
    label: "FL Studio 20.7.3",
    version: "20.7.3",
    build: 1987,
    description: "Classic FL 20 production rigs.",
  },
  {
    key: "12.5.1",
    label: "FL Studio 12.5.1",
    version: "12.5.1",
    build: 165,
    description: "Classic 32/64-bit engine format for vintage studio machines.",
  },
  {
    key: "11.1.1",
    label: "FL Studio 11.1.1",
    version: "11.1.1",
    build: 50,
    description: "Vintage FL 11 engine format.",
  },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export function FlpConverterView({ onStatus }: FlpConverterViewProps) {
  const [filePath, setFilePath] = useState<string>("");
  const [projectInfo, setProjectInfo] = useState<FlpProjectInfo | null>(null);
  const [installedFl, setInstalledFl] = useState<InstalledFlStudio[]>([]);
  const [detectingFl, setDetectingFl] = useState<boolean>(false);

  // Target version & build controls
  const [targetVersion, setTargetVersion] = useState<string>("21.2.3");
  const [targetBuild, setTargetBuild] = useState<string>("4004");
  const [overwriteOriginal, setOverwriteOriginal] = useState<boolean>(false);

  const [inspecting, setInspecting] = useState<boolean>(false);
  const [converting, setConverting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertResult, setConvertResult] = useState<FlpDowngradeResult | null>(null);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-detect installed FL Studio versions on user's rig on mount
  useEffect(() => {
    let active = true;
    async function detect() {
      setDetectingFl(true);
      try {
        const detected = await bridge.flpDetectInstalled();
        if (active && detected.length > 0) {
          setInstalledFl(detected);
        }
      } catch (err) {
        console.warn("Could not query installed FL Studios:", err);
      } finally {
        if (active) setDetectingFl(false);
      }
    }
    void detect();
    return () => {
      active = false;
    };
  }, []);

  async function handleLoadProject(path: string) {
    const clean = path.trim().replace(/^"|"$/g, "");
    if (!clean) return;
    setFilePath(clean);
    setInspectError(null);
    setConvertError(null);
    setConvertResult(null);
    setInspecting(true);

    try {
      const info = await bridge.flpInspect(clean);
      setProjectInfo(info);
      onStatus(`Inspected FLP: ${info.title || info.fileName} (FL Studio ${info.version})`);

      // Smart default target: If user has an installed FL Studio older than the project, use that!
      const projectMajor = info.majorVersion;
      const olderInstalls = installedFl.filter(
        (inst) => parseInt(inst.version.split(".")[0], 10) < projectMajor
      );
      if (olderInstalls.length > 0) {
        const best = olderInstalls[0];
        setTargetVersion(best.version);
        setTargetBuild(best.build > 0 ? String(best.build) : "");
      } else if (projectMajor >= 25) {
        setTargetVersion("21.2.3");
        setTargetBuild("4004");
      } else if (projectMajor === 24) {
        setTargetVersion("21.2.3");
        setTargetBuild("4004");
      } else if (projectMajor === 21) {
        setTargetVersion("20.9.2");
        setTargetBuild("2963");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInspectError(msg);
      setProjectInfo(null);
      onStatus(`Failed to read project: ${msg}`);
    } finally {
      setInspecting(false);
    }
  }

  async function handleBrowseFile() {
    try {
      const selected = await bridge.chooseFlpFile();
      if (selected) {
        await handleLoadProject(selected);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onStatus(`Error selecting file: ${msg}`);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const path = (file as unknown as { path?: string }).path || file.name;
      if (path.toLowerCase().endsWith(".flp")) {
        void handleLoadProject(path);
      } else {
        onStatus("Please drop a valid .flp project file.");
      }
    }
  }

  function applyPreset(preset: VersionPreset) {
    setTargetVersion(preset.version);
    setTargetBuild(String(preset.build));
  }

  function applyInstalled(installed: InstalledFlStudio) {
    setTargetVersion(installed.version);
    setTargetBuild(installed.build > 0 ? String(installed.build) : "");
    onStatus(`Selected installed FL Studio: ${installed.name} (build ${installed.build})`);
  }

  async function handleDowngrade() {
    if (!projectInfo || !filePath) return;
    const cleanVer = targetVersion.trim();
    if (!cleanVer) {
      setConvertError("Please enter or select a target FL Studio version.");
      return;
    }

    setConverting(true);
    setConvertResult(null);
    setConvertError(null);

    const parsedBuild = parseInt(targetBuild.trim(), 10);
    const buildNum = Number.isFinite(parsedBuild) && parsedBuild > 0 ? parsedBuild : undefined;

    try {
      const result = await bridge.flpDowngrade(
        filePath,
        cleanVer,
        buildNum,
        undefined,
        overwriteOriginal
      );
      setConvertResult(result);
      onStatus(`Successfully downgraded project to ${result.targetLabel}!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConvertError(msg);
      onStatus(`Downgrade error: ${msg}`);
    } finally {
      setConverting(false);
    }
  }

  function handleCopyPath(path: string) {
    void navigator.clipboard.writeText(path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
    onStatus("Copied project path to clipboard.");
  }

  async function handleOpenFile(path: string) {
    try {
      await bridge.openFile(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onStatus(`Could not open file: ${msg}`);
    }
  }

  async function handleOpenFolder(path: string) {
    try {
      await bridge.openPath(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onStatus(`Could not open folder: ${msg}`);
    }
  }

  return (
    <div className="space-y-5 pb-6">
      {/* File Dropzone & Selection (Signature Dark Rose Obsidian) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative overflow-hidden rounded-2xl border transition-all duration-200 ${
          isDragOver
            ? "border-[#c52b68] bg-[#c52b68]/10 shadow-[0_0_35px_rgba(197,43,104,0.2)]"
            : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.14]"
        } p-7 text-center`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".flp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              const file = e.target.files[0];
              const path = (file as unknown as { path?: string }).path || file.name;
              void handleLoadProject(path);
            }
          }}
        />

        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-[#c52b68]/30 bg-[#c52b68]/10 text-rose-400 shadow-[0_0_20px_rgba(197,43,104,0.15)]">
          <FileMusic size={26} />
        </div>

        <h3 className="mt-4 text-base font-medium text-white">
          {filePath ? "Loaded FL Studio Project" : "Drag & drop an FL Studio project (.flp)"}
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-400">
          {filePath
            ? filePath
            : "Drop any .flp file here to inspect project headers, patch version & build events bit-perfectly, and open cleanly in older FL Studio versions."}
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleBrowseFile}
            className="flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:border-[#c52b68]/40 hover:bg-white/[0.1]"
          >
            <FolderOpen size={14} className="text-rose-400" />
            Browse .flp file
          </button>

          {filePath && (
            <button
              type="button"
              disabled={inspecting}
              onClick={() => handleLoadProject(filePath)}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-zinc-400 transition-all hover:text-white"
            >
              <RefreshCw size={13} className={inspecting ? "animate-spin text-rose-400" : ""} />
              Re-scan
            </button>
          )}
        </div>
      </div>

      {/* Inspect Error Message */}
      {inspectError && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
          <AlertCircle size={16} className="shrink-0 text-rose-400" />
          <span>{inspectError}</span>
        </div>
      )}

      {/* Project Inspector Card */}
      <AnimatePresence>
        {projectInfo && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 backdrop-blur-sm"
          >
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-5">
              <div>
                <div className="mono-label text-rose-400">Project Inspection</div>
                <h4 className="mt-1 text-xl font-semibold tracking-tight text-white">
                  {projectInfo.title || "Untitled FLP"}
                </h4>
                <p className="mt-0.5 text-xs text-zinc-400">{projectInfo.fileName}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-[#c52b68]/40 bg-[#c52b68]/20 px-3 py-1 text-xs font-medium text-rose-300">
                  FL Studio {projectInfo.version}
                  {projectInfo.build ? ` (Build ${projectInfo.build})` : ""}
                </span>
                {projectInfo.registered && (
                  <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                    Producer Licensed
                  </span>
                )}
              </div>
            </div>

            {/* Project Specs Grid */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3.5">
                <div className="text-[11px] text-zinc-500">Tempo (BPM)</div>
                <div className="mt-1 text-base font-semibold text-white">{projectInfo.bpm} BPM</div>
              </div>
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3.5">
                <div className="text-[11px] text-zinc-500">Timebase (PPQ)</div>
                <div className="mt-1 text-base font-semibold text-white">{projectInfo.ppq} PPQ</div>
              </div>
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3.5">
                <div className="text-[11px] text-zinc-500">Channel Count</div>
                <div className="mt-1 text-base font-semibold text-white">{projectInfo.channels} Channels</div>
              </div>
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3.5">
                <div className="text-[11px] text-zinc-500">File Size</div>
                <div className="mt-1 text-base font-semibold text-white">{formatBytes(projectInfo.fileSize)}</div>
              </div>
            </div>

            {/* Detected Local FL Studio Installations */}
            {installedFl.length > 0 && (
              <div className="mt-6 rounded-xl border border-[#c52b68]/20 bg-[#c52b68]/[0.04] p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-rose-300">
                  <HardDrive size={14} className="text-rose-400" />
                  <span>Detected on Your Rig (1-Click Target)</span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Select your exact local FL Studio build to guarantee instant opening without newer-version warnings:
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {installedFl.map((inst) => {
                    const isSelected =
                      targetVersion === inst.version &&
                      (inst.build ? targetBuild === String(inst.build) : true);
                    return (
                      <button
                        key={inst.executablePath}
                        type="button"
                        onClick={() => applyInstalled(inst)}
                        className={`group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all ${
                          isSelected
                            ? "border-[#c52b68] bg-[#c52b68]/25 text-white shadow-[0_0_15px_rgba(197,43,104,0.3)]"
                            : "border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:border-[#c52b68]/50 hover:bg-white/[0.06] hover:text-white"
                        }`}
                      >
                        <span className="font-medium">{inst.name}</span>
                        {inst.build > 0 && (
                          <span
                            className={`rounded px-1.5 py-0.2 text-[10px] ${
                              isSelected
                                ? "bg-white/20 text-rose-100"
                                : "bg-black/30 text-zinc-400 group-hover:text-zinc-200"
                            }`}
                          >
                            Build {inst.build}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Target Compatibility & Custom Build Inputs */}
            <div className="mt-6 space-y-4">
              <div>
                <div className="mono-label text-rose-400">Target Compatibility Setup</div>
                <p className="mt-1 text-xs text-zinc-400">
                  JaneConverter surgically updates Event 0xC7 (ASCII version), Event 0x9F (DWORD build number), and UTF-16LE version strings, recalculating the project header size for bit-perfect loading.
                </p>
              </div>

              {/* Version & Build adaptive controls */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-400">
                    Target FL Studio Version
                  </label>
                  <input
                    type="text"
                    value={targetVersion}
                    onChange={(e) => setTargetVersion(e.target.value)}
                    placeholder="e.g. 21.2.3"
                    className="w-full rounded-xl border border-white/[0.1] bg-black/40 px-3.5 py-2 text-xs font-medium text-white transition-all focus:border-[#c52b68] focus:outline-none focus:ring-1 focus:ring-[#c52b68]"
                  />
                  <span className="text-[10px] text-zinc-500">e.g. 24.2.2, 21.2.3, 20.9.2</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-400">
                    Target Build Number
                  </label>
                  <input
                    type="number"
                    value={targetBuild}
                    onChange={(e) => setTargetBuild(e.target.value)}
                    placeholder="e.g. 4004"
                    className="w-full rounded-xl border border-white/[0.1] bg-black/40 px-3.5 py-2 text-xs font-medium text-white transition-all focus:border-[#c52b68] focus:outline-none focus:ring-1 focus:ring-[#c52b68]"
                  />
                  <span className="text-[10px] text-zinc-500">
                    Crucial for preventing the "newer version" popup (e.g. 4004 for FL 21.2.3)
                  </span>
                </div>

                <div className="flex flex-col justify-between space-y-1.5 sm:col-span-2 lg:col-span-1">
                  <label className="text-[11px] font-medium text-zinc-400">
                    Output File Option
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-black/30 p-2.5 transition-all hover:border-white/[0.14]">
                    <input
                      type="checkbox"
                      checked={overwriteOriginal}
                      onChange={(e) => setOverwriteOriginal(e.target.checked)}
                      className="size-4 rounded border-white/20 bg-black/40 text-rose-600 focus:ring-rose-500"
                    />
                    <div className="text-left">
                      <div className="text-xs font-medium text-white">Overwrite original file</div>
                      <div className="text-[10px] text-zinc-500">Creates safe .bak backup file</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Popular Presets Cards */}
              <div className="mt-3">
                <div className="text-[11px] font-medium text-zinc-500">Common Preset Targets</div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {POPULAR_PRESETS.map((preset) => {
                    const isSelected =
                      targetVersion === preset.version && targetBuild === String(preset.build);
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className={`rounded-xl border p-2.5 text-left transition-all ${
                          isSelected
                            ? "border-[#c52b68] bg-[#c52b68]/15 text-white shadow-[0_0_15px_rgba(197,43,104,0.2)]"
                            : "border-white/[0.06] bg-white/[0.02] text-zinc-300 hover:border-white/[0.12] hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-medium ${isSelected ? "text-rose-300" : "text-white"}`}>
                            {preset.label}
                          </span>
                          <span className="text-[10px] text-zinc-500">b.{preset.build}</span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-[10px] text-zinc-500">
                          {preset.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Convert Error */}
            {convertError && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
                <AlertCircle size={15} className="shrink-0 text-rose-400" />
                <span>{convertError}</span>
              </div>
            )}

            {/* Action Bar */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-5">
              <div className="text-xs text-zinc-400">
                Non-destructive surgical patching preserves all mixer routes, playlist arrangements, and automations.
              </div>

              <button
                type="button"
                disabled={converting || !targetVersion.trim()}
                onClick={handleDowngrade}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#c52b68] to-[#911849] px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-[#c52b68]/20 transition-all hover:from-[#d9387a] hover:to-[#a71d55] hover:shadow-[#c52b68]/30 disabled:opacity-50"
              >
                {converting ? (
                  <>
                    <LoaderCircle size={15} className="animate-spin" />
                    Downgrading project...
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    Downgrade to FL Studio {targetVersion}
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Downgrade Outcome Card (Signature Rose / Emerald Confirmation) */}
      <AnimatePresence>
        {convertResult && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-6 backdrop-blur-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-white">
                    Downgraded to {convertResult.targetLabel}
                    {convertResult.targetBuild ? ` (Build ${convertResult.targetBuild})` : ""}
                  </h4>
                  <p className="text-xs text-emerald-300/80">
                    Processed {convertResult.eventsCount} events
                    {convertResult.recordsAdjusted > 0 &&
                      ` and aligned ${convertResult.recordsAdjusted} playlist records`}
                    . Ready to open in FL Studio {convertResult.targetProfile}!
                  </p>
                  {convertResult.backupPath && (
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      Backup saved to: <span className="font-mono">{convertResult.backupPath}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyPath(convertResult.outputPath)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-xs text-white transition-all hover:bg-white/[0.1]"
                >
                  {copiedPath ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  {copiedPath ? "Copied" : "Copy Path"}
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenFolder(convertResult.outputPath)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-xs text-white transition-all hover:bg-white/[0.1]"
                >
                  <FolderOpen size={13} />
                  Show in Folder
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenFile(convertResult.outputPath)}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:bg-emerald-500"
                >
                  <Play size={13} />
                  Open in FL Studio
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/30 p-3 font-mono text-[11px] text-zinc-300 break-all">
              {convertResult.outputPath}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
