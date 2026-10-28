# JaneConverter

<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="JaneConverter application icon" />
</p>

<p align="center">
  <strong>Universal Media Downloader & Creator Studio Suite (Media Transcode & DAW Project Utilities)</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20%7C%20Linux%20%7C%20macOS-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Python-3.10%2B-blueviolet?style=flat-square" alt="Python" />
  <img src="https://img.shields.io/badge/Acceleration-NVENC%20%7C%20AMF%20%7C%20QSV%20%7C%20VAAPI-success?style=flat-square" alt="Hardware Acceleration" />
  <br />
  <img src="https://img.shields.io/badge/Audio-MP3%20%7C%20WAV%20%7C%20FLAC%20%7C%20AAC%20%7C%20Opus%20%7C%20more-orange?style=flat-square" alt="Audio Formats" />
  <img src="https://img.shields.io/badge/Video-MP4%20%7C%20MKV%20%7C%20WebM%20%7C%20AVI%20%7C%20MOV%20%7C%20more-red?style=flat-square" alt="Video Formats" />
  <img src="https://img.shields.io/badge/Image-JFIF%20%7C%20PNG%20%7C%20WebP%20%7C%20TIFF%20%7C%20more-green?style=flat-square" alt="Image Formats" />
</p>

> *"JaneConverter is tailored specifically for my personal needs and convenience. But I wanted to share it because it can be useful. I don't have a particular goal, it's just my personal toolbox. If you find it useful, then that's great."*  
> — **Jane Cerys** (`project//aspyr`)
> 
> *For architecture, development commands, and contributor guidelines, see [AGENTS.md](AGENTS.md).*

JaneConverter is an all-in-one personal creator toolbox spanning high-precision media conversion, studio audio DSP, DAW binary patching (FL Studio `.flp` & Ableton Live `.als`), and universal media ingestion. It runs 100% locally with zero telemetry via a native desktop app (Tauri 2 + React) or the Python CLI engine.

