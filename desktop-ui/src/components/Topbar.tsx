import { useEffect, useState } from "react";
import { CircleHelp, Copy, Cpu, HardDrive, Minus, Square, X } from "lucide-react";
import { bridge, type RuntimeInfo } from "../bridge";

export function Topbar({ runtime }: { runtime: RuntimeInfo | null }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    bridge.windowIsMaximized().then((max) => {
      if (mounted) setIsMaximized(max);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [helpOpen]);

  async function handleMinimize() {
    await bridge.windowMinimize();
  }

  async function handleToggleMaximize() {
    const next = await bridge.windowToggleMaximize();
    setIsMaximized(next);
  }

  async function handleClose() {
    await bridge.windowClose();
  }

  function handleMouseDown(e: React.MouseEvent) {
    // Only drag on primary left click
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Don't drag if clicking buttons or interactive elements
    if (target?.closest("button") || target?.closest("input") || target?.closest("a")) return;

    // Double-click on header toggles maximize
    if (e.detail === 2) {
      void handleToggleMaximize();
      return;
    }

    void bridge.windowStartDragging();
  }

  return (
    <>
      <header
        data-tauri-drag-region
        onMouseDown={handleMouseDown}
        className="relative z-30 flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] bg-black/30 px-3 backdrop-blur-md select-none cursor-default"
      >
        {/* Brand & Window Title (Draggable) */}
        <div data-tauri-drag-region className="flex items-center gap-2.5">
          <div className="grid size-4 place-items-center rounded-md border border-white/10 bg-[#11101b]">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: "var(--accent-color, #c52b68)", boxShadow: "0 0 8px var(--accent-glow, rgba(197,43,104,.55))" }}
            />
          </div>
          <span className="text-xs font-semibold tracking-tight text-zinc-300">JaneConverter Desktop</span>
          <span className="mono-label text-[10px] text-zinc-600 hidden sm:inline">v2.3.5</span>
        </div>

        {/* Central Drag Region */}
        <div
          data-tauri-drag-region
          className="flex-1 h-full"
        />

        {/* System Badges, Help & Custom Window Controls */}
        <div className="flex items-center gap-2">
          {/* Runtime Status Badges */}
          <div className="hidden items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-0.5 text-[10px] text-zinc-400 xl:flex">
            <span className={`size-1.5 rounded-full ${runtime?.mode === "tauri" ? "bg-emerald-400" : "bg-amber-400"}`} />
            {runtime?.mode === "tauri" ? "Native shell" : "Preview mode"}
          </div>
          {runtime && (
            <div className="hidden items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-0.5 text-[10px] text-zinc-400 lg:flex">
              <HardDrive className="size-3" /> {runtime.ffmpegReady ? "FFmpeg ready" : "FFmpeg missing"}
            </div>
          )}
          {runtime && (
            <div className="hidden items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-0.5 text-[10px] text-zinc-400 lg:flex">
              <Cpu className="size-3" /> {runtime.gpuAvailable ? runtime.gpuLabel.split(" ")[0] : "CPU"}
            </div>
          )}

          {/* Quick Help Dialog Trigger */}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="grid size-6 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-[#3b82f6]"
            aria-label="JaneConverter help"
            aria-expanded={helpOpen}
            title="Open JaneConverter help"
          >
            <CircleHelp className="size-3.5" />
          </button>

          {/* Divider */}
          <div className="h-4 w-px bg-white/10 mx-1" />

          {/* Window Control Buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void handleMinimize()}
              className="grid size-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-[#3b82f6]"
              aria-label="Minimize"
              title="Minimize"
            >
              <Minus className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => void handleToggleMaximize()}
              className="grid size-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-[#3b82f6]"
              aria-label={isMaximized ? "Restore" : "Maximize"}
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? <Copy className="size-2.5 rotate-180" /> : <Square className="size-2.5" />}
            </button>
            <button
              type="button"
              onClick={() => void handleClose()}
              className="grid size-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-rose-600 hover:text-white focus-visible:outline-2 focus-visible:outline-[#3b82f6]"
              aria-label="Close"
              title="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* In-app Help Modal */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHelpOpen(false);
          }}
        >
          <section className="panel relative w-full max-w-lg p-6" role="dialog" aria-modal="true" aria-labelledby="janeconverter-help-title">
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              aria-label="Close help"
            >
              <X className="size-4" />
            </button>
            <div className="mono-label">Quick guide</div>
            <h2 id="janeconverter-help-title" className="mt-2 text-xl font-semibold text-white">
              Using JaneConverter
            </h2>
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-zinc-400">
              <p>
                <span className="text-zinc-200 font-medium">Convert:</span> paste a supported public link or choose a local media file, select your output settings, then start the conversion.
              </p>
              <p>
                <span className="text-zinc-200 font-medium">In Progress & Console:</span> track ongoing conversions, inspect live telemetry, and drag finished files directly into your DAW or editor.
              </p>
              <p>
                <span className="text-zinc-200 font-medium">Where are files?</span> Converted media uses the {runtime?.packaged ? "OS user-data directory" : "project-local converted folder"} unless you choose another export folder in Settings.
              </p>
              <p className="border-t border-white/[0.06] pt-2 text-[11px] text-zinc-500">
                <span className="text-zinc-300">Legal & Privacy:</span> 100% local processing with zero telemetry. Complies with DMCA § 1201 (no DRM circumvention). See Settings for the full Legal Handbook.
              </p>
            </div>
            <button type="button" onClick={() => setHelpOpen(false)} className="subtle-button mt-5 px-3 py-2 text-xs">
              Close
            </button>
          </section>
        </div>
      )}
    </>
  );
}
