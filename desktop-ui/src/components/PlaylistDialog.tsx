import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Layers, ListMusic, ListPlus, Search, SlidersHorizontal, X } from "lucide-react";
import type { PlaylistCatalog } from "../bridge";
import { intentPresets, type IntentPreset } from "../options";

export function PlaylistDialog({
  catalog,
  onClose,
  onConfirm,
  onQueue,
  initialIndexes,
  isQueuedItem = false,
}: {
  catalog: PlaylistCatalog;
  onClose: () => void;
  onConfirm?: (
    indexes: string,
    preset?: IntentPreset,
    itemOverrides?: Record<number, IntentPreset>
  ) => void;
  onQueue?: (
    indexes: string,
    catalog: PlaylistCatalog,
    preset?: IntentPreset,
    itemOverrides?: Record<number, IntentPreset>
  ) => void;
  initialIndexes?: string;
  isQueuedItem?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("current");
  const [itemPresets, setItemPresets] = useState<Record<number, string>>({});
  const isStory = /story|stories|instagram|facebook/i.test(catalog.title) || catalog.items.some((item) => /story/i.test(item.title));
  const [selected, setSelected] = useState<Set<number>>(() => {
    if (initialIndexes && initialIndexes.trim()) {
      const idxs = initialIndexes
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
      if (idxs.length > 0) return new Set(idxs);
    }
    return new Set(catalog.items.map((item) => item.index));
  });
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog.items;
    return catalog.items.filter((item) => `${item.title} ${item.artist}`.toLowerCase().includes(needle));
  }, [catalog.items, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  function invert() {
    setSelected((current) => {
      const next = new Set(current);
      catalog.items.forEach((item) => next.has(item.index) ? next.delete(item.index) : next.add(item.index));
      return next;
    });
  }

  function getResolvedPresets() {
    const batchPreset = selectedPresetId !== "current" ? intentPresets.find((p) => p.id === selectedPresetId) : undefined;
    const itemOverrides: Record<number, IntentPreset> = {};
    for (const idx of selected) {
      const customId = itemPresets[idx];
      if (customId && customId !== "inherit") {
        const found = intentPresets.find((p) => p.id === customId);
        if (found) itemOverrides[idx] = found;
      }
    }
    return { batchPreset, itemOverrides };
  }

  return (
    <dialog ref={dialogRef} className="fixed inset-0 z-50 m-auto grid max-h-[82vh] w-[calc(100%-3rem)] max-w-3xl place-items-center overflow-hidden border-0 bg-transparent p-0 text-white backdrop:bg-black/60 backdrop:backdrop-blur-sm" aria-label={isStory ? "Story item selector" : "Playlist track selector"} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="panel flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden bg-[#090812] shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
              {isStory ? <Layers className="size-4 text-[#d75b88]" /> : <ListMusic className="size-4 text-[#d75b88]" />}
            </div>
            <div>
              <div className="text-sm font-medium text-white">{catalog.title}</div>
              <div className="mt-1 text-[11px] text-zinc-600">
                {selected.size} of {catalog.items.length} {isStory ? "items" : "tracks"} selected
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-200" aria-label={isStory ? "Close story selector" : "Close playlist selector"}><X className="size-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isStory ? "Filter story items..." : "Filter tracks..."} className="field w-full py-2 pl-9 pr-3 text-xs" />
          </div>
          <button type="button" onClick={() => setSelected(new Set(catalog.items.map((item) => item.index)))} className="subtle-button px-3 py-2 text-xs">Select all</button>
          <button type="button" onClick={() => setSelected(new Set())} className="subtle-button px-3 py-2 text-xs">Deselect</button>
          <button type="button" onClick={invert} className="subtle-button px-3 py-2 text-xs">Invert</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {visible.map((item) => {
            const isSelected = selected.has(item.index);
            const currentItemPreset = itemPresets[item.index] ?? "inherit";
            return (
              <div
                key={item.index}
                onClick={() => toggle(item.index)}
                className="flex cursor-pointer items-center gap-3 border-b border-white/[0.04] py-2.5 text-xs hover:bg-white/[0.02] transition-colors"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(item.index)}
                  onClick={(e) => e.stopPropagation()}
                  className="size-4 accent-[#c52b68] cursor-pointer"
                />
                <span className="w-6 font-mono text-[10px] text-zinc-700">{item.index}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-300">
                  {item.title}
                  <span className="ml-2 text-zinc-600">{item.artist}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={currentItemPreset}
                    onChange={(e) => {
                      const val = e.target.value;
                      setItemPresets((prev) => ({ ...prev, [item.index]: val }));
                    }}
                    className="field py-1 px-2 text-[11px] bg-zinc-900/90 border border-white/10 rounded-lg text-zinc-300 hover:border-pink-500/40 focus:border-pink-500 focus:outline-none transition-colors max-w-[170px]"
                    aria-label={`Preset for item ${item.index}`}
                  >
                    <option value="inherit">
                      {selectedPresetId === "current"
                        ? "Current Settings"
                        : `${intentPresets.find((p) => p.id === selectedPresetId)?.name || "Preset"}`}
                    </option>
                    {intentPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name} ({preset.format.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>
                <span className="w-10 text-right font-mono text-[10px] text-zinc-600">{item.duration}</span>
                <span className="w-4 flex justify-center">
                  {isSelected && <Check className="size-3.5 text-emerald-400" />}
                </span>
              </div>
            );
          })}
          {!visible.length && <div className="py-10 text-center text-xs text-zinc-600">{isStory ? "No story items match this filter." : "No tracks match this filter."}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="subtle-button px-4 py-2 text-xs">Cancel</button>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-3.5 text-zinc-500" />
              <span className="text-[11px] text-zinc-400">Preset:</span>
              <select
                value={selectedPresetId}
                onChange={(event) => setSelectedPresetId(event.target.value)}
                className="field py-1.5 px-2.5 text-xs bg-zinc-900 border border-white/10 rounded-lg text-zinc-200"
                aria-label="Target conversion preset"
              >
                <option value="current">Current Converter Settings</option>
                {intentPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} ({preset.format.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onQueue && (
              <button
                type="button"
                disabled={!selected.size}
                onClick={() => {
                  const { batchPreset, itemOverrides } = getResolvedPresets();
                  const sortedIndexes = Array.from(selected).sort((a, b) => a - b).join(",");
                  onQueue(sortedIndexes, catalog, batchPreset, itemOverrides);
                }}
                className="subtle-button flex items-center gap-1.5 px-4 py-2 text-xs text-pink-300 hover:text-pink-200 disabled:opacity-40"
              >
                <ListPlus className="size-3.5" />
                {isQueuedItem ? (isStory ? "Save selection" : "Save track selection") : (isStory ? "Add stories to queue" : "Add playlist to queue")}
              </button>
            )}
            {onConfirm && !isQueuedItem && (
              <button
                type="button"
                disabled={!selected.size}
                onClick={() => {
                  const { batchPreset, itemOverrides } = getResolvedPresets();
                  const sortedIndexes = Array.from(selected).sort((a, b) => a - b).join(",");
                  onConfirm(sortedIndexes, batchPreset, itemOverrides);
                }}
                className="primary-button px-4 py-2 text-xs disabled:opacity-40"
              >
                {isStory ? "Convert selected stories" : "Convert selected tracks"}
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
