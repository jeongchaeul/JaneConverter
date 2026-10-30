import {
  ChevronDown,
  Cpu,
  FolderOpen,
  RotateCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type { ConverterSettings, RuntimeInfo } from "../../bridge";
import { bridge } from "../../bridge";

export function SettingsHardwareTab({
  settings,
  onSettings,
  runtime,
  dataRootPath,
  setDataRootPath,
  changingDataRoot,
  relaunching,
  toggleAdaptiveGpu,
  chooseDataRoot,
  changeDataRoot,
  relaunch,
}: {
  settings?: ConverterSettings;
  onSettings?: (next: ConverterSettings) => void;
  runtime: RuntimeInfo | null;
  dataRootPath: string;
  setDataRootPath: (path: string) => void;
  changingDataRoot: boolean;
  relaunching: boolean;
  toggleAdaptiveGpu: () => void;
  chooseDataRoot: () => Promise<void>;
  changeDataRoot: () => Promise<void>;
  relaunch: () => Promise<void>;
}) {
  const gpuEnabled = settings?.useGpu !== false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        <Zap className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
        Hardware Acceleration &amp; Storage
      </div>

      {/* Adaptive GPU Acceleration */}
      <section className="panel space-y-4 p-5" aria-labelledby="adaptive-gpu-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Zap size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="adaptive-gpu-heading">Adaptive GPU Acceleration</span>
              <span
                className={
                  "rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase " +
                  (gpuEnabled
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "border-white/[0.10] bg-white/[0.03] text-zinc-400")
                }
              >
                {gpuEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              Universal hardware acceleration for <strong className="text-zinc-200">{runtime?.gpuLabel || "your GPU"}</strong>. Automatically speeds up conversion with NVENC / AMF / Quick Sync and falls back to CPU when appropriate.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={gpuEnabled}
            aria-label="Adaptive GPU Acceleration"
            disabled={!settings || !onSettings}
            onClick={toggleAdaptiveGpu}
            className={
              "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
              (gpuEnabled
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                : "subtle-button text-zinc-200")
            }
          >
            <Zap className={"size-3.5 " + (gpuEnabled ? "text-emerald-300" : "text-zinc-400")} />
            {gpuEnabled ? "Adaptive GPU Active" : "Enable Adaptive GPU"}
          </button>
        </div>

        <details className="group border-t border-white/[0.06] pt-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors list-none select-none">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180 text-zinc-500" />
            <span>View GPU acceleration details and safety net</span>
          </summary>
          <div className="mt-3 grid gap-2.5 md:grid-cols-3">
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                <Zap className="size-3.5 shrink-0" /> 1. Speeds up video encoding
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                Uses your GPU encoder when converting or resizing videos into <span className="font-mono text-zinc-300">MP4</span>, <span className="font-mono text-zinc-300">MKV</span>, or <span className="font-mono text-zinc-300">MOV</span>.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-sky-300">
                <Cpu className="size-3.5 shrink-0" /> 2. Skips when not needed
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                Automatically bypasses the GPU for <strong className="text-zinc-300">Preserve Quality (Source)</strong>, audio (<span className="font-mono text-zinc-300">MP3</span>, <span className="font-mono text-zinc-300">FLAC</span>), and images so original audio/pixel fidelity is uncompressed.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                <ShieldCheck className="size-3.5 shrink-0" /> 3. Automatic CPU safety net
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                If a video uses an unusual format that the GPU rejects, JaneConverter automatically switches to multi-core CPU so the conversion still finishes cleanly.
              </p>
            </div>
          </div>
        </details>
      </section>

      {/* Application Data Folder */}
      <section className="panel p-5">
        <div className="flex items-center gap-2 text-sm text-zinc-200">
          <FolderOpen size={16} className="text-zinc-500" /> Application Data Folder
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          Choose where JaneConverter keeps its settings, captured media, and converted-library defaults. Existing files stay where they are; the application relaunches after applying.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            aria-label="Application data folder"
            value={dataRootPath}
            onChange={(event) => setDataRootPath(event.target.value)}
            className="field min-w-0 flex-1 px-3 py-2 text-xs"
          />
          <button type="button" className="subtle-button px-3 text-xs" onClick={() => void chooseDataRoot()}>
            Browse
          </button>
          <button
            type="button"
            disabled={changingDataRoot}
            className="primary-button flex items-center gap-2 px-3 text-xs disabled:cursor-wait disabled:opacity-60"
            onClick={() => void changeDataRoot()}
          >
            <FolderOpen className={"size-3.5 " + (changingDataRoot ? "animate-pulse" : "")} />
            {changingDataRoot ? "Applying..." : "Apply and relaunch"}
          </button>
        </div>
      </section>

      {/* Temporary Scratch Folder */}
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-zinc-200">
            <FolderOpen size={16} className="text-zinc-500" /> Temporary Scratch Folder
          </div>
          <span className="text-[10px] text-zinc-500">Staging buffer before external drive write</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          Choose a fast directory (such as a local SSD/NVMe drive) for staging bulk downloads and photo processing before sequentially transferring them to your primary library folder. Eliminates severe bottlenecks when downloading directly to external USB drives.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            aria-label="Temporary scratch folder"
            placeholder="Default: Project-local temp folder"
            value={settings?.tempDir || ""}
            onChange={(event) => {
              if (settings && onSettings) {
                onSettings({ ...settings, tempDir: event.target.value });
              }
            }}
            className="field min-w-0 flex-1 px-3 py-2 text-xs"
          />
          <button
            type="button"
            className="subtle-button px-3 text-xs"
            onClick={async () => {
              const path = await bridge.chooseFolder();
              if (path && settings && onSettings) {
                onSettings({ ...settings, tempDir: path });
              }
            }}
          >
            Browse
          </button>
          {settings?.tempDir ? (
            <button
              type="button"
              className="subtle-button px-3 text-xs text-zinc-400 hover:text-zinc-200"
              onClick={() => {
                if (settings && onSettings) {
                  onSettings({ ...settings, tempDir: "" });
                }
              }}
            >
              Reset
            </button>
          ) : null}
          {settings?.tempDir ? (
            <button
              type="button"
              className="subtle-button px-3 text-xs"
              onClick={() => {
                if (settings?.tempDir) {
                  void bridge.openPath(settings.tempDir);
                }
              }}
            >
              Open
            </button>
          ) : null}
        </div>
      </section>

      {/* Relaunch JaneConverter */}
      <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="text-sm font-medium text-zinc-200">Relaunch JaneConverter</div>
          <div className="mt-1 text-xs text-zinc-500">Restart the current desktop application to apply system changes.</div>
        </div>
        <button
          type="button"
          disabled={relaunching}
          onClick={() => void relaunch()}
          className="subtle-button flex items-center gap-2 px-4 py-2 text-xs disabled:cursor-wait disabled:opacity-60"
        >
          <RotateCw className={"size-3.5 " + (relaunching ? "animate-spin" : "")} />
          {relaunching ? "Relaunching..." : "Relaunch now"}
        </button>
      </section>
    </div>
  );
}
