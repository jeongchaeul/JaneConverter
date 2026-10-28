import {
  Paintbrush,
  Palette,
  Pipette,
  RotateCcw,
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

export function SettingsThemeTab({
  accentColor,
  bgColor,
  onAccentColorChange,
  onBgColorChange,
  onResetColors,
  onStatus,
}: {
  accentColor: string;
  bgColor: string;
  onAccentColorChange?: (color: string) => void;
  onBgColorChange?: (color: string) => void;
  onResetColors?: () => void;
  onStatus: (msg: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        <Palette className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
        Appearance &amp; Visual Theme
      </div>

      <section className="panel p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Palette size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              Interface Theme &amp; Color Palette
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Personalize JaneConverter in real-time. Pick custom accent &amp; background colors or choose preset styles.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onResetColors?.();
              onStatus("Theme colors reset to default palette.");
            }}
            className="subtle-button flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 hover:text-white"
            title="Reset accent and background to default"
          >
            <RotateCcw className="size-3" /> Reset colors
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-white/[0.06]">
          {/* Accent Color Customizer */}
          <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5">
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
          </div>

          {/* Main Theme Color (Background) Customizer */}
          <div className="rounded-xl border border-white/[0.06] bg-black/10 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                <Paintbrush className="size-3.5 text-zinc-400" />
                Main Theme Color (Background)
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
          </div>
        </div>
      </section>
    </div>
  );
}
