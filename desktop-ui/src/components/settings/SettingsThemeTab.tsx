import { useRef, useState } from "react";
import {
  Check,
  Image as ImageIcon,
  Paintbrush,
  Palette,
  Pipette,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

export const ACCENT_PRESETS = [
  { name: "Hot Pink (Default)", hex: "#c52b68" },
  { name: "Neon Rose", hex: "#f43f5e" },
  { name: "Electric Purple", hex: "#8b5cf6" },
  { name: "Cyber Cyan", hex: "#06b6d4" },
  { name: "Sky Blue", hex: "#3b82f6" },
  { name: "Emerald Green", hex: "#10b981" },
  { name: "Amber Gold", hex: "#f59e0b" },
  { name: "Sunset Coral", hex: "#f97316" },
];

export const BG_PRESETS = [
  { name: "Void Black (Default)", hex: "#02000a" },
  { name: "Deep Obsidian", hex: "#09090b" },
  { name: "Midnight Navy", hex: "#0b0f17" },
  { name: "Abyssal Plum", hex: "#12071a" },
  { name: "Rosy Pearl (Light)", hex: "#fdf7fa" },
  { name: "Pure White", hex: "#ffffff" },
  { name: "Soft Zinc", hex: "#f4f4f5" },
  { name: "Warm Cream", hex: "#faf8f5" },
];

export const MASK_PRESETS = [
  { name: "Pure Black (Default)", hex: "#000000" },
  { name: "Deep Obsidian", hex: "#09090b" },
  { name: "Deep Plum", hex: "#12071a" },
  { name: "Midnight Navy", hex: "#070b19" },
  { name: "Rose Noir", hex: "#200614" },
  { name: "Forest Shadow", hex: "#04140d" },
  { name: "Frost White", hex: "#ffffff" },
];

export const SIDEBAR_PRESETS = [
  { name: "Studio Obsidian (Default)", hex: "#05040d" },
  { name: "Void Black", hex: "#000000" },
  { name: "Deep Navy", hex: "#070b19" },
  { name: "Deep Plum", hex: "#12071a" },
  { name: "Rose Noir", hex: "#200614" },
  { name: "Forest Shadow", hex: "#04140d" },
  { name: "Slate Glass", hex: "#0f172a" },
  { name: "Frost White", hex: "#ffffff" },
];

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

export const PRESET_WALLPAPERS = [
  {
    id: "cyber-studio",
    name: "Cyber Studio",
    dataUrl: svgDataUrl(`
      <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' width='100%' height='100%'>
        <defs>
          <linearGradient id='g1' x1='0%' y1='0%' x2='100%' y2='100%'>
            <stop offset='0%' stop-color='#0e041c'/>
            <stop offset='50%' stop-color='#26073b'/>
            <stop offset='100%' stop-color='#05000d'/>
          </linearGradient>
          <radialGradient id='g2' cx='25%' cy='35%' r='50%'>
            <stop offset='0%' stop-color='#c52b68' stop-opacity='0.45'/>
            <stop offset='100%' stop-color='#c52b68' stop-opacity='0'/>
          </radialGradient>
          <radialGradient id='g3' cx='75%' cy='65%' r='55%'>
            <stop offset='0%' stop-color='#8b5cf6' stop-opacity='0.38'/>
            <stop offset='100%' stop-color='#8b5cf6' stop-opacity='0'/>
          </radialGradient>
        </defs>
        <rect width='1920' height='1080' fill='url(#g1)'/>
        <circle cx='480' cy='380' r='600' fill='url(#g2)'/>
        <circle cx='1440' cy='700' r='750' fill='url(#g3)'/>
      </svg>
    `),
  },
  {
    id: "deep-nebula",
    name: "Deep Nebula",
    dataUrl: svgDataUrl(`
      <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' width='100%' height='100%'>
        <defs>
          <linearGradient id='bg' x1='0%' y1='0%' x2='100%' y2='100%'>
            <stop offset='0%' stop-color='#02000d'/>
            <stop offset='100%' stop-color='#060a1f'/>
          </linearGradient>
          <radialGradient id='glow1' cx='30%' cy='20%' r='60%'>
            <stop offset='0%' stop-color='#4f46e5' stop-opacity='0.4'/>
            <stop offset='100%' stop-color='#4f46e5' stop-opacity='0'/>
          </radialGradient>
          <radialGradient id='glow2' cx='70%' cy='80%' r='50%'>
            <stop offset='0%' stop-color='#06b6d4' stop-opacity='0.35'/>
            <stop offset='100%' stop-color='#06b6d4' stop-opacity='0'/>
          </radialGradient>
        </defs>
        <rect width='1920' height='1080' fill='url(#bg)'/>
        <rect width='1920' height='1080' fill='url(#glow1)'/>
        <rect width='1920' height='1080' fill='url(#glow2)'/>
      </svg>
    `),
  },
  {
    id: "sunset-horizon",
    name: "Sunset Horizon",
    dataUrl: svgDataUrl(`
      <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' width='100%' height='100%'>
        <defs>
          <linearGradient id='sky' x1='50%' y1='0%' x2='50%' y2='100%'>
            <stop offset='0%' stop-color='#0b0217'/>
            <stop offset='40%' stop-color='#3b0728'/>
            <stop offset='75%' stop-color='#831843'/>
            <stop offset='100%' stop-color='#d97706'/>
          </linearGradient>
          <radialGradient id='sun' cx='50%' cy='85%' r='40%'>
            <stop offset='0%' stop-color='#fbbf24' stop-opacity='0.5'/>
            <stop offset='100%' stop-color='#fbbf24' stop-opacity='0'/>
          </radialGradient>
        </defs>
        <rect width='1920' height='1080' fill='url(#sky)'/>
        <rect width='1920' height='1080' fill='url(#sun)'/>
      </svg>
    `),
  },
  {
    id: "aurora-nocturne",
    name: "Emerald Aurora",
    dataUrl: svgDataUrl(`
      <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' width='100%' height='100%'>
        <defs>
          <linearGradient id='auroraBg' x1='0%' y1='0%' x2='100%' y2='100%'>
            <stop offset='0%' stop-color='#010d0e'/>
            <stop offset='50%' stop-color='#042124'/>
            <stop offset='100%' stop-color='#01070e'/>
          </linearGradient>
          <radialGradient id='greenGlow' cx='40%' cy='30%' r='55%'>
            <stop offset='0%' stop-color='#10b981' stop-opacity='0.4'/>
            <stop offset='100%' stop-color='#10b981' stop-opacity='0'/>
          </radialGradient>
          <radialGradient id='cyanGlow' cx='80%' cy='60%' r='50%'>
            <stop offset='0%' stop-color='#06b6d4' stop-opacity='0.3'/>
            <stop offset='100%' stop-color='#06b6d4' stop-opacity='0'/>
          </radialGradient>
        </defs>
        <rect width='1920' height='1080' fill='url(#auroraBg)'/>
        <rect width='1920' height='1080' fill='url(#greenGlow)'/>
        <rect width='1920' height='1080' fill='url(#cyanGlow)'/>
      </svg>
    `),
  },
  {
    id: "obsidian-mesh",
    name: "Obsidian Minimal",
    dataUrl: svgDataUrl(`
      <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' width='100%' height='100%'>
        <defs>
          <linearGradient id='darkMesh' x1='0%' y1='0%' x2='100%' y2='100%'>
            <stop offset='0%' stop-color='#09090c'/>
            <stop offset='100%' stop-color='#14131d'/>
          </linearGradient>
          <pattern id='grid' width='60' height='60' patternUnits='userSpaceOnUse'>
            <path d='M 60 0 L 0 0 0 60' fill='none' stroke='rgba(255,255,255,0.04)' stroke-width='1'/>
          </pattern>
        </defs>
        <rect width='1920' height='1080' fill='url(#darkMesh)'/>
        <rect width='1920' height='1080' fill='url(#grid)'/>
      </svg>
    `),
  },
];

export function SettingsThemeTab({
  accentColor,
  bgColor,
  bgMode = "color",
  wallpaper = "",
  wallpaperBlur = 20,
  wallpaperMaskColor = "#000000",
  wallpaperMaskOpacity = 50,
  sidebarColor = "#05040d",
  sidebarOpacity = 45,
  onAccentColorChange,
  onBgColorChange,
  onBgModeChange,
  onWallpaperChange,
  onWallpaperBlurChange,
  onWallpaperMaskColorChange,
  onWallpaperMaskOpacityChange,
  onSidebarColorChange,
  onSidebarOpacityChange,
  onResetColors,
  onResetAppearance,
  onSaveAppearance,
  onStatus,
}: {
  accentColor: string;
  bgColor: string;
  bgMode?: "color" | "wallpaper";
  wallpaper?: string;
  wallpaperBlur?: number;
  wallpaperMaskColor?: string;
  wallpaperMaskOpacity?: number;
  sidebarColor?: string;
  sidebarOpacity?: number;
  onAccentColorChange?: (color: string) => void;
  onBgColorChange?: (color: string) => void;
  onBgModeChange?: (mode: "color" | "wallpaper") => void;
  onWallpaperChange?: (url: string) => void;
  onWallpaperBlurChange?: (blur: number) => void;
  onWallpaperMaskColorChange?: (color: string) => void;
  onWallpaperMaskOpacityChange?: (opacity: number) => void;
  onSidebarColorChange?: (color: string) => void;
  onSidebarOpacityChange?: (opacity: number) => void;
  onResetColors?: () => void;
  onResetAppearance?: () => void;
  onSaveAppearance?: () => void;
  onStatus: (msg: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);

  function handleSave() {
    onSaveAppearance?.();
    setSavedRecently(true);
    onStatus("Appearance settings saved successfully.");
    setTimeout(() => {
      setSavedRecently(false);
    }, 2000);
  }

  function handleFileSelected(file: File) {
    if (!file.type.startsWith("image/")) {
      onStatus("Please select an image file (PNG, JPG, WebP, GIF, or BMP).");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawData = e.target?.result as string;
      if (!rawData) return;

      const img = new Image();
      img.onload = () => {
        const maxDim = 1920;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          let optimized = canvas.toDataURL("image/webp", 0.88);
          if (!optimized.startsWith("data:image/webp")) {
            optimized = canvas.toDataURL("image/jpeg", 0.88);
          }
          onWallpaperChange?.(optimized);
          onBgModeChange?.("wallpaper");
          onStatus(`Loaded custom wallpaper: ${file.name}`);
        } else {
          onWallpaperChange?.(rawData);
          onBgModeChange?.("wallpaper");
          onStatus(`Loaded custom wallpaper: ${file.name}`);
        }
      };
      img.onerror = () => {
        onWallpaperChange?.(rawData);
        onBgModeChange?.("wallpaper");
        onStatus(`Loaded custom wallpaper: ${file.name}`);
      };
      img.src = rawData;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        <Palette className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
        Appearance &amp; Visual Theme
      </div>

      <section className="panel p-5 space-y-4">
        {/* Top Header with Save and Reset Appearance buttons */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Palette size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              Interface Theme &amp; Background
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Personalize JaneConverter in real-time. Choose solid background palettes or load a custom wallpaper with adjustable blur and color mask.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="primary-button flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all"
              title="Save current appearance settings and wallpaper"
            >
              {savedRecently ? (
                <>
                  <Check className="size-3 text-emerald-300" /> Saved!
                </>
              ) : (
                <>
                  <Save className="size-3" /> Save Appearance
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                const resetFn = onResetAppearance ?? onResetColors;
                resetFn?.();
                onStatus("Appearance settings reset to default.");
              }}
              className="subtle-button flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 hover:text-white"
              title="Reset accent, background, wallpaper, and blur to default"
            >
              <RotateCcw className="size-3" /> Reset Appearance
            </button>
          </div>
        </div>

        {/* Mode Selector: Solid Colors vs Wallpaper */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/[0.08] w-fit">
          <button
            type="button"
            onClick={() => {
              onBgModeChange?.("color");
              onStatus("Switched background style to solid colors.");
            }}
            aria-pressed={bgMode === "color"}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              bgMode === "color"
                ? "bg-white/[0.14] text-white shadow-sm font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
            }`}
          >
            <Paintbrush size={13} />
            Solid Colors
          </button>
          <button
            type="button"
            onClick={() => {
              onBgModeChange?.("wallpaper");
              if (!wallpaper) {
                onWallpaperChange?.(PRESET_WALLPAPERS[0].dataUrl);
              }
              onStatus("Switched background style to custom wallpaper.");
            }}
            aria-pressed={bgMode === "wallpaper"}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              bgMode === "wallpaper"
                ? "bg-white/[0.14] text-white shadow-sm font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
            }`}
          >
            <ImageIcon size={13} />
            Wallpaper
          </button>
        </div>

        {/* Content Matrix: Accent Color on Left, and Sidebar Glass Pane on Right */}
        <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-white/[0.06]">
          {/* Accent Color Customizer (always visible in both modes) */}
          <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5 flex flex-col justify-start">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                <Pipette className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
                Accent Color
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Accent color picker"
                  value={accentColor}
                  onChange={(event) => onAccentColorChange?.(event.target.value)}
                  className="size-7 cursor-pointer rounded-lg border border-white/20 bg-transparent p-0.5"
                />
                <span className="font-mono text-xs uppercase text-zinc-400">{accentColor}</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {ACCENT_PRESETS.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  onClick={() => onAccentColorChange?.(swatch.hex)}
                  title={swatch.name}
                  className={`size-6 rounded-lg transition-transform hover:scale-110 relative ${
                    accentColor.toLowerCase() === swatch.hex.toLowerCase()
                      ? "ring-2 ring-white ring-offset-2 ring-offset-black scale-105"
                      : "border border-white/10"
                  }`}
                  style={{ backgroundColor: swatch.hex }}
                />
              ))}
            </div>
            <div className="mt-3 text-[11px] text-zinc-500">
              Accent highlight applies to progress bars, interactive buttons, active tabs, and neon audio badges.
            </div>
          </div>

          {/* Sidebar Glass Pane Customizer */}
          <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5 flex flex-col justify-start space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                <Pipette className="size-3.5 text-zinc-400" />
                Sidebar Glass Tint
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Sidebar glass color picker"
                  value={sidebarColor}
                  onChange={(event) => onSidebarColorChange?.(event.target.value)}
                  className="size-7 cursor-pointer rounded-lg border border-white/20 bg-transparent p-0.5"
                />
                <span className="font-mono text-xs uppercase text-zinc-400">{sidebarColor}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {SIDEBAR_PRESETS.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  onClick={() => onSidebarColorChange?.(swatch.hex)}
                  title={swatch.name}
                  className={`size-6 rounded-lg transition-transform hover:scale-110 relative ${
                    sidebarColor.toLowerCase() === swatch.hex.toLowerCase()
                      ? "ring-2 ring-white ring-offset-2 ring-offset-black scale-105"
                      : "border border-white/10"
                  }`}
                  style={{ backgroundColor: swatch.hex }}
                />
              ))}
            </div>

            {/* Sidebar Opacity Slider (0% to 100%) */}
            <div className="space-y-2 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <Sliders className="size-3" style={{ color: "var(--accent-color, #c52b68)" }} />
                  Sidebar Opacity
                </div>
                <span className="font-mono text-xs font-bold text-zinc-200 rounded bg-white/[0.08] px-2 py-0.5 border border-white/10">
                  {sidebarOpacity}%
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sidebarOpacity}
                onChange={(e) => onSidebarOpacityChange?.(Number(e.target.value))}
                aria-label="Sidebar opacity slider"
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/[0.1] accent-[var(--accent-color,#c52b68)]"
              />

              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>0% (Transparent)</span>
                <span>45% (Balanced Glass)</span>
                <span>100% (Solid)</span>
              </div>
            </div>
            <div className="text-[11px] text-zinc-500">
              Frosted glass veil on the left navigation sidebar. Lower opacity allows wallpaper and ambient lighting to softly diffuse through.
            </div>
          </div>
        </div>

        {/* Background Style: Solid Color or Wallpaper */}
        <div className="pt-2 border-t border-white/[0.06]">
          {/* Mode 1: Solid Colors Customizer */}
          {bgMode === "color" ? (
            <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5 flex flex-col justify-start">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                  <Paintbrush className="size-3.5 text-zinc-400" />
                  Solid Background Color
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Theme background color picker"
                    value={bgColor}
                    onChange={(event) => onBgColorChange?.(event.target.value)}
                    className="size-7 cursor-pointer rounded-lg border border-white/20 bg-transparent p-0.5"
                  />
                  <span className="font-mono text-xs uppercase text-zinc-400">{bgColor}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {BG_PRESETS.map((swatch) => (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => onBgColorChange?.(swatch.hex)}
                    title={swatch.name}
                    className={`size-6 rounded-lg transition-transform hover:scale-110 relative ${
                      bgColor.toLowerCase() === swatch.hex.toLowerCase()
                        ? "ring-2 ring-white ring-offset-2 ring-offset-black scale-105"
                        : "border border-white/10"
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  />
                ))}
              </div>
              <div className="mt-3 text-[11px] text-zinc-500">
                Choose a dark or light foundation tone. Custom wallpaper mode can be enabled anytime above.
              </div>
            </div>
          ) : (
            /* Mode 2: Wallpaper Image & Controls (Upload, Presets, Blur Slider, Color Mask & Opacity Slider) */
            <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                  <ImageIcon className="size-3.5 text-zinc-400" />
                  Custom Wallpaper Image
                </div>
                {wallpaper && (
                  <button
                    type="button"
                    onClick={() => {
                      onWallpaperChange?.("");
                      onBgModeChange?.("color");
                      onStatus("Wallpaper removed. Reverted to solid colors.");
                    }}
                    className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 transition-colors"
                    title="Remove custom wallpaper and return to solid colors"
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                )}
              </div>

              {/* Upload Drop Zone & Browse Trigger */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelected(file);
                }}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileSelected(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center cursor-pointer transition-all ${
                  isDragging
                    ? "border-[var(--accent-color,#c52b68)] bg-white/[0.06]"
                    : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]"
                }`}
              >
                <div className="grid size-9 place-items-center rounded-lg border border-white/10 bg-black/40 text-zinc-400">
                  <Upload size={16} />
                </div>
                <div className="mt-2 text-xs font-semibold text-zinc-200">
                  Choose a Wallpaper Image
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  Drop image here or click to browse (PNG, JPG, WebP)
                </div>
              </div>

              {/* Preset Wallpapers */}
              <div>
                <div className="text-[11px] font-medium text-zinc-400 mb-2">
                  Or select a curated preset:
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {PRESET_WALLPAPERS.map((preset) => {
                    const isSelected = wallpaper === preset.dataUrl;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          onWallpaperChange?.(preset.dataUrl);
                          onBgModeChange?.("wallpaper");
                          onStatus(`Applied preset wallpaper: ${preset.name}`);
                        }}
                        title={preset.name}
                        className={`group relative aspect-video overflow-hidden rounded-lg border transition-all hover:scale-105 ${
                          isSelected
                            ? "border-[var(--accent-color,#c52b68)] ring-2 ring-[var(--accent-color,#c52b68)]/50"
                            : "border-white/10 opacity-75 hover:opacity-100"
                        }`}
                      >
                        <img
                          src={preset.dataUrl}
                          alt={preset.name}
                          className="size-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-[9px] font-mono font-medium text-white px-1 py-0.5 rounded bg-black/60 backdrop-blur-sm">
                            {preset.name.split(" ")[0]}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Wallpaper Blur Effect Slider (0% to 100%) */}
              <div className="pt-2 border-t border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                    <Sliders className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
                    Blur Effect
                  </div>
                  <span className="font-mono text-xs font-bold text-zinc-200 rounded bg-white/[0.08] px-2 py-0.5 border border-white/10">
                    {wallpaperBlur}%
                  </span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={wallpaperBlur}
                  onChange={(e) => onWallpaperBlurChange?.(Number(e.target.value))}
                  aria-label="Wallpaper blur slider"
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/[0.1] accent-[var(--accent-color,#c52b68)]"
                />

                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>0% (Sharp)</span>
                  <span>50% (Soft Blur)</span>
                  <span>100% (Ambient Diffusion)</span>
                </div>
              </div>

              {/* Color Mask Overlay & Opacity Slider */}
              <div className="pt-2 border-t border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                    <Pipette className="size-3.5 text-zinc-400" />
                    Color Mask Overlay
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Color mask picker"
                      value={wallpaperMaskColor}
                      onChange={(e) => onWallpaperMaskColorChange?.(e.target.value)}
                      className="size-6 cursor-pointer rounded-lg border border-white/20 bg-transparent p-0.5"
                    />
                    <span className="font-mono text-xs uppercase text-zinc-400">{wallpaperMaskColor}</span>
                  </div>
                </div>

                {/* Mask Color Swatches */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {MASK_PRESETS.map((swatch) => (
                    <button
                      key={swatch.hex}
                      type="button"
                      onClick={() => onWallpaperMaskColorChange?.(swatch.hex)}
                      title={swatch.name}
                      className={`size-5 rounded-md transition-transform hover:scale-110 relative ${
                        wallpaperMaskColor.toLowerCase() === swatch.hex.toLowerCase()
                          ? "ring-2 ring-white ring-offset-2 ring-offset-black scale-105"
                          : "border border-white/10"
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                    />
                  ))}
                </div>

                {/* Mask Opacity Slider (0% to 100%) */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                      <Sliders className="size-3" style={{ color: "var(--accent-color, #c52b68)" }} />
                      Mask Opacity
                    </div>
                    <span className="font-mono text-xs font-bold text-zinc-200 rounded bg-white/[0.08] px-2 py-0.5 border border-white/10">
                      {wallpaperMaskOpacity}%
                    </span>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={wallpaperMaskOpacity}
                    onChange={(e) => onWallpaperMaskOpacityChange?.(Number(e.target.value))}
                    aria-label="Color mask opacity slider"
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/[0.1] accent-[var(--accent-color,#c52b68)]"
                  />

                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                    <span>0% (Raw Image)</span>
                    <span>50% (Balanced Tint)</span>
                    <span>100% (Solid Mask)</span>
                  </div>
                </div>
              </div>

              {/* Live Miniature Preview Card */}
              {wallpaper && (
                <div className="pt-2 border-t border-white/[0.06]">
                  <div className="text-[11px] font-medium text-zinc-400 mb-1.5 flex items-center justify-between">
                    <span>Live Blend Preview</span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      Blur: {wallpaperBlur}% • Mask: {wallpaperMaskOpacity}%
                    </span>
                  </div>
                  <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 shadow-inner">
                    <div
                      className="absolute inset-0 bg-cover bg-center transition-all duration-150"
                      style={{
                        backgroundImage: `url(${wallpaper})`,
                        filter: `blur(${Math.round((wallpaperBlur / 100) * 16)}px)`,
                        transform: wallpaperBlur > 0 ? "scale(1.08)" : "scale(1)",
                      }}
                    />
                    <div
                      className="absolute inset-0 transition-all duration-150"
                      style={{
                        backgroundColor: wallpaperMaskColor,
                        opacity: wallpaperMaskOpacity / 100,
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-center backdrop-blur-md">
                        <div className="text-xs font-semibold text-white">JaneConverter</div>
                        <div className="text-[9px] text-zinc-400">Glassmorphism UI</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
