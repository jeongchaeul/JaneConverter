import { useState, useRef, useEffect, type DragEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileMusic,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  Play,
  RefreshCw,
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
  const [, setDetectingFl] = useState<boolean>(false);

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

      // Smart default target: If user has an installed FL Studio older than the project, use that
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
      onStatus(`Successfully processed project headers for ${result.targetLabel}!`);
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
    <div className="space-y-4 pb-6">
      {/* Experimental Notice Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3.5 text-xs text-amber-200/90">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="space-y-0.5">
          <div className="font-semibold text-amber-300">Experimental Feature</div>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            FL Studio (.flp) downgrade is experimental. Modern FL Studio builds use proprietary, non-linear event structures and VST-specific chunks that may still trigger version warnings or behave unpredictably in older environments. Always keep a backup of your original project before testing.
          </p>
        </div>
      </div>

      {/* File Dropzone & Selection (Clean native panel styling) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`panel relative overflow-hidden transition-all duration-200 ${
          isDragOver
            ? "border-[var(--accent-color)] bg-[var(--accent-subtle)] shadow-[0_0_24px_var(--accent-glow)] ring-1 ring-[var(--accent-color)]"
            : "hover:border-white/[0.14]"
        } p-6 text-center`}
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

        <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300">
          <FileMusic size={22} className="text-zinc-400" />
        </div>

        <h3 className="mt-3 text-sm font-medium text-white">
          {filePath ? "Loaded FL Studio Project" : "Drag & drop an FL Studio project (.flp)"}
        </h3>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
          {filePath
            ? filePath
            : "Drop any .flp file here or browse from your computer to inspect headers and test experimental downgrade patching."}
        </p>

        <div className="mt-4 flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={handleBrowseFile}
            className="subtle-button flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium"
          >
            <FolderOpen size={13} className="text-zinc-400" />
            Browse .flp file
          </button>

          {filePath && (
            <button
              type="button"
              disabled={inspecting}
              onClick={() => handleLoadProject(filePath)}
              className="subtle-button flex items-center gap-2 px-3 py-1.5 text-xs"
            >
              <RefreshCw size={12} className={inspecting ? "animate-spin text-zinc-400" : ""} />
              Re-scan
            </button>
          )}
        </div>
      </div>

      {/* Inspect Error Message */}
      {inspectError && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
          <AlertCircle size={15} className="shrink-0 text-rose-400" />
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
            className="panel p-5 space-y-5"
          >
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
              <div>
                <div className="mono-label">Project Inspection</div>
                <h4 className="mt-1 text-lg font-semibold tracking-tight text-white">
                  {projectInfo.title || "Untitled FLP"}
                </h4>
                <p className="mt-0.5 text-xs text-zinc-400">{projectInfo.fileName}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-300">
                  FL Studio {projectInfo.version}
                  {projectInfo.build ? ` (Build ${projectInfo.build})` : ""}
                </span>
                {projectInfo.registered && (
                  <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                    Producer Licensed
                  </span>
                )}
              </div>
            </div>

            {/* Project Specs Grid */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                <div className="text-[11px] text-zinc-500">Tempo (BPM)</div>
                <div className="mt-1 text-sm font-semibold text-white">{projectInfo.bpm} BPM</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                <div className="text-[11px] text-zinc-500">Timebase (PPQ)</div>
                <div className="mt-1 text-sm font-semibold text-white">{projectInfo.ppq} PPQ</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                <div className="text-[11px] text-zinc-500">Channel Count</div>
                <div className="mt-1 text-sm font-semibold text-white">{projectInfo.channels} Channels</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                <div className="text-[11px] text-zinc-500">File Size</div>
                <div className="mt-1 text-sm font-semibold text-white">{formatBytes(projectInfo.fileSize)}</div>
              </div>
            </div>

            {/* Detected Local FL Studio Installations */}
            {installedFl.length > 0 && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                  <HardDrive size={13} className="text-zinc-400" />
                  <span>Detected on Your Rig (Quick Target)</span>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Select your installed version to populate target version and build:
                </p>

                <div className="flex flex-wrap gap-2 pt-1">
                  {installedFl.map((inst) => {
                    const isSelected =
                      targetVersion === inst.version &&
                      (inst.build ? targetBuild === String(inst.build) : true);
                    return (
                      <button
                        key={inst.executablePath}
                        type="button"
                        onClick={() => applyInstalled(inst)}
                        className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs transition-all ${
                          isSelected
                            ? "border-[var(--accent-color)] bg-[var(--accent-subtle)] text-white shadow-sm"
                            : "border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white"
                        }`}
                      >
                        <span className="font-medium">{inst.name}</span>
                        {inst.build > 0 && (
                          <span
                            className={`rounded px-1.5 py-0.2 text-[10px] ${
                              isSelected
                                ? "bg-white/15 text-white"
                                : "bg-black/30 text-zinc-500 group-hover:text-zinc-300"
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
            <div className="space-y-3">
              <div>
                <div className="mono-label">Target Compatibility Setup</div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Select a version or specify custom build numbers to adjust project headers:
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
                    className="field w-full px-3 py-1.5 text-xs font-medium"
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
                    className="field w-full px-3 py-1.5 text-xs font-medium"
                  />
                  <span className="text-[10px] text-zinc-500">
                    Build number (e.g. 4004 for FL 21.2.3)
                  </span>
                </div>

                <div className="flex flex-col justify-between space-y-1.5 sm:col-span-2 lg:col-span-1">
                  <label className="text-[11px] font-medium text-zinc-400">
                    Output File Option
                  </label>
                  <label className="field flex cursor-pointer items-center gap-2.5 p-2 transition-all hover:border-white/[0.14]">
                    <input
                      type="checkbox"
                      checked={overwriteOriginal}
                      onChange={(e) => setOverwriteOriginal(e.target.checked)}
                      className="size-4 rounded border-white/20 bg-black/40 text-[var(--accent-color)] focus:ring-[var(--accent-color)]"
                    />
                    <div className="text-left">
                      <div className="text-xs font-medium text-white">Overwrite original file</div>
                      <div className="text-[10px] text-zinc-500">Creates safe .bak backup file</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Popular Presets Cards */}
              <div className="pt-1">
                <div className="text-[11px] font-medium text-zinc-500">Common Preset Targets</div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                            ? "border-[var(--accent-color)] bg-[var(--accent-subtle)] text-white shadow-sm"
                            : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-medium ${isSelected ? "text-white" : "text-zinc-200"}`}>
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
              <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
                <AlertCircle size={15} className="shrink-0 text-rose-400" />
                <span>{convertError}</span>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <div className="text-[11px] text-zinc-500">
                Experimental: Please keep backups of your original project before testing.
              </div>

              <button
                type="button"
                disabled={converting || !targetVersion.trim()}
                onClick={handleDowngrade}
                className="primary-button flex items-center gap-2 px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {converting ? (
                  <>
                    <LoaderCircle size={14} className="animate-spin" />
                    Patching project...
                  </>
                ) : (
                  <>
                    <Zap size={13} />
                    Downgrade to FL Studio {targetVersion}
                    <ArrowRight size={13} />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Downgrade Outcome Card */}
      <AnimatePresence>
        {convertResult && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="panel border-emerald-500/25 bg-emerald-500/[0.04] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">
                    Downgraded to {convertResult.targetLabel}
                    {convertResult.targetBuild ? ` (Build ${convertResult.targetBuild})` : ""}
                  </h4>
                  <p className="text-xs text-zinc-400">
                    Processed {convertResult.eventsCount} events
                    {convertResult.recordsAdjusted > 0 &&
                      ` and aligned ${convertResult.recordsAdjusted} playlist records`}
                    . Ready to test in FL Studio {convertResult.targetProfile}!
                  </p>
                  {convertResult.backupPath && (
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      Backup saved to: <span className="font-mono text-zinc-400">{convertResult.backupPath}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyPath(convertResult.outputPath)}
                  className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
                >
                  {copiedPath ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  {copiedPath ? "Copied" : "Copy Path"}
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenFolder(convertResult.outputPath)}
                  className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs"
                >
                  <FolderOpen size={12} />
                  Show in Folder
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenFile(convertResult.outputPath)}
                  className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-300 hover:border-emerald-500/40"
                >
                  <Play size={12} />
                  Open in FL Studio
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/30 p-2.5 font-mono text-[11px] text-zinc-400 break-all">
              {convertResult.outputPath}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
