import { AnimatePresence, motion } from "framer-motion";
import {
  Wand2,
  ShieldCheck,
  FileVideo,
  Clapperboard,
  FileImage,
  Music2,
} from "lucide-react";
import { SelectField, Toggle } from "./FormControls";
import {
  type IntentPreset,
  qualitiesFor,
  videoQualityLabel,
  imageQualityLabel,
  resolutionLabel,
} from "../../options";
import type { ConverterSettings, RuntimeInfo, Category } from "../../bridge";

export interface ParametersPanelProps {
  settings: ConverterSettings;
  runtime?: RuntimeInfo | null;
  presetCategory: Category;
  activeCategory: Category;
  activeFormat: string;
  formats: string[];
  qualities: Array<string | number>;
  resolutions: string[];
  selectedPresetId: string | null;
  visiblePresets: IntentPreset[];
  showAdvanced: boolean;
  setShowAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  applyPreset: (preset: IntentPreset) => void;
  update: (partial: Partial<ConverterSettings>) => void;
  isAudio: boolean;
  isVideo: boolean;
  isImage: boolean;
  isSourceFormat: boolean;
  hardwareAccelerationDisabled: boolean;
}

export function ParametersPanel({
  settings,
  runtime,
  presetCategory,
  activeCategory,
  activeFormat,
  formats,
  qualities,
  resolutions,
  selectedPresetId,
  visiblePresets,
  showAdvanced,
  setShowAdvanced,
  applyPreset,
  update,
  isAudio,
  isVideo,
  isImage,
  isSourceFormat,
  hardwareAccelerationDisabled,
}: ParametersPanelProps) {
  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-zinc-200">Output and conversion presets</div>
          <div className="mt-0.5 text-xs text-zinc-600">Select an intent goal or fine-tune settings below.</div>
        </div>
        <span className="hidden items-center gap-1.5 text-[11px] text-zinc-400 sm:inline-flex">
          <Wand2 className="size-3.5" style={{ color: "var(--accent-color)" }} aria-hidden="true" /> 1-click presets
        </span>
      </div>

      {/* Intent Presets Toolbar */}
      <div className="mt-2.5 overflow-hidden rounded-xl border border-white/[0.08] bg-black/15">
        <div className="grid grid-cols-3 border-b border-white/[0.08]" aria-label="Preset categories">
          {(["Audio", "Video", "Image"] as const).map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={presetCategory === category}
              onClick={() => update({ category })}
              className="preset-category-button min-h-9 border-b-2 border-transparent px-3 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px]"
            >
              {category}
            </button>
          ))}
        </div>
        <div className="grid gap-1.5 p-2 sm:grid-cols-2 lg:grid-cols-3">
          {visiblePresets.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            const Icon =
              preset.id === "preserve-quality"
                ? ShieldCheck
                : preset.id === "universal-video"
                ? FileVideo
                : preset.id === "studio-cinematic"
                ? Clapperboard
                : preset.id === "lossless-image"
                ? FileImage
                : Music2;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => applyPreset(preset)}
                className="preset-choice-button flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-left text-xs text-zinc-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                title={isSelected ? `Unselect ${preset.name} and restore your previous settings` : preset.description}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Primary Controls */}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <SelectField
          label="Container format"
          value={activeFormat}
          values={formats}
          formatValue={(format) =>
            format === "source"
              ? "Source (preserve original)"
              : format === "alac"
              ? "ALAC (M4A container)"
              : String(format).toUpperCase()
          }
          onChange={(format) => update({ format, bitrate: qualitiesFor(format, activeCategory)[0] })}
        />
        <div className="flex items-end">
          <button
            type="button"
            role="switch"
            aria-checked={showAdvanced}
            aria-controls="advanced-conversion-parameters"
            onClick={() => setShowAdvanced((v) => !v)}
            className="advanced-settings-switch inline-flex min-h-9 items-center gap-2 rounded-lg px-1 text-xs text-zinc-300 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2"
          >
            <span
              aria-hidden="true"
              className="advanced-settings-track relative h-5 w-9 rounded-full bg-zinc-700 transition-colors"
            >
              <span
                className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${
                  showAdvanced ? "translate-x-4" : ""
                }`}
              />
            </span>
            Advanced settings
          </button>
        </div>
      </div>

      {/* Collapsible Advanced Parameters */}
      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            id="advanced-conversion-parameters"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <div className="grid gap-2 md:grid-cols-3">
                <SelectField
                  label={isVideo ? "Video quality" : isImage ? "Image quality" : "Audio bitrate / quality"}
                  value={isImage ? "best" : settings.bitrate}
                  values={qualities}
                  formatValue={(v) =>
                    isVideo
                      ? videoQualityLabel(String(v))
                      : isImage
                      ? imageQualityLabel(String(v), activeFormat)
                      : String(v)
                  }
                  onChange={(bitrate) => update({ bitrate })}
                  disabled={isSourceFormat}
                  hint={
                    isSourceFormat
                      ? "Source output keeps the original quality settings."
                      : isVideo
                      ? "Controls compression and file size; resolution is set separately."
                      : undefined
                  }
                />
                <SelectField
                  label="Video resolution"
                  value={settings.resolution}
                  values={resolutions}
                  formatValue={(v) => resolutionLabel(String(v))}
                  onChange={(resolution) => update({ resolution })}
                  disabled={!isVideo || isSourceFormat}
                  hint={
                    !isVideo
                      ? "Available for video output."
                      : isSourceFormat
                      ? "Source output keeps its original dimensions."
                      : undefined
                  }
                />
                <SelectField
                  label="Audio sample rate"
                  value={settings.sampleRate}
                  values={[44100, 48000, 96000]}
                  onChange={(sampleRate) => update({ sampleRate: Number(sampleRate) })}
                  disabled={!isAudio || isSourceFormat}
                  hint={
                    !isAudio
                      ? "Available for audio output."
                      : isSourceFormat
                      ? "Source output keeps its original audio."
                      : undefined
                  }
                />
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <Toggle
                  checked={settings.reconstructFrequencyLoss ?? false}
                  onChange={(reconstructFrequencyLoss) => update({ reconstructFrequencyLoss })}
                  label="Harmonic Exciter (High-End Sparkle)"
                  hint={
                    isAudio
                      ? "Applies an audio exciter filter to synthesize subtle high-frequency air (7.5–20 kHz)"
                      : "Available for audio output."
                  }
                  disabled={!isAudio || isSourceFormat}
                />
                <Toggle
                  checked={settings.normalize}
                  onChange={(normalize) => update({ normalize })}
                  label="EBU R128 normalization"
                  hint={isAudio ? "-14 LUFS streaming target" : "Available for audio output."}
                  disabled={!isAudio || isSourceFormat}
                />
                <Toggle
                  checked={settings.saveCover}
                  onChange={(saveCover) => update({ saveCover })}
                  label="Embed and save cover art"
                  hint={isImage ? "Available for audio and video sources." : "Artwork or thumbnail when available"}
                  disabled={isImage}
                />
                <Toggle
                  checked={settings.saveMetadata}
                  onChange={(saveMetadata) => update({ saveMetadata })}
                  label="Export metadata and credits"
                  hint="Human-readable .txt metadata"
                />
                <Toggle
                  checked={settings.useGpu}
                  onChange={(useGpu) => update({ useGpu })}
                  label="Hardware acceleration"
                  hint={
                    hardwareAccelerationDisabled
                      ? !isVideo || isSourceFormat
                        ? "Available for encoded video output."
                        : activeFormat === "gif"
                        ? "GIF output uses its own frame conversion."
                        : "No supported GPU detected. CPU mode is available."
                      : runtime?.gpuLabel || "Use the available video hardware encoder."
                  }
                  disabled={hardwareAccelerationDisabled}
                />
                <Toggle
                  checked={settings.archivalFallback ?? false}
                  onChange={(archivalFallback) => update({ archivalFallback })}
                  label="Search archival vaults for unavailable media"
                  hint="Index Wayback Machine, Archive.org, Ghostarchive, and Filmot if a video is deleted or private"
                />
              </div>
              {settings.archivalFallback && (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs leading-relaxed text-zinc-300">
                  <div className="font-medium text-amber-300 mb-1 flex items-center gap-1.5">
                    <span>Archival Vault Indexing (Wayback Machine, Archive.org & Ghostarchive)</span>
                  </div>
                  <p className="text-zinc-400">
                    <strong className="text-zinc-200">What it does:</strong> When JaneConverter encounters a deleted,
                    hidden, or private video (standalone or inside a playlist), it initiates a multi-stage archival
                    recovery pipeline: queries historical metadata via Filmot and Wayback Machine CDX, locates raw
                    video/audio files preserved across Internet Archive (ArchiveTeam & YouTube collections), and probes
                    Ghostarchive mirrors.
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Note: Archival recovery depends on whether public internet preservation archives crawled the media
                    before removal.
                  </p>
                </div>
              )}
              {isAudio && settings.reconstructFrequencyLoss && !isSourceFormat && (
                <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/[0.04] p-3 text-xs leading-relaxed text-zinc-300">
                  <div className="font-medium text-purple-300 mb-1 flex items-center gap-1.5">
                    <span>Harmonic Exciter (High-Frequency Sparkle / Studio Air)</span>
                  </div>
                  <p className="text-zinc-400">
                    <strong className="text-zinc-200">What it does:</strong> Lossy platforms (SoundCloud, YouTube,
                    TikTok) often apply steep lowpass filtering around 15–16 kHz. This mode engages FFmpeg's
                    analog-modeled exciter (aexciter) to synthesize subtle upper-harmonic presence starting from 7.5 kHz up
                    to 20 kHz.
                  </p>
                  <p className="mt-1 text-zinc-400">
                    <strong className="text-zinc-200">What to expect:</strong> Restores perceptual brightness, cymbal
                    shimmer, and transient bite to heavily compressed tracks. Note: this enhances psychoacoustic air
                    through harmonic synthesis; it does not uncompressedly recover destroyed spectral data.
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Tip: Great for livening up dull streaming rips. For uncompressed WAV or lossless FLAC masters, keep
                    this toggle off.
                  </p>
                </div>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-2 block text-[11px] font-medium text-zinc-500">
                    Trim start time (optional)
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. 00:15 or 90"
                    value={settings.startTime ?? ""}
                    onChange={(e) => update({ startTime: e.target.value })}
                    className="field w-full px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                  />
                  <span className="mt-1.5 block text-[10px] leading-relaxed text-zinc-600">
                    Start timestamp (HH:MM:SS, MM:SS, or seconds)
                  </span>
                </label>
                <label className="block min-w-0">
                  <span className="mb-2 block text-[11px] font-medium text-zinc-500">
                    Trim end time (optional)
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. 02:45 or 165"
                    value={settings.endTime ?? ""}
                    onChange={(e) => update({ endTime: e.target.value })}
                    className="field w-full px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                  />
                  <span className="mt-1.5 block text-[10px] leading-relaxed text-zinc-600">
                    End timestamp (HH:MM:SS, MM:SS, or seconds)
                  </span>
                </label>
              </div>
              {isImage && isSourceFormat && (
                <div className="mt-3 max-w-md">
                  <Toggle
                    checked={settings.allowPngFallback ?? false}
                    onChange={(allowPngFallback) => update({ allowPngFallback })}
                    label="Allow PNG recovery"
                    hint="If the original image cannot be validated, save a lossless PNG instead and show the format change. The source stays untouched."
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
