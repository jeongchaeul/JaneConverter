import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Scale, ShieldAlert, X } from "lucide-react";
import { bridge } from "../bridge";

interface StoryTermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  accentColor?: string;
}

export function StoryTermsModal({
  isOpen,
  onClose,
  onConfirm,
  accentColor = "#c52b68",
}: StoryTermsModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!isOpen) setAcknowledged(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="story-terms-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl bg-zinc-950/95 border border-zinc-800 shadow-2xl overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}25`, color: accentColor }}
            >
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <h2 id="story-terms-title" className="text-base font-semibold text-zinc-100">
                Ephemeral Stories & Legal Agreement
              </h2>
              <p className="text-xs text-zinc-400">
                Acceptable Use Policy & Compliance Warning
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-xs leading-relaxed text-zinc-300">
          {/* Alert Notice */}
          <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 space-y-1.5">
            <div className="flex items-center gap-2 font-medium text-amber-300">
              <AlertTriangle className="size-4 shrink-0" />
              <span>Important Privacy & Statutory Notice</span>
            </div>
            <p className="text-[11px] text-amber-200/90 leading-normal">
              Instagram Stories and Facebook Stories are temporary (24-hour) media formats designed by creators with explicit expectations of ephemeral availability.
            </p>
          </div>

          {/* Section: Public vs Audience-Restricted */}
          <div className="space-y-1.5">
            <h3 className="font-semibold text-zinc-200 flex items-center gap-2 text-xs">
              <Scale className="size-3.5 text-zinc-400" />
              Public Media vs. Audience-Restricted Content
            </h3>
            <p>
              While public broadcasts can be viewed and cached openly, <strong>audience-restricted stories</strong> (such as Instagram <em>Close Friends</em> or Facebook <em>Friends Only</em>) constitute private electronic communications.
            </p>
            <p>
              Recording, downloading, archiving, or disseminating private stories without the express knowledge and written consent of the content creator is strictly prohibited and may violate civil and criminal laws in your jurisdiction.
            </p>
          </div>

          {/* Section: Statutory Protections */}
          <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1.5 text-[11px]">
            <span className="font-medium text-zinc-200 block">Applicable Legal Statutes Include:</span>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li><strong className="text-zinc-300">Data Privacy Act of 2012 (RA 10173)</strong> & Anti-Photo/Video Voyeurism (RA 9995)</li>
              <li><strong className="text-zinc-300">GDPR (EU)</strong> Articles 6 & 9 regarding non-consensual personal media processing</li>
              <li><strong className="text-zinc-300">Stored Communications Act (US)</strong> and state-level electronic privacy statutes</li>
              <li>Third-party platform Terms of Service regarding automated extraction</li>
            </ul>
          </div>

          {/* Section: User Affirmation & Zero Liability */}
          <div className="space-y-1.5 text-[11px] text-zinc-400">
            <h3 className="font-semibold text-zinc-200 text-xs">Zero Liability & Indemnification</h3>
            <p>
              JaneConverter and maintainer <strong className="text-zinc-300">project//aspyr (Jane Cerys)</strong> provide local conversion utilities &quot;as is&quot; and disclaim all legal liability for user conduct. You assume 100% full personal and legal liability for all content processed.
            </p>
            <button
              type="button"
              onClick={() => void bridge.openUrl("https://github.com/jeongchaeul/JaneConverter/blob/main/DISCLAIMER.md")}
              className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2 pt-1"
            >
              <span>Read Full Legal Disclaimer (Section 6)</span>
              <ExternalLink className="size-3" />
            </button>
          </div>

          {/* Interactive Checkbox */}
          <div className="pt-2 border-t border-zinc-800/80">
            <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800 hover:bg-zinc-900/70 transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 size-4 rounded border-zinc-700 text-pink-600 focus:ring-0 focus:ring-offset-0 bg-zinc-950 cursor-pointer"
                style={{ accentColor }}
              />
              <span className="text-[11px] text-zinc-300 font-medium leading-snug">
                I have read the Terms of Usage. I affirm that I will only extract stories that I have authored or for which I hold explicit permission, and I accept full legal responsibility.
              </span>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800/80 bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!acknowledged}
            onClick={() => {
              if (acknowledged) {
                onConfirm();
                onClose();
              }
            }}
            className="px-4 py-2 text-xs font-semibold text-white rounded-xl shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:scale-95"
            style={{
              backgroundColor: acknowledged ? accentColor : "#3f3f46",
              boxShadow: acknowledged ? `0 4px 14px ${accentColor}40` : "none",
            }}
          >
            I Agree & Enable
          </button>
        </div>
      </div>
    </div>
  );
}
