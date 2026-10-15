# JaneConverter

<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="JaneConverter application icon" />
</p>

<p align="center">
  <strong>Universal Media Downloader & Audio / Video / Image Transcode Studio</strong>
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
> — **Jane Cerys**

JaneConverter is a personal media downloader and format conversion toolbox designed by Jane Cerys (`project//aspyr`). Originally built to handle sample libraries, video editing transcodes, social media archival, and cross-version FL Studio project downgrades, it runs locally through a modern desktop app (Tauri 2 + React) or directly via Python CLI.

[Latest Release](https://github.com/jeongchaeul/JaneConverter/releases/latest) · [Changelog](CHANGELOG.md) · [Rebuild Guide](packaging/REBUILD.md) · [Mahoraga Engine](docs/MAHORAGA_ENGINE.md)

<p align="center">
  <img src="docs/photos/Screenshot_260.png" alt="JaneConverter Desktop UI" width="94%" />
</p>

---

## Features

- **Media Transcoding**: 15+ audio outputs (WAV, FLAC, MP3, AAC, Opus, AIFF, ALAC...), 15+ video outputs (MP4, MKV, WebM, MOV, AVI...), and all common image formats (PNG, WebP, JPG, TIFF, GIF, AVIF). Uses FFmpeg and Pillow under the hood.
- **Audio Quality & Normalization**: High-precision SoX resampling (`soxr`), optional EBU R128 loudness normalization (`-14 LUFS`), automatic album cover embedding, and stream copy (`-c copy`) when re-encoding isn't needed.
- **Hardware Acceleration**: Automatic GPU encoding via NVIDIA NVENC, AMD AMF, Intel QSV, or Linux VAAPI, with automatic fallback to multi-core CPU.
- **Online & Social Downloader**: Powered by `yt-dlp` and `yt-dlp-ejs` with resilient fallback routines for YouTube, SoundCloud, Instagram, Pinterest (`news_hub`, boards, pins), Facebook albums, TikTok, X/Twitter, and Reddit.
- **Streaming Catalog Matching**: Resolves metadata for Spotify and Apple Music tracks, finding matching public audio versions on YouTube Music and SoundCloud while preserving tags and album art.
- **FL Studio (.flp) Project Downgrade**: Inspects project tempo, PPQ, channel count, and build numbers, and patches header event bytes to help collaborate with producers on older FL Studio versions.
- **Queue & Library Explorer**: Batch drag-and-drop, real-time conversion progress, and an organized converted media library.
- **Optional Browser Companion**: Extension to pipe audio, video, or story streams directly from active browser tabs over a local loopback port (`127.0.0.1`).

---

## Adaptive Resilience: The Mahoraga Engine

> *"With this treasure, I summon..."*

Behind JaneConverter is an adaptive recovery architecture inspired by **Mahoraga** from *Jujutsu Kaisen*. When downloading or converting media across the web, roadblocks are frequent: aggressive anti-bot JavaScript challenges, login walls, rate limits, audio container mismatches, or GPU driver crashes.

Instead of crashing or failing, JaneConverter treats runtime errors as signals to rotate its adaptation wheel—analyzing roadblocks and pivoting to alternative fallback routes until pristine media is delivered.

<p align="center">
  <a href="docs/MAHORAGA_ENGINE.md">
    <img src="docs/photos/mahoraga-pipeline.svg" width="100%" alt="Mahoraga Adaptive Pipeline Architecture" />
  </a>
</p>

*For the complete technical breakdown of adaptation tiers and recovery algorithms, see the [Mahoraga Engine Reference](docs/MAHORAGA_ENGINE.md).*

---

## Interface Preview

| Converted Media Library | Video Presets & Advanced Controls |
| :---: | :---: |
| <img src="docs/photos/Screenshot_270.png" width="100%" alt="Converted Media Library" /> | <img src="docs/photos/Screenshot_268.png" width="100%" alt="Video Presets and Trimming" /> |

| Hardware Acceleration & Session Recovery | Theme Customization |
| :---: | :---: |
| <img src="docs/photos/Screenshot_272.png" width="100%" alt="GPU and Session Settings" /> | <img src="docs/photos/Screenshot_274.png" width="100%" alt="Custom Theme Colors" /> |

---

## Platform Support

| Platform | Supported Media | Extraction Route | Status |
| :--- | :--- | :--- | :--- |
| **YouTube, SoundCloud** | Audio, Video, Playlists | Direct yt-dlp + Node.js EJS | Supported |
| **Spotify, Apple Music** | Tracks, Albums, Playlists | Catalog Metadata + Public Stream Matching | Supported |
| **Instagram** | Single/Multi Photos, Reels | Internal API / Guest Scraper + Video Handoff | Supported |
| **Facebook** | Single/Multi Photos, Group Sets, Reels | Sandboxed Guest View + Grid Scraper | Supported |
| **TikTok** | Photos, Slideshows, Videos | Direct Stream Extractor + yt-dlp fallback | Supported |
| **Pinterest** | Pins, Collections (`news_hub`), Boards | Direct API / Candidate Probe + CDN Fallback | Supported |
| **X/Twitter** | Photos, Galleries, Videos | Direct Extractor / Guest Scraper | Supported |
| **Reddit** | Videos, Audio, Galleries, Posts | Direct Stream Extractor + Guest Scraper | Supported |
| **Stories (IG / FB / TT)** | Ephemeral Stories | Browser Bridge Extension (`Collect mode`) | Extension Required |

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

- **Cookie-Free by Default**: Normal downloads run in a clean guest context without accessing your browser profiles or reading cookies.
- **Opt-In Session Recovery**: If YouTube Error 152 (age-gate) or friends-only restrictions block a download, you can enable **Read Browser Cookies** in Settings. JaneConverter will temporarily borrow session cookies in-memory for that domain (Chrome, Edge, Brave, Vivaldi, Firefox, Opera). Cookies are never written to disk and are flushed from memory immediately after extraction.

---

## Installation & Setup

Pre-built binaries are available on the [Releases page](https://github.com/jeongchaeul/JaneConverter/releases):

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

See [packaging/REBUILD.md](packaging/REBUILD.md) for full instructions on building standalone binaries and packaging release artifacts.

---

## Known Limitations

- **FL Studio Downgrades**: Downgrading project files alters version header events and trims newer arrangement records. Third-party plugins or features introduced in newer FL Studio versions cannot be backported by FL Studio itself, so always keep backups of your original `.flp` files.
- **Social Media Scraping**: Guest and DOM scrapers depend on current platform layouts. If Facebook, Instagram, or Pinterest push major frontend redesigns, fallback routes may require updates.

---

## License

JaneConverter is an independent personal project developed by Jane Cerys (`project//aspyr`) and released under the [MIT License](LICENSE).
