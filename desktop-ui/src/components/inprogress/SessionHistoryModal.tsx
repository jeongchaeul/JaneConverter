import { FolderOpen, History, Trash2, X } from "lucide-react";
import type { ConversionHistoryItem } from "../../bridge";
import type { SessionSummary } from "./types";
import { formatElapsedMs } from "../../options";

function decodeHtmlEntities(text: string): string {
  if (!text) return "";
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

interface SessionHistoryModalProps {
  open: boolean;
  onClose: () => void;
  sessionSummaries: SessionSummary[];
  catalogSessions: ConversionHistoryItem[];
  onSelectSession: (id: string) => void;
  onRemoveSession?: (id: string) => void;
  onRestoreSession?: (item: ConversionHistoryItem) => void;
  onNavigateToLibrary?: () => void;
}

export function SessionHistoryModal({
  open,
  onClose,
  sessionSummaries,
  catalogSessions,
  onSelectSession,
  onRemoveSession,
  onRestoreSession,
  onNavigateToLibrary,
}: SessionHistoryModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-3xl border border-white/10 bg-[#0c0919] p-6 shadow-[0_24px_70px_rgba(0,0,0,.7)]">
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
              <History size={18} className="text-[var(--accent-color,#c52b68)]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">Conversion Sessions</h2>
              <p className="text-xs text-zinc-400">
                Browse, inspect, and switch between your media conversion sessions.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors"
            title="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body: List of Sessions */}
        <div className="min-h-0 flex-1 overflow-y-auto py-4 space-y-3 pr-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
            Active Workspace Sessions ({sessionSummaries.length})
          </div>

          {sessionSummaries.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.05] bg-black/20 p-6 text-center text-xs text-zinc-500">
              No active sessions in queue. Convert media to create sessions.
            </div>
          ) : (
            sessionSummaries.map((sess) => (
              <div
                key={sess.id}
                onClick={() => {
                  onSelectSession(sess.id);
                  onClose();
                }}
                className={`group flex items-center justify-between gap-3.5 rounded-2xl border p-4 cursor-pointer transition-all ${
                  sess.isCurrent
                    ? "border-white/20 bg-white/[0.06] shadow-sm"
                    : "border-white/[0.06] bg-black/40 hover:border-white/15 hover:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="font-mono text-xs font-semibold text-zinc-500 w-7">
                    #{sess.sessionNumber}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-semibold text-zinc-100 group-hover:text-white">
                        {decodeHtmlEntities(sess.title)}
                      </span>
                      {sess.isLive && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Live
                        </span>
                      )}
                      {sess.isCurrent && !sess.isLive && (
                        <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 border border-white/5">
                          Current Rack
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
                      <span className="font-mono">{sess.completed} of {sess.total} completed</span>
                      {sess.format && (
                        <>
                          <span className="text-zinc-600">•</span>
                          <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                            {sess.format.toUpperCase()}
                          </span>
                        </>
                      )}
                      {sess.elapsedMs !== undefined && sess.elapsedMs > 0 && (
                        <>
                          <span className="text-zinc-600">•</span>
                          <span className="font-mono text-zinc-300">
                            {formatElapsedMs(sess.elapsedMs)}
                          </span>
                        </>
                      )}
                      {sess.failed > 0 && (
                        <>
                          <span className="text-zinc-600">•</span>
                          <span className="text-rose-400 font-medium">{sess.failed} failed</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSession(sess.id);
                      onClose();
                    }}
                    className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                      sess.isCurrent
                        ? "bg-white/[0.12] text-white"
                        : "bg-white/[0.04] text-zinc-300 hover:bg-white/[0.1] hover:text-white"
                    }`}
                  >
                    {sess.isCurrent ? "Viewing" : "View in Rack →"}
                  </button>

                  {!sess.isLive && onRemoveSession && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSession(sess.id);
                      }}
                      className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                      title="Remove session from rack"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Previous Launches from Catalog */}
          {catalogSessions.length > 0 && (
            <div className="pt-4 border-t border-white/[0.06]">
              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                Past Conversions from Library ({catalogSessions.length})
              </div>
              <div className="space-y-2">
                {catalogSessions.map((hist) => (
                  <div
                    key={hist.id}
                    onClick={() => {
                      onRestoreSession?.(hist);
                      onSelectSession(hist.id);
                      onClose();
                    }}
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-white/[0.04] bg-black/20 p-3 hover:border-white/10 hover:bg-white/[0.02] cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-zinc-300 group-hover:text-white">
                        {decodeHtmlEntities(hist.fileName || hist.source)}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
                        <span>{hist.presetName || hist.formatLabel}</span>
                        <span>•</span>
                        <span>{new Date(hist.timestamp).toLocaleDateString()}</span>
                        {hist.elapsedMs !== undefined && hist.elapsedMs > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-zinc-300">{formatElapsedMs(hist.elapsedMs)}</span>
                          </>
                        )}
                        <span>•</span>
                        <span className={hist.status === "succeeded" ? "text-emerald-400" : "text-amber-400"}>
                          {hist.status}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestoreSession?.(hist);
                        onSelectSession(hist.id);
                        onClose();
                      }}
                      className="rounded-xl bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-400 hover:bg-white/[0.1] hover:text-white transition-colors shrink-0"
                    >
                      Open in Rack →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.06] pt-4 mt-2">
          {onNavigateToLibrary ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigateToLibrary();
              }}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <FolderOpen size={13} /> Open Converted Library ↗
            </button>
          ) : <div />}

          <button
            type="button"
            onClick={onClose}
            className="subtle-button px-4 py-1.5 text-xs text-zinc-200 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
