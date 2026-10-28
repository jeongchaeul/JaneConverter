import { useState } from "react";
import {
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ExternalLink,
  Film,
  Globe,
  HelpCircle,
  Lock,
  Music,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { bridge } from "../../bridge";

export type GuideSection = "quickstart" | "audio" | "video" | "stories" | "flp" | "faq";

export const GUIDE_SECTIONS = [
  { id: "quickstart" as const, label: "Getting Started", icon: Sparkles, desc: "3 steps & platforms" },
  { id: "audio" as const, label: "Music & Audio", icon: Radio, desc: "DSP, Spotify match & lossless" },
  { id: "video" as const, label: "Video & Photos", icon: Film, desc: "GPU encode, carousels & pins" },
  { id: "stories" as const, label: "Story Capturer", icon: Camera, desc: "Live story feeds & trays", badge: "Live" },
  { id: "flp" as const, label: "FL Studio Downgrader", icon: Music, desc: "FLP project version patcher" },
  { id: "faq" as const, label: "Presets & FAQ", icon: HelpCircle, desc: "Cheat sheet & troubleshooting" },
];

export function SettingsGuideTab({ onNavigateTab }: { onNavigateTab?: (tab: "browser") => void }) {
  const [guideSection, setGuideSection] = useState<GuideSection>("quickstart");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <BookOpen className="size-3.5" style={{ color: "var(--accent-color, #c52b68)" }} />
          User Manual & Quick Reference
        </div>
        <button
          type="button"
          onClick={() => void bridge.openUrl("https://github.com/jeongchaeul/JaneConverter/blob/main/USER_MANUAL.md")}
          className="subtle-button flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
        >
          <ExternalLink className="size-3" /> View Full USER_MANUAL.md on GitHub
        </button>
      </div>

      {/* Sub-page / Category Pills Navigation */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {GUIDE_SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const isSelected = guideSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setGuideSection(sec.id)}
              className={`flex flex-col items-start gap-1 rounded-xl p-3 text-left transition-all border ${
                isSelected
                  ? "border-[var(--accent-color,#c52b68)]/60 bg-[var(--accent-color,#c52b68)]/10 text-white shadow-sm ring-1 ring-[var(--accent-color,#c52b68)]/20"
                  : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:border-white/15 hover:bg-white/[0.05] hover:text-zinc-200"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <Icon
                  className="size-4"
                  style={{ color: isSelected ? "var(--accent-color, #c52b68)" : undefined }}
                />
                {sec.badge && (
                  <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-rose-300 border border-rose-500/30">
                    {sec.badge}
                  </span>
                )}
              </div>
              <span className="text-xs font-semibold text-zinc-200 mt-1">{sec.label}</span>
              <span className="text-[10px] text-zinc-400 leading-tight">{sec.desc}</span>
            </button>
          );
        })}
      </div>

      {/* PAGE 1: GETTING STARTED */}
      {guideSection === "quickstart" && (
        <div className="space-y-4">
          <section className="panel space-y-4 p-5" aria-labelledby="guide-quickstart-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Sparkles size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-quickstart-heading">Quick Start: Convert in 3 Steps</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              JaneConverter is ready to use immediately with zero mandatory setup. Follow these 3 simple steps:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.1] text-[11px] font-mono" style={{ color: "var(--accent-color, #c52b68)" }}>1</span>
                  Input Your Media
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Paste any URL (YouTube, Spotify, Instagram, TikTok, Facebook, Pinterest, SoundCloud) into the top search bar, or drag &amp; drop local media files/folders into the window.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.1] text-[11px] font-mono" style={{ color: "var(--accent-color, #c52b68)" }}>2</span>
                  Select Format or Preset
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Pick a Quick Preset (<em>Fast MP3</em>, <em>Universal Music</em>, <em>Universal Video</em>, <em>Lossless Image</em>) or click any format pill to adjust bitrates, resolution, or time offsets.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.1] text-[11px] font-mono" style={{ color: "var(--accent-color, #c52b68)" }}>3</span>
                  Convert &amp; Done
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Click <strong>Convert</strong>. Real-time stream decoding, adaptive GPU acceleration, and atomic validation stage your file directly in your Export Library.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-[11px] text-zinc-400 flex items-start gap-2">
              <span className="text-amber-400 font-semibold shrink-0">PRO TIP:</span>
              <span>Need to convert dozens or hundreds of files? Drag an entire folder into JaneConverter. The engine queues every file sequentially with zero lockups or memory leaks.</span>
            </div>
          </section>

          {/* Supported Sources & Platforms */}
          <section className="panel space-y-4 p-5" aria-labelledby="guide-platforms-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Globe size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-platforms-heading">Supported Platforms &amp; What They Do</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              JaneConverter automatically detects the media source and selects the optimal extraction pipeline:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-red-400 font-bold">●</span> YouTube &amp; YouTube Music
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Extracts 1080p, 1440p, and 4K 60fps video or 320k audio streams. Supports individual videos, Shorts (<code className="text-zinc-300">/shorts/</code>), channel feeds (<code className="text-zinc-300">/@handle</code>), and playlists.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-emerald-400 font-bold">●</span> Spotify &amp; Apple Music Matching
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Resolves metadata via oEmbed and iTunes APIs, probes YouTube Music &amp; SoundCloud for matching studio masters, enforces a 15-second duration filter, and stamps authoritative ID3 tags and high-res cover art.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-pink-400 font-bold">●</span> Instagram (Posts, Reels &amp; Carousels)
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Downloads single photos, multi-photo carousels (2–10+ slides) at full original dimensions (up to 1440px), Reels (<code className="text-zinc-300">/reels/</code>), and audio tracks.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-blue-400 font-bold">●</span> Facebook (Albums, Posts &amp; Reels)
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Autonomous headless scraper navigates React SPAs, dismisses login prompts, injects 5-stage pointer clicks, catches CDN token expirations, and extracts high-definition Watch videos, Reels, and complete photo albums.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span className="text-amber-400 font-bold">●</span> TikTok, SoundCloud &amp; Reddit
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Watermark-free 1080p TikTok videos or audio extraction. SoundCloud sets with original artwork and tags. Reddit video, audio, and image galleries.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-rose-400 flex items-center gap-1.5">
                  <span className="text-rose-400 font-bold">●</span> Pinterest (Pins, Boards &amp; News Hub)
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Bypasses preview clamping to fetch uncompressed original CDN master photos. Unpacks notification collections (<code className="text-zinc-300">news_hub</code>), unrolls <code className="text-zinc-300">pin.it</code> shortlinks, and downloads entire boards.
                </p>
              </div>
            </div>

            {/* Universal Open Web & Adult / 18+ Ingestion Callout */}
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.06] p-4 text-xs space-y-2.5">
              <div className="flex items-center gap-2 font-semibold text-violet-200">
                <Globe className="size-4 text-violet-400 shrink-0" />
                <span>Universal Open Web &amp; Adult / 18+ Sites (Unrestricted Ingestion)</span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-300">
                JaneConverter is <strong>NOT limited to the platforms listed above</strong>. Its ingestion engine is inherently universal:
              </p>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-zinc-400 list-disc list-inside">
                <li>
                  <strong className="text-zinc-200">Thousands of Unlisted &amp; Niche Websites:</strong> Ingest media from virtually any video-hosting website, news outlet, forum, or educational archive across the open web.
                </li>
                <li>
                  <strong className="text-zinc-200">Adult &amp; 18+ Websites:</strong> Natively supports and downloads from adult platforms (Pornhub, XVideos, SpankBang, RedTube, Chaturbate recordings, etc.) via underlying stream engines.
                </li>
                <li>
                  <strong className="text-zinc-200">Operational Reality:</strong> While adult websites and niche portals are not individually certified in the primary test suite, generic stream decoders, HLS (<code className="text-zinc-300">.m3u8</code>) assemblers, and DASH manifest parsers process them seamlessly.
                </li>
                <li>
                  <strong className="text-zinc-200">Browser Bridge Sniffing:</strong> For platforms with complex anti-bot protection or proprietary web players, clicking <em>Send to JaneConverter</em> from the Browser Bridge extension captures authenticated streams directly from your active tab.
                </li>
              </ul>
            </div>
          </section>

          <div className="flex items-center justify-end pt-2">
            <button
              type="button"
              onClick={() => setGuideSection("audio")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            >
              <span>Next: Music &amp; Audio</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* PAGE 2: MUSIC & AUDIO */}
      {guideSection === "audio" && (
        <div className="space-y-4">
          <section className="panel space-y-3 p-5" aria-labelledby="guide-spotify-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Music size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-spotify-heading">Spotify &amp; Apple Music Matching Architecture</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Spotify and Apple Music audio streams are DRM-locked catalog entities. JaneConverter achieves legal, high-fidelity archival through intelligent stream matching:
            </p>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2.5 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="font-medium text-zinc-200">Metadata Resolution &amp; Duration Filter:</div>
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    Queries official Spotify oEmbed and Apple iTunes APIs to resolve canonical track titles, artists, albums, and duration. It then queries YouTube Music and SoundCloud for studio masters, enforcing a strict <strong>15-second duration variance filter</strong> to eliminate live versions, speed-ups, or fan edits.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="font-medium text-zinc-200">ID3 Tagging &amp; Album Cover Embedding:</div>
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    Extracted audio files are automatically tagged with official metadata (Title, Artist, Album, Year, Track Number) and embedded with crisp, high-resolution original cover artwork.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5 text-[11px] text-zinc-400">
                <strong className="text-zinc-200">Full Playlists &amp; Albums:</strong> Paste any Spotify or Apple Music playlist/album URL. JaneConverter parses every track in the list and presents an atomic download queue.
              </div>
            </div>
          </section>

          <section className="panel space-y-3 p-5" aria-labelledby="guide-audio-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Radio size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-audio-heading">Audio DSP, Loudness Normalization &amp; Formats</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Built with professional audio engineering principles in mind:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1">
                <div className="font-semibold text-zinc-200">EBU R128 (-14 LUFS) Normalization</div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Balances volume across tracks to the international streaming standard (-14 LUFS). Includes a dynamic true-peak limiter (<code className="text-zinc-300">-1.0 dBTP</code> ceiling) to prevent inter-sample DAC clipping on loud masters.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1">
                <div className="font-semibold text-zinc-200">Lossless Studio Masters (FLAC / WAV)</div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Export bit-perfect 16-bit or 24-bit uncompressed audio ready for immediate import into FL Studio, Ableton Live, Pro Tools, or permanent offline archiving.
                </p>
              </div>
            </div>
          </section>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setGuideSection("quickstart")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <ChevronLeft className="size-3.5" />
              <span>Back: Getting Started</span>
            </button>
            <button
              type="button"
              onClick={() => setGuideSection("video")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            >
              <span>Next: Video &amp; Photos</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* PAGE 3: VIDEO & PHOTOS */}
      {guideSection === "video" && (
        <div className="space-y-4">
          <section className="panel space-y-3 p-5" aria-labelledby="guide-video-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Film size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-video-heading">Video Transcoding, Trimming &amp; Hardware Acceleration</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              JaneConverter is engineered for high video throughput with multi-tiered hardware fallback:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Zap className="size-3.5 text-amber-400" /> Stream Copy Mode
                </div>
                <p className="text-[11px] text-zinc-400">
                  When input and target codecs match, JaneConverter executes container remuxing (<code className="text-zinc-300">-c copy</code>) in under 2 seconds with 100% original lossless quality and 0% CPU strain.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Cpu className="size-3.5 text-sky-400" /> GPU Acceleration
                </div>
                <p className="text-[11px] text-zinc-400">
                  Automatically initializes NVIDIA NVENC, AMD AMF, Intel QuickSync (QSV), or Apple Silicon VideoToolbox to transcode videos at up to 10x real-time speed.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <RefreshCw className="size-3.5 text-emerald-400" /> CPU Fallback Guarantee
                </div>
                <p className="text-[11px] text-zinc-400">
                  If your GPU runs out of VRAM (CUDA OOM) or encounters driver errors, the engine purges the staging buffer and seamlessly falls back to multi-core CPU encoding (<code className="text-zinc-300">libx264</code>/<code className="text-zinc-300">libx265</code>).
                </p>
              </div>
            </div>
          </section>

          <section className="panel space-y-3 p-5" aria-labelledby="guide-visuals-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Sparkles size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-visuals-heading">Social Visuals, Original CDN Masters &amp; Carousels</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-rose-300">Pinterest Master Quality</div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Bypasses preview clamping to fetch uncompressed original CDN master photos. Unpacks notification collections (<code className="text-zinc-300">news_hub</code>) and unrolls <code className="text-zinc-300">pin.it</code> shortlinks.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-pink-300">Instagram Carousels</div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Downloads complete multi-photo carousels (2–10+ slides) at maximum available dimensions (up to 1440px), grouped neatly into an organized subfolder.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-1.5">
                <div className="font-semibold text-blue-300">Facebook Albums</div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Autonomous headless scraper navigates React SPAs, dismisses modals, and extracts full photo sets (<code className="text-zinc-300">/media/set/</code>) and Watch videos.
                </p>
              </div>
            </div>
          </section>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setGuideSection("audio")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <ChevronLeft className="size-3.5" />
              <span>Back: Music &amp; Audio</span>
            </button>
            <button
              type="button"
              onClick={() => setGuideSection("stories")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            >
              <span>Next: Story Capturer</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* PAGE 4: STORY CAPTURER */}
      {guideSection === "stories" && (
        <div className="space-y-4">
          <section className="panel space-y-4 p-5 border border-rose-500/20 bg-rose-500/[0.02]" aria-labelledby="guide-story-heading">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-rose-300">
                <Camera size={16} className="text-rose-400" />
                <span id="guide-story-heading">The Story Capturer: Ephemeral Live Stories &amp; Trays</span>
              </div>
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 border border-rose-500/20">
                Borderline Capability
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Ephemeral 24-hour stories on Instagram and Facebook are temporary and walled off. JaneConverter features a specialized extraction engine designed to capture live story trays and user feeds:
            </p>
            <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4 space-y-3 text-xs">
              <div className="space-y-2">
                <div className="font-semibold text-zinc-200 flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-rose-500/20 text-rose-300 text-[11px]">★</span>
                  Snatch an Entire Live Feed / Story Tray in One Click
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed pl-7">
                  Input an Instagram profile URL (<code className="text-zinc-300">instagram.com/username/</code> or <code className="text-zinc-300">instagram.com/stories/username/</code>), or a Facebook story bucket ID (<code className="text-zinc-300">facebook.com/stories/123456789/</code>).
                </p>
                <p className="text-[11px] text-zinc-400 leading-relaxed pl-7">
                  As long as JaneConverter can access your active desktop browser session (or view in guest mode), it connects to the platform's live story tray and <strong className="text-zinc-200">snatches the entire present live story feed currently active, no matter how many stories are present</strong> (whether 1, 5, or 40+ cards)!
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-7 pt-1 text-[11px]">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                  <div className="font-medium text-zinc-200 flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-400" /> Photo Stories
                  </div>
                  <p className="text-zinc-400">Synthesizes and exports full-resolution uncompressed master photos (JPG/PNG) directly from image candidate relays.</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                  <div className="font-medium text-zinc-200 flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-400" /> Video Stories &amp; Highlights
                  </div>
                  <p className="text-zinc-400">Fetches pristine HD video and high-bitrate AAC audio. Also supports full Instagram Story Highlights collections (<code className="text-zinc-300">/highlights/ID/</code>).</p>
                </div>
              </div>

              <div className="rounded-lg border border-rose-500/20 bg-rose-950/20 p-3 space-y-1.5 pl-4 text-[11px]">
                <div className="font-medium text-rose-200 flex items-center gap-1.5">
                  <Lock className="size-3 text-rose-400" />
                  Mandatory Activation Gate &amp; Acceptable Use Policy
                </div>
                <p className="text-rose-200/80 leading-relaxed">
                  Because ephemeral media is private and transient, story extraction is <strong>disabled by default</strong>. To unlock it:
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-rose-200/80">
                  <li>Go to the <strong className="text-rose-100">Browser &amp; Sessions</strong> tab in Settings.</li>
                  <li>Toggle <strong className="text-rose-100">Ephemeral Stories Extraction</strong> to ON.</li>
                  <li>Review and acknowledge the Terms of Usage &amp; Acceptable Use Policy modal confirming you have legal authorization or consent to archive.</li>
                </ol>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.("browser")}
                    className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-200 hover:text-white"
                  >
                    <span>Open Browser &amp; Sessions Settings →</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setGuideSection("video")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <ChevronLeft className="size-3.5" />
              <span>Back: Video &amp; Photos</span>
            </button>
            <button
              type="button"
              onClick={() => setGuideSection("flp")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            >
              <span>Next: FL Studio Downgrader</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* PAGE 5: FL STUDIO DOWNGRADER */}
      {guideSection === "flp" && (
        <div className="space-y-4">
          <section className="panel space-y-3 p-5" aria-labelledby="guide-flp-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Music size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-flp-heading">FL Studio (.flp) Project Downgrader</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Collaborating with other music producers who use older versions of FL Studio (e.g. FL 20 or 21)? Older FL Studio versions reject newer project files with a blocking error.
            </p>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-2 text-xs">
              <div className="font-medium text-zinc-300">How to downgrade an FL Studio project:</div>
              <ol className="list-decimal pl-4 space-y-1 text-zinc-400 text-[11px]">
                <li>Click <strong className="text-zinc-200">FL Studio Tools</strong> in the left sidebar.</li>
                <li>Drop or select your <code className="text-zinc-300">.flp</code> file. JaneConverter parses tempo (BPM), PPQ, channel count, and original FL build.</li>
                <li>Choose your target version (<code className="text-zinc-300">20.8.4</code>, <code className="text-zinc-300">21.0.3</code>, <code className="text-zinc-300">21.2.3</code>).</li>
                <li>Click <strong>Downgrade Project</strong>.</li>
                <li>A new file named <code className="text-zinc-300">&lt;Project&gt;_downgraded.flp</code> is created safely. Your original file is 100% untouched.</li>
              </ol>
            </div>
          </section>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setGuideSection("stories")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <ChevronLeft className="size-3.5" />
              <span>Back: Story Capturer</span>
            </button>
            <button
              type="button"
              onClick={() => setGuideSection("faq")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            >
              <span>Next: Presets &amp; FAQ</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* PAGE 6: PRESETS & FAQ */}
      {guideSection === "faq" && (
        <div className="space-y-4">
          <section className="panel space-y-3 p-5" aria-labelledby="guide-presets-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Zap size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-presets-heading">Presets &amp; Format Cheat Sheet</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Fast MP3</span>
                  <span className="mono-label text-[10px]">320k</span>
                </div>
                <p className="text-[11px] text-zinc-400">Fastest audio extraction without volume normalization. Great for samples and quick listens.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Universal Music</span>
                  <span className="mono-label text-[10px]">-14 LUFS</span>
                </div>
                <p className="text-[11px] text-zinc-400">320kbps MP3 with EBU R128 loudness leveling, cover art, and clean track tags.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Lossless Audio</span>
                  <span className="mono-label text-[10px]">FLAC / WAV</span>
                </div>
                <p className="text-[11px] text-zinc-400">Bit-perfect uncompressed audio for music production and master archives.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Universal Video</span>
                  <span className="mono-label text-[10px]">1080p MP4</span>
                </div>
                <p className="text-[11px] text-zinc-400">Standard Full HD MP4 compatible with phones, TVs, Discord, and editors.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>4K Ultra HD</span>
                  <span className="mono-label text-[10px]">2160p MKV/MP4</span>
                </div>
                <p className="text-[11px] text-zinc-400">Preserves maximum available video resolution and high-bitrate audio for cinema displays.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Stream Copy</span>
                  <span className="mono-label text-[10px]">Instant</span>
                </div>
                <p className="text-[11px] text-zinc-400">When source and target match, audio/video streams copy losslessly in milliseconds.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Lossless Image</span>
                  <span className="mono-label text-[10px]">PNG</span>
                </div>
                <p className="text-[11px] text-zinc-400">Full uncompressed original resolution for social photos, artwork, and wallpapers.</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                <div className="font-semibold text-zinc-200 flex items-center justify-between">
                  <span>Compact Image</span>
                  <span className="mono-label text-[10px]">JPG / WebP</span>
                </div>
                <p className="text-[11px] text-zinc-400">High-efficiency compression for fast web sharing and minimal disk footprint.</p>
              </div>
            </div>
          </section>

          <section className="panel space-y-3 p-5" aria-labelledby="guide-browser-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <ShieldCheck size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-browser-heading">Browser Cookies &amp; Private Media (Zero Extensions)</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Public links convert anonymously with zero setup. For private YouTube videos, age-gated media (Error 152), friends-only Facebook/Instagram posts, or live stories, JaneConverter accesses your existing browser session seamlessly:
            </p>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-2.5 text-xs">
              <div className="space-y-1">
                <div className="font-medium text-zinc-200">Direct Edge &amp; Chrome Cookie Access (Chromium 127+ Fix):</div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Chromium 127+ introduced Windows App-Bound Encryption, which breaks standard external cookie tools. JaneConverter fixes this natively: enable <strong className="text-zinc-200">Direct Edge &amp; Chrome Cookie Access</strong> in the Browser tab. This configures the user policy <code className="text-zinc-300">ApplicationBoundEncryptionEnabled = 0</code>, allowing JaneConverter to read sessions via native Windows DPAPI with <strong className="text-zinc-200">zero third-party browser extensions</strong> and <strong className="text-zinc-200">zero manual .txt file exports</strong>.
                </p>
              </div>
              <div className="space-y-1">
                <div className="font-medium text-zinc-200">Firefox, Vivaldi &amp; Brave:</div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  These browsers use standard encryption. Simply select your browser from the dropdown in Settings.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5 space-y-1 text-[11px]">
                <div className="font-medium text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="size-3" />
                  Volatile In-Memory Security Guarantee
                </div>
                <p className="text-zinc-400">
                  Cookies are read into a non-locking SQLite memory snapshot, decrypted into volatile RAM, and immediately purged when the download completes. Plaintext cookies are <strong>never written to disk</strong> and never transmitted remotely.
                </p>
              </div>
            </div>
          </section>

          <section className="panel space-y-3 p-5" aria-labelledby="guide-faq-heading">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <HelpCircle size={16} style={{ color: "var(--accent-color, #c52b68)" }} />
              <span id="guide-faq-heading">Quick Troubleshooting &amp; FAQ</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-medium text-zinc-200">Where are my files saved?</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Inside your JaneConverter Export Library, organized by category (<code className="text-zinc-300">Music/</code>, <code className="text-zinc-300">Video/</code>, <code className="text-zinc-300">Images/</code>). You can change this location anytime in <strong>Settings → System &amp; Updates → Data Root Folder</strong>.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-medium text-zinc-200">A video says &quot;Sign-in required&quot; or &quot;Confirm you&apos;re not a bot&quot; (Error 152)</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Go to <strong>Settings → Browser &amp; Sessions</strong>, make sure <strong>Read Browser Cookies</strong> is enabled, and turn on <strong>Direct Edge &amp; Chrome Cookie Access</strong> so JaneConverter can authenticate automatically using your desktop browser.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-medium text-zinc-200">Story extraction fails with &quot;Ephemeral story extraction is disabled&quot;</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Stories are gated by default. Open <strong>Settings → Browser &amp; Sessions</strong>, turn on <strong>Ephemeral Stories Extraction</strong>, and accept the Terms of Usage modal.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1">
                <div className="font-medium text-zinc-200">How do I make conversions faster?</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Ensure <strong>Adaptive GPU Acceleration</strong> is enabled in <strong>Settings → Hardware &amp; Engine</strong>. For audio, choose the <strong>Fast MP3</strong> preset to bypass volume analysis.
                </p>
              </div>
            </div>
          </section>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setGuideSection("flp")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <ChevronLeft className="size-3.5" />
              <span>Back: FL Studio Downgrader</span>
            </button>
            <button
              type="button"
              onClick={() => setGuideSection("quickstart")}
              className="subtle-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white"
            >
              <span>Restart Guide ↺</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