[Latest Release](https://github.com/jeongchaeul/JaneConverter/releases/latest) · [User Manual](USER_MANUAL.md) · [FAQ](FAQ.md) · [Changelog](CHANGELOG.md) · [Rebuild Guide](packaging/REBUILD.md) · [Adaptive Resilience Engine](docs/MAHORAGA_ENGINE.md)

<p align="center">
  <img src="docs/photos/Screenshot_260.png" alt="JaneConverter Desktop UI" width="94%" />
</p>

---

## Features

- **Universal Media Transcoding**: 15+ audio outputs (WAV, FLAC, MP3, AAC, Opus, AIFF...), 15+ video outputs (MP4, MKV, WebM, MOV, AVI...), and all common image formats (PNG, WebP, JPG, TIFF, GIF, AVIF).
- **Studio Audio Engineering**: EBU R128 loudness normalization (`-14 LUFS`), dynamic true-peak limiting (`-1.0 dBTP`), SoX resampling, and instant stream copying (`-c copy`) when re-encoding is unnecessary.
- **Harmonic Exciter (High-End Sparkle)**: Analog-modeled exciter (`aexciter`, 7.5–20 kHz) to synthesize perceptual air, openness, and cymbal shimmer on lossy rips.
- **Hardware Acceleration**: Automatic GPU encoding via NVIDIA NVENC, AMD AMF, Intel QSV, or Apple VideoToolbox, backed by self-healing CPU software fallback (`libx264`, `libx265`).
- **Social & Media Ingestion**: Resilient extractors for YouTube, SoundCloud, Instagram, Pinterest (`news_hub`, boards, pins), Facebook albums, TikTok, X/Twitter, Reddit, and ephemeral live stories.
- **Streaming Catalog Resolution**: Matches Spotify and Apple Music URLs against public studio masters on YouTube Music and SoundCloud, tagging files with official ISRC metadata and 1400×1400+ artwork.
- **Studio DAW Tools (Producer Suite)**:
  - **FL Studio (.flp) Downgrader**: Bit-level binary chunk parser and header patcher enabling cross-version collaboration across FL Studio 24, 21, 20, and 12.
  - **Ableton Live (.als) Migrator (Experimental)**: Gzip XML stream inspector, schema version retargeter, and preset compatibility helper.
- **Queue & Export Library**: Drag-and-drop batch processing, real-time conversion progress, and structured local storage with 1-click explorer actions.
- **Browser Bridge Companion**: Optional extension to route authenticated media streams and live stories from browser tabs over a local loopback port (`127.0.0.1`).

---

## Adaptive Resilience Architecture

JaneConverter features an adaptive recovery architecture (internally codenamed the Mahoraga Engine). In real-world media ingestion, failures are common: JavaScript signature challenges (`nsig`), login walls, rate limits, audio container quirks, or GPU driver crashes.

Instead of failing, JaneConverter rotates through multi-tiered recovery cascades:

1. **Stream Extraction & Network**: Runtime JS signature deciphering via `yt-dlp-ejs`, universal format cascades (`bv*+ba/b/best`), and bounded jittered backoff.
2. **Authenticated Sessions**: Guest-first by default; ephemeral in-memory session borrowing for age-gated/private media, with fallback to the Browser Bridge.
3. **Catalog Matching**: Token normalization, Levenshtein distance verification, and strict ±15-second duration variance filters for Spotify and Apple Music.
4. **Autonomous DOM Scraping**: Headless sandboxed browser view with synthetic 5-stage pointer sequences (`pointerdown` &rarr; `click`) and modal dismissal for dynamic React carousels.
5. **Transcoder & Hardware**: Seamless GPU-to-CPU failover, artwork normalization for FFmpeg muxing, and lossless container remuxing before re-encoding.
6. **Host OS Resiliency**: Windows file lock collision retry loops (`WinError 32/33`), atomic temporary staging, and `ffprobe` stream integrity verification.

*For full details, see the [Adaptive Resilience Engine Reference](docs/MAHORAGA_ENGINE.md).*

---

## Interface Preview

| Converted Media Library | Video Presets & Trimming |
| :---: | :---: |
| <img src="docs/photos/Screenshot_270.png" width="100%" alt="Converted Media Library" /> | <img src="docs/photos/Screenshot_268.png" width="100%" alt="Video Presets and Trimming" /> |

| Hardware Acceleration & Sessions | Theme Customization |
| :---: | :---: |
| <img src="docs/photos/Screenshot_272.png" width="100%" alt="GPU and Session Settings" /> | <img src="docs/photos/Screenshot_274.png" width="100%" alt="Custom Theme Colors" /> |

---

## Platform Support

### Tier 1: Officially Verified & Maintained Major Platforms
Stress-tested under the Rule of 7 and actively verified across releases:

| Platform | Supported Media | Extraction Route | Status |
| :--- | :--- | :--- | :--- |
| **YouTube, SoundCloud** | Audio, Video, Playlists | yt-dlp + bundled Node.js runtime | Verified on v2.3.5 (Oct 2026) |
| **Spotify, Apple Music** | Tracks, Albums, Playlists | Catalog Metadata + Public Stream Matching | Verified on v2.3.5 (Oct 2026) |
| **Instagram** | Photos, Reels, Audio | Guest Scraper & Internal API + Video Handoff | Verified on v2.3.5 (Oct 2026) |
| **Facebook** | Photos, Albums, Reels | Sandboxed Guest View + Grid Scraper | Verified on v2.3.5 (Oct 2026) |
| **Stories (IG / FB)** | Ephemeral Stories, Video Segments | Signed-in session (Session Recovery, opt-in) | Verified on v2.3.5 (Oct 2026) |
| **TikTok** | Photos, Slideshows, Videos, Audio | Direct Stream Extractor + yt-dlp fallback | Verified on v2.3.5 (Oct 2026) |
| **Pinterest** | Pins, Collections (`news_hub`), Boards | Direct API / Candidate Probe + CDN Fallback | Verified on v2.3.5 (Oct 2026) |
| **X/Twitter** | Photos, Galleries, Videos | Direct Extractor / Guest Scraper | Verified on v2.3.5 (Oct 2026) |
| **Reddit** | Videos, Audio, Galleries, Posts | Direct Stream Extractor + Guest Scraper | Verified on v2.3.5 (Oct 2026) |

### Universal Open Web & Adult / 18+ Ingestion (Unrestricted)
JaneConverter is **not restricted to the platforms above**. Its ingestion engine is inherently universal:
- **Thousands of Unlisted & Niche Websites:** Powered by `yt-dlp`'s 1,800+ extractors, a generic media stream sniffer, and HLS (`.m3u8`) / DASH manifest assemblers.
- **Adult & 18+ Platforms:** Natively supports and downloads from adult platforms (Pornhub, XVideos, SpankBang, RedTube, Chaturbate recordings, etc.) via underlying stream engines.
- **Operational Reality:** Outside Tier 1 certified sites, open web and adult sites are expected to work out of the box via generic extraction without individual per-site certification.
- **Browser Bridge Sniffing:** For sites with aggressive bot guards or custom web players, clicking **Send to JaneConverter** in the Browser Bridge pipes authenticated streams directly from your active browser tab.

---

## Supported Formats

### Selectable Outputs
| Media Type | Formats |
| :--- | :--- |
| **Audio** | MP3, FLAC, WAV, AAC, OGG, M4A, Opus, AIFF, AIF, ALAC (`.m4a`), AC3, MP2, WMA, CAF, AU |
| **Video** | MP4, MKV, WebM, MOV, GIF, AVI, FLV, M4V, TS, M2TS, MPEG, MPG, VOB, 3GP, WMV, ASF |
| **Images** | JPG, JPEG, JFIF, PNG, WebP, BMP, TIF, TIFF, GIF, ICO, TGA, PPM, PGM, PBM |

### Recognized Local Inputs
- **Audio**: `.mp3`, `.flac`, `.wav`, `.aac`, `.ogg`, `.m4a`, `.opus`, `.aiff`, `.alac`, `.ac3`, `.wma`, `.caf`, `.m4b`, `.ape`, `.amr`, `.dts`, `.mka`, `.wv`, `.3ga`
- **Video**: `.mp4`, `.mkv`, `.webm`, `.mov`, `.gif`, `.avi`, `.flv`, `.m4v`, `.ts`, `.m2ts`, `.mpeg`, `.vob`, `.3gp`, `.wmv`, `.asf`, `.avchd`, `.divx`, `.ogv`, `.rmvb`
- **Images**: `.jpg`, `.jpeg`, `.jfif`, `.png`, `.webp`, `.bmp`, `.tiff`, `.gif`, `.ico`, `.tga`, `.ppm`, `.apng`, `.avif`, `.heic`, `.heif`, `.psd`, `.svg`, `.qoi`

---

## Session & Cookie Handling

- **Default (Guest Mode):** JaneConverter operates 100% anonymously by default without accessing browser profiles or reading cookies.
- **Optional Session Recovery (Settings &rarr; Browser & Sessions):** Used for age-restricted videos, private posts, and stories.
- **Ephemeral Session Privacy:** Creates an isolated temporary copy of the browser SQLite database to prevent file-locking collisions. Decrypted cookies are loaded into memory exclusively for the active extraction request and discarded immediately upon completion. Passwords and credentials are never requested, read, or saved.
- **Direct Edge & Chrome Cookie Access:** Configures `ApplicationBoundEncryptionEnabled` to `0` under `HKCU\Software\Policies` to allow standard DPAPI decryption for Chromium 127+. Completely optional, per-user, and can be toggled off at any time.
- **Browser Bridge:** Connects over a local loopback port (`127.0.0.1`) without reading or transmitting cookies; streams are forwarded directly from the user's active tab.

---

## Installation & Setup

Download pre-built packages from the [Releases page](https://github.com/jeongchaeul/JaneConverter/releases):
- **Windows x64**: `JaneConverter-<version>-windows-x64-setup.exe` (or standalone `.zip`)
- **Linux x86_64**: `JaneConverter-<version>-linux-x86_64.AppImage` (or `.tar.gz`)
- **macOS**: `JaneConverter-<version>-macos-arm64.dmg` / `macos-x86_64.dmg`

Python, FFmpeg, FFprobe, and Node.js runtimes are bundled into standalone release builds.

---

## Development & CLI

```bash
# Setup
uv sync
cd desktop-ui && npm ci

# Run Desktop UI in development
cd desktop-ui && npm run tauri:dev

# Run Python CLI conversion
uv run janeconverter --source "https://example.com/media" --format mp3

# FL Studio project downgrade CLI
uv run janeconverter --flp-inspect "project.flp"
uv run janeconverter --flp-downgrade "project.flp" --flp-target 21.2.3 --flp-build 4004

# Run test suites
uv run --locked pytest tests/ -v
cd desktop-ui && npm test -- --run
cargo test --manifest-path desktop-ui/src-tauri/Cargo.toml
```

See [packaging/REBUILD.md](packaging/REBUILD.md) for instructions on compiling standalone binaries and packaging release artifacts.

---

## License

JaneConverter is an independent personal project developed by Jane Cerys (`project//aspyr`) and released under the [MIT License](LICENSE).
