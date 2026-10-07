import { useState, useRef, type DragEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileMusic,
  FolderOpen,
  LoaderCircle,
  Play,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { FlpDowngradeResult, FlpProjectInfo } from "../bridge";
import { bridge } from "../bridge";

interface FlpConverterViewProps {
  onStatus: (message: string) => void;
}

interface TargetVersionOption {
  key: string;
  label: string;
  versionString: string;
  description: string;
}

const TARGET_VERSIONS: TargetVersionOption[] = [
  {
    key: "24",
    label: "FL Studio 24",
    versionString: "24.1.2",
    description: "Modern production standard. Best for collaborations using FL 24.",
  },
  {
    key: "21",
    label: "FL Studio 21",
    versionString: "21.2.3",
    description: "Universal stability. Fully compatible with FL 21.x installations.",
  },
  {
    key: "20",
    label: "FL Studio 20",
    versionString: "20.9.2",
    description: "Legacy industry standard. Supported on older producer systems.",
  },
  {
    key: "12",
    label: "FL Studio 12",
    versionString: "12.5.1",
    description: "Classic engine format. For vintage FL 12 studio machines.",
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
  const [selectedTarget, setSelectedTarget] = useState<string>("24");
  const [inspecting, setInspecting] = useState<boolean>(false);
  const [converting, setConverting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [convertResult, setConvertResult] = useState<FlpDowngradeResult | null>(null);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLoadProject(path: string) {
    const clean = path.trim().replace(/^"|"$/g, "");
    if (!clean) return;
    setFilePath(clean);
    setInspectError(null);
    setConvertResult(null);
    setInspecting(true);

    try {
      const info = await bridge.flpInspect(clean);
      setProjectInfo(info);
      onStatus(`Inspected FLP: ${info.title} (FL Studio ${info.version})`);
      // Auto-suggest appropriate target version if source is higher
      if (info.majorVersion >= 25) {
        setSelectedTarget("24");
      } else if (info.majorVersion === 24) {
        setSelectedTarget("21");
      } else if (info.majorVersion === 21) {
        setSelectedTarget("20");
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
      // On Tauri desktop, file.path exists
      const path = (file as unknown as { path?: string }).path || file.name;
      if (path.toLowerCase().endsWith(".flp")) {
        void handleLoadProject(path);
      } else {
        onStatus("Please drop a valid .flp project file.");
      }
    }
  }

  async function handleDowngrade() {
    if (!projectInfo || !filePath) return;
    setConverting(true);
    setConvertResult(null);

    try {
      const result = await bridge.flpDowngrade(filePath, selectedTarget);
      setConvertResult(result);
      onStatus(`Successfully downgraded project to ${result.targetLabel}!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onStatus(`Downgrade error: ${msg}`);
    } finally {
      setConverting(false);
    }
  }

  function handleCopyPath(path: string) {
    void navigator.clipboard.writeText(path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
    onStatus("Copied output path to clipboard.");
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
    <div className="space-y-6">
      {/* File Dropzone & Selection */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative overflow-hidden rounded-2xl border transition-all duration-200 ${
          isDragOver
            ? "border-violet-500/80 bg-violet-500/10 shadow-[0_0_30px_rgba(139,92,246,0.15)]"
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

        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10 text-violet-400">
          <FileMusic size={26} />
        </div>

        <h3 className="mt-4 text-base font-medium text-white">
          {filePath ? "Loaded FL Studio Project" : "Drag & drop an FL Studio project (.flp)"}
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-400">
          {filePath
            ? filePath
            : "Drop any .flp file here or browse from your computer to inspect versions and downgrade project files safely."}
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleBrowseFile}
            className="flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-white/[0.1] hover:border-white/[0.2]"
          >
            <FolderOpen size={14} />
            Browse .flp file
          </button>

          {filePath && (
            <button
              type="button"
              disabled={inspecting}
              onClick={() => handleLoadProject(filePath)}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-zinc-400 transition-all hover:text-white"
            >
              <RefreshCw size={13} className={inspecting ? "animate-spin" : ""} />
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
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-5">
              <div>
                <div className="mono-label text-violet-400">Project Inspection</div>
                <h4 className="mt-1 text-xl font-semibold tracking-tight text-white">
                  {projectInfo.title || "Untitled FLP"}
                </h4>
                <p className="mt-0.5 text-xs text-zinc-400">{projectInfo.fileName}</p>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                  FL Studio {projectInfo.version}
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

            {/* Target Version Selector */}
            <div className="mt-6">
              <div className="mono-label">Target Version Compatibility</div>
              <p className="mt-1 text-xs text-zinc-400">
                Choose the target version for your collaborator. Version header 0xC7 and expanded playlist clip records will be safely adapted.
              </p>

              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {TARGET_VERSIONS.map((target) => {
                  const isSelected = selectedTarget === target.key;
                  return (
                    <button
                      key={target.key}
                      type="button"
                      onClick={() => setSelectedTarget(target.key)}
                      className={`flex flex-col rounded-xl border p-3.5 text-left transition-all ${
                        isSelected
                          ? "border-violet-500/80 bg-violet-500/10 shadow-[0_0_20px_rgba(139,92,246,0.15)]"
                          : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${isSelected ? "text-violet-300" : "text-white"}`}>
                          {target.label}
                        </span>
                        <span className="text-[10px] text-zinc-500">{target.versionString}</span>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                        {target.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Action Bar */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-5">
              <div className="text-xs text-zinc-400">
                Non-destructive downgrade preserves all audio tracks, MIDI, automations, and channel routing.
              </div>

              <button
                type="button"
                disabled={converting}
                onClick={handleDowngrade}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:brightness-110 disabled:opacity-50"
              >
                {converting ? (
                  <>
                    <LoaderCircle size={15} className="animate-spin" />
                    Downgrading project...
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    Downgrade to FL Studio {selectedTarget}
                    <ArrowRight size={14} />
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
                  </h4>
                  <p className="text-xs text-emerald-300/80">
                    Processed {convertResult.eventsCount} events
                    {convertResult.recordsAdjusted > 0 &&
                      ` and aligned ${convertResult.recordsAdjusted} playlist records`}
                    . Ready to open in FL Studio {convertResult.targetProfile}!
                  </p>
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

            <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3 font-mono text-[11px] text-zinc-300 break-all">
              {convertResult.outputPath}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
