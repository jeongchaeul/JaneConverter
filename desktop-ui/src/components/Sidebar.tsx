import { Activity, Cpu, FileAudio, FolderOpen, Inbox, PanelLeftClose, PanelLeftOpen, Settings2, TerminalSquare } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { hexToRgba } from "../utils/appearanceStorage";

export type ViewKey = "converter" | "fetched" | "library" | "hardware" | "console" | "settings";

const workspaceItems: Array<{ key: ViewKey; label: string; icon: typeof FileAudio }> = [
  { key: "converter", label: "Converter", icon: FileAudio },
  { key: "fetched", label: "Media Capturer", icon: Inbox },
  { key: "library", label: "Converted library", icon: FolderOpen },
  { key: "console", label: "In Progress", icon: TerminalSquare },
];

const SIDEBAR_COLLAPSED_KEY = "janecoverter.sidebar.collapsed";

function readCollapsedPreference() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function Sidebar({
  activeView,
  onChange,
  sidebarColor = "#05040d",
  sidebarOpacity = 45,
}: {
  activeView: ViewKey;
  onChange: (view: ViewKey) => void;
  sidebarColor?: string;
  sidebarOpacity?: number;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // The layout remains usable when browser storage is unavailable.
      }
      return next;
    });
  }

  const bgRgba = hexToRgba(sidebarColor, Math.min(100, Math.max(0, sidebarOpacity)) / 100);

  return (
    <motion.aside
      data-collapsed={collapsed}
      animate={{ width: collapsed ? 76 : 232 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      style={{ backgroundColor: bgRgba }}
      className="relative z-10 flex shrink-0 flex-col overflow-hidden border-r border-white/[0.08] px-4 py-5 backdrop-blur-2xl transition-[background-color] duration-200"
    >
      {/* Brand Header */}
      <div className={["flex min-h-9 items-center gap-3", collapsed ? "justify-center" : "justify-start"].join(" ")}>
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#11101b] shadow-[0_8px_24px_rgba(0,0,0,.28)]">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: "var(--accent-color, #c52b68)", boxShadow: "0 0 14px var(--accent-glow, rgba(197,43,104,.55))" }}
          />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight text-white">JaneConverter</div>
            <div className="mono-label mt-1">JANE&apos;S CREATOR TOOLBOX</div>
          </div>
        )}
      </div>

      {/* Primary Workspace Section */}
      {!collapsed && <div className="mono-label mt-10 px-3">Workspace</div>}
      <nav className="mt-3 space-y-1" aria-label="Primary">
        {workspaceItems.map(({ key, label, icon: Icon }) => {
          const active = activeView === key;
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? "page" : undefined}
              aria-label={label}
              title={collapsed ? label : undefined}
              onClick={() => onChange(key)}
              className={[
                "group relative flex w-full items-center rounded-xl py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6]",
                collapsed ? "justify-center px-2" : "gap-3 px-3",
                active ? "text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
              ].join(" ")}
            >
              {active && (
                <motion.span
                  layoutId="active-nav"
                  className="absolute inset-0 rounded-xl border bg-white/[0.05]"
                  style={{ borderColor: "var(--accent-glow, rgba(197,43,104,0.35))" }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon
                className={["relative z-10 size-4", active ? "" : "text-zinc-500 group-hover:text-zinc-300"].join(" ")}
                style={active ? { color: "var(--accent-color, #d75b88)" } : undefined}
                strokeWidth={1.8}
              />
              {!collapsed && <span className="relative z-10 truncate">{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Workspace Note */}
      {!collapsed && (
        <div className="mt-4">
          <div className="mb-3 border-t border-white/[0.08]" />
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 backdrop-blur-md">
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <Activity className="size-3.5 text-zinc-500" /> Project-local workspace
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Media, temporary files, settings, and logs stay beside JaneConverter whenever possible.
            </p>
          </div>
        </div>
      )}

      {/* Flexible Spacer to anchor dock at the bottom */}
      <div className="flex-1" />

      {/* Compressed Utility Dock: Hardware, Settings, Collapse Sidebar */}
      <div
        className={["pt-3", collapsed ? "flex flex-col items-center gap-2" : "flex items-center gap-2"].join(" ")}
        role="toolbar"
        aria-label="System utilities"
      >
        {/* Hardware & Pipeline Button */}
        <button
          type="button"
          aria-current={activeView === "hardware" ? "page" : undefined}
          aria-label="Hardware & Pipeline"
          title="Hardware & Pipeline"
          onClick={() => onChange("hardware")}
          className={[
            "group relative flex items-center justify-center rounded-xl transition-all border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6]",
            collapsed ? "size-10" : "h-11 flex-1",
            activeView === "hardware"
              ? "border-[var(--accent-color,#c52b68)] bg-white/[0.06] text-white shadow-[0_0_12px_var(--accent-glow,rgba(197,43,104,0.35))]"
              : "border-white/[0.08] bg-white/[0.025] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200",
          ].join(" ")}
        >
          <Cpu
            className="size-4"
            style={activeView === "hardware" ? { color: "var(--accent-color, #d75b88)" } : undefined}
            strokeWidth={1.8}
          />
        </button>

        {/* Settings Button */}
        <button
          type="button"
          aria-current={activeView === "settings" ? "page" : undefined}
          aria-label="Settings"
          title="Settings"
          onClick={() => onChange("settings")}
          className={[
            "group relative flex items-center justify-center rounded-xl transition-all border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6]",
            collapsed ? "size-10" : "h-11 flex-1",
            activeView === "settings"
              ? "border-[var(--accent-color,#c52b68)] bg-white/[0.06] text-white shadow-[0_0_12px_var(--accent-glow,rgba(197,43,104,0.35))]"
              : "border-white/[0.08] bg-white/[0.025] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200",
          ].join(" ")}
        >
          <Settings2
            className="size-4"
            style={activeView === "settings" ? { color: "var(--accent-color, #d75b88)" } : undefined}
            strokeWidth={1.8}
          />
        </button>

        {/* Collapse / Expand Sidebar Button */}
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
          className={[
            "group relative flex items-center justify-center rounded-xl transition-all border border-white/[0.08] bg-white/[0.025] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6]",
            collapsed ? "size-10" : "h-11 flex-1",
          ].join(" ")}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 text-zinc-400 group-hover:text-zinc-200" strokeWidth={1.8} />
          ) : (
            <PanelLeftClose className="size-4 text-zinc-400 group-hover:text-zinc-200" strokeWidth={1.8} />
          )}
        </button>
      </div>
    </motion.aside>
  );
}
