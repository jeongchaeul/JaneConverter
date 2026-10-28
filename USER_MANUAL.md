# JaneConverter User Manual

A comprehensive guide to getting the most out of JaneConverter — the sovereign personal creator toolbox of Jane Cerys (`project//aspyr`).

---

## Table of Contents

1. [What is JaneConverter?](#1-what-is-janeconverter)
2. [Quick Start: Convert in 3 Steps](#2-quick-start-convert-in-3-steps)
3. [Music & Audio Ingestion](#3-music--audio-ingestion)
   - [Streaming Catalog Resolution (Spotify & Apple Music)](#streaming-catalog-resolution-spotify--apple-music)
   - [Playlists & Album Sets](#playlists--album-sets)
   - [Audio Formats, DSP & Loudness Normalization](#audio-formats-dsp--loudness-normalization)
4. [Video Ingestion & Hardware Transcoding](#4-video-ingestion--hardware-transcoding)
   - [Supported Video Platforms](#supported-video-platforms)
   - [Zero-Loss Stream Copy Mode](#zero-loss-stream-copy-mode)
   - [Time Trimming & Offsets](#time-trimming--offsets)
   - [Hardware Acceleration (GPU & CPU Fallback)](#hardware-acceleration-gpu--cpu-fallback)
   - [Archival Vault Recovery (Deleted & Hidden Videos)](#archival-vault-recovery-deleted--hidden-videos)
5. [Photo, Asset & Gallery Ingestion](#5-photo-asset--gallery-ingestion)
   - [Pinterest Pins, Boards & Notification Hubs](#pinterest-pins-boards--notification-hubs)
   - [Instagram Multi-Photo Carousels](#instagram-multi-photo-carousels)
   - [Facebook Photo Albums & Multi-Image Posts](#facebook-photo-albums--multi-image-posts)
   - [Image Formats & Automatic Normalization](#image-formats--automatic-normalization)
6. [The Story Capturer: Ephemeral Live Stories](#6-the-story-capturer-ephemeral-live-stories)
   - [Overview & Architecture](#overview--architecture)
   - [Capturing Live Story Trays & Highlights](#capturing-live-story-trays--highlights)
   - [Guest Sessions vs Authenticated Cookies](#guest-sessions-vs-authenticated-cookies)
   - [Activation Gate & Terms of Usage](#activation-gate--terms-of-usage)
7. [Browser Cookies & Session Architecture](#7-browser-cookies--session-architecture)
   - [When Cookies Are Required](#when-cookies-are-required)
   - [Direct Edge & Chrome Cookie Access (Chromium 127+)](#direct-edge--chrome-cookie-access-chromium-127)
   - [Non-Chromium Browsers](#non-chromium-browsers)
   - [Volatile Memory Safety & Privacy Guarantees](#volatile-memory-safety--privacy-guarantees)
8. [FL Studio (.flp) Project Downgrader](#8-fl-studio-flp-project-downgrader)
   - [The Collaboration Lockout Problem](#the-collaboration-lockout-problem)
   - [Downgrading Workflow](#downgrading-workflow)
   - [Technical Details & Plugin Compatibility](#technical-details--plugin-compatibility)
9. [Export Library & Storage Management](#9-export-library--storage-management)
10. [Presets & Format Reference Cheat Sheet](#10-presets--format-reference-cheat-sheet)
11. [Troubleshooting & Pro Tips](#11-troubleshooting--pro-tips)

---

## 1. What is JaneConverter?

JaneConverter is the sovereign, all-in-one personal creator toolbox engineered by and for **Jane Cerys** (`project//aspyr`). 

It is an engineering-first personal workstation built to eliminate friction across creative workflows:
- **Universal Media Ingestion:** Download high-definition video, lossy/lossless audio, photo carousels, and ephemeral stories from major platforms and open web sources without watermarks or rate-limit lockouts.
- **Studio-Grade Audio Engineering:** EBU R128 (-14 LUFS) loudness normalization, dynamic true-peak limiting (`-1.0 dBTP`), harmonic exciter, and bit-perfect FLAC/WAV masters.
- **Cross-Platform Catalog Matching:** Resolve Spotify and Apple Music URLs to locate public audio masters, stamping files with authoritative ID3 tags and high-resolution cover art.
- **DAW Binary Reverse Engineering:** Downgrade newer FL Studio (`.flp`) projects for older FL Studio installations to prevent collaboration lockouts.
- **Adaptive Resilience Engine (Mahoraga):** Multi-tiered fallback architecture that handles layout changes, signature updates, bot challenges, CDN expirations, and GPU memory exhaustion.
- **Archival Vault Recovery:** Scientific discovery pipeline querying Filmot, Wayback Machine (CDX), Ghostarchive, and Internet Archive collections (`archiveteam_youtube`) to index and recover deleted or unlisted media.

JaneConverter is local-first, telemetry-free, and respects user sovereignty.

---

## 2. Quick Start: Convert in 3 Steps

JaneConverter works immediately out of the box with zero setup:

**Step 1: Input Media** &rarr; **Step 2: Choose Format / Preset** &rarr; **Step 3: Convert & Monitor**

### Step 1: Input Your Media
- **Online Links:** Paste any supported media URL into the top search bar (YouTube, Spotify, Instagram, Facebook, TikTok, Pinterest, or open web URLs).
- **Local Files or Folders:** Click **Choose File / Folder** or drag-and-drop media files/folders directly into the window for batch processing.

### Step 2: Choose Your Preset or Format
- **One-Click Presets:**
  - `Fast MP3`: Instant 320 kbps CBR audio rip.
  - `Universal Music`: 320 kbps MP3 normalized to -14 LUFS with cover art and tags.
  - `Lossless Audio`: Bit-perfect FLAC or WAV for studio mastering and sampling.
  - `Universal Video`: 1080p Full HD MP4 (H.264/AAC) compatible across all devices.
  - `4K Ultra HD`: Preserves up to 3840×2160 resolution at original source bitrate.
  - `Lossless Image`: Pixel-perfect PNG preserving uncompressed dimensions.
- **Custom Configuration:** Click any format pill (`MP3`, `FLAC`, `WAV`, `MP4`, `MKV`, `WebM`, `PNG`, `JPG`, `WebP`) to configure bitrate, resolution, framerate, loudness leveling, or trim offsets.

### Step 3: Convert & Monitor
- Click **Convert**. Real-time progress displays stream download, demuxing, and transcode stages.
- When finished, click **Open Folder** to view your file in Windows Explorer or play it directly in the built-in mini-player.

---

## 3. Music & Audio Ingestion

### Streaming Catalog Resolution (Spotify & Apple Music)
Spotify and Apple Music streams are DRM-protected. JaneConverter resolves them through a 5-step metadata and audio matching pipeline:

1. **Metadata Ingestion:** Extracts official title, artists, album name, release year, ISRC code, and uncompressed cover art via oEmbed, OpenGraph, and the iTunes API.
2. **Query Permutation:** Normalizes titles by stripping release tags (e.g. `(feat. ...)`, `[Club Mix]`, `(Remastered 2021)`) to generate prioritized candidate queries.
3. **Cross-Platform Probing:** Searches YouTube Music (`ytsearch5:`) and SoundCloud (`scsearch5:`) in parallel for matching studio recordings.
4. **Verification (`choose_catalog_match`):**
   - Calculates Levenshtein string distance against track titles.
   - Verifies primary artist token presence.
   - Enforces a **strict ±15-second duration variance filter** to discard live recordings, acoustic covers, sped-up edits, and radio edits.
5. **Authoritative Tagging:** Encodes audio into your target format, embedding official metadata and square cover artwork directly into container tags, and saves a separate high-resolution cover `.jpg`.

### Playlists & Album Sets
- **Supported Collections:** Spotify Playlists & Albums, YouTube Playlists & Channels, SoundCloud Sets, Apple Music Albums.
- **Interactive Manifest Modal:** Pasting a playlist URL opens a modal with track count, estimated duration, individual titles, and thumbnails.
- **Selective Ingestion:** Click **Select All** or toggle individual tracks. Items are processed sequentially with atomic staging into a dedicated album folder.

### Audio Formats, DSP & Loudness Normalization

| Format | Extension | Bitrate / Specs | Ideal Use Case |
| :--- | :--- | :--- | :--- |
| **MP3** | `.mp3` | 128k–320k CBR | Universal compatibility across car stereos, mobile devices, and DJ setups. |
| **FLAC** | `.flac` | Lossless 16-bit / 24-bit | Studio mastering, sampling, and archival listening. Zero compression loss. |
| **WAV** | `.wav` | Uncompressed PCM | Direct import into DAWs (FL Studio, Ableton Live, Pro Tools). |
| **AAC / M4A** | `.m4a` | High-efficiency AAC | Apple ecosystem, iTunes, and mobile playback. |
| **OGG Vorbis** | `.ogg` | High-fidelity open container | Game development (Godot, Unity) and Linux systems. |
| **OPUS** | `.opus` | Low-latency modern codec | Superior fidelity at lower bitrates. |

#### Studio DSP Suite:
- **EBU R128 Loudness Normalization (-14 LUFS):** Automatically balances volume across tracks to the international broadcast standard, eliminating volume jumps.
- **Dynamic True-Peak Limiting:** Uses two-pass `loudnorm` limiting pegged to `-1.0 dBTP` to prevent inter-sample DAC clipping distortion.
- **Harmonic Exciter & Air:** Subtle high-frequency phase and harmonic synthesis (7.5–20 kHz) to restore sparkle and presence to compressed streaming rips.

---

## 4. Video Ingestion & Hardware Transcoding

### Supported Video Platforms

#### Tier 1: Officially Verified & Actively Maintained
Rigorously hardened and stress-tested against live CDN updates under the Rule of 7 across releases:
- **YouTube:** Videos, Shorts (`/shorts/`), live VODs, 4K HDR streams, channel feeds (`/@handle`).
- **TikTok:** Watermark-free 1080p video downloads and direct audio extraction.
- **Instagram:** Reels (`/reels/`), feed videos, and IGTV.
- **Facebook:** Public Watch videos, group videos, and Reels.
- **Twitter / X:** Single videos, clips, and multi-media posts.
- **Reddit:** Embedded video streams with automatic audio muxing.
- **Vimeo, Dailymotion, Twitch clips, Bilibili, SoundCloud.**

#### Universal Open Web & Adult / 18+ Sites (Unrestricted Ingestion)
JaneConverter is **not limited to the platforms above**. Its ingestion engine is inherently universal:
- **Thousands of Unlisted & Niche Websites:** Powered by `yt-dlp`'s 1,800+ extractors, a generic media stream sniffer, and HLS (`.m3u8`) / DASH segment assemblers. Niche video portals, forums, news archives, and educational sites work out of the box.
- **Adult & 18+ Platforms:** Natively supports and downloads from adult platforms (Pornhub, XVideos, SpankBang, RedTube, Chaturbate recordings, etc.) via underlying stream extractors.
- **Operational Reality:** Outside Tier 1 certified sites, open web and adult sites are expected to work via generic extraction without individual per-site certification.
- **Browser Bridge Sniffing:** For sites with aggressive bot guards or custom web players, clicking **Send to JaneConverter** in the Browser Bridge extension pipes authenticated streams directly from your active browser tab.

### Zero-Loss Stream Copy Mode
When input codecs match the requested output container (e.g. H.264 + AAC into an MP4 container) with no resizing or audio filters requested:
- The engine executes **Stream Copy Mode** (`-c copy`).
- Streams are remuxed at the container level without re-encoding.
- Conversion finishes in **under 2 seconds** with **100% bit-perfect original quality** and zero CPU/GPU overhead.

### Time Trimming & Offsets
Specify **Start Offset** and **End Offset** (e.g. `00:01:30` to `00:03:45`, or exact seconds like `90` to `225`) in format settings to extract and transcode only the desired segment.

### Hardware Acceleration (GPU & CPU Fallback)
Automatic GPU encoder initialization:
- **NVIDIA:** NVENC (`h264_nvenc`, `hevc_nvenc`)
- **AMD:** AMF (`h264_amf`, `hevc_amf`)
- **Intel:** QuickSync Video / QSV (`h264_qsv`, `hevc_qsv`)
- **Apple Silicon:** VideoToolbox (`h264_videotoolbox`, `hevc_videotoolbox`)

**Self-Healing CPU Fallback:** If GPU memory is exhausted (e.g. gaming or 3D rendering in the background) or a driver fails, the Adaptive Engine catches the failure, flushes the staging buffer, and falls back to multi-threaded CPU software encoding (`libx264`, `libx265`, `svtav1`) without failing the conversion.

### Archival Vault Recovery (Deleted & Hidden Videos)
When videos are deleted or removed from YouTube, normal tools fail with `Video unavailable`. JaneConverter can resurrect lost media through a 4-stage discovery ladder:

| Stage | Source | Purpose |
| :--- | :--- | :--- |
| **Stage 1** | Filmot & Wayback Metadata Index | Recovers original title, channel name, upload date, description, and runtime. |
| **Stage 2** | Archive.org Collections | Searches `archiveteam_youtube` and `youtube-archive` buckets for preserved HTTPS streams. |
| **Stage 3** | Ghostarchive Mirrors | Probes `ghostarchive.org` mirrors for direct video copies. |
| **Stage 4** | Wayback Machine CDX Streams | Searches historical direct `googlevideo.com/videoplayback` chunk captures. |

Recovered streams are verified with `ffprobe`, transcoded to your target format, stamped with original metadata, and saved to your library.

#### Enabling Archival Recovery:
- **Desktop UI:** Expand **Advanced settings** on the Convert screen and toggle **Search archival vaults for unavailable media** to **ON**.
- **CLI:** Pass `--archival-fallback`:
  ```bash
  uv run janeconverter --source "https://www.youtube.com/watch?v=VIDEO_ID" --archival-fallback
  ```
- **Playlists:** With archival fallback ON, deleted playlist items are recovered in sequence rather than skipped.

---

## 5. Photo, Asset & Gallery Ingestion

### Pinterest Pins, Boards & Notification Hubs
- **Single Pins (`/pin/...`):** Strips preview scaling parameters (`236x`, `564x`, `736x`) to download uncompressed `originals/` master photos.
- **Board Routes (`/username/boardname/`):** Recursively crawls public boards into an organized gallery folder.
- **Notification Hubs (`/news_hub/`):** Resolves notification links that redirect guests, extracting all collection images via internal API endpoints.
- **Shortlinks (`pin.it/...`):** Automatically expands 301/302 redirects to extract underlying pins.

### Instagram Multi-Photo Carousels
- Paste any carousel link (`/p/ABC.../`).
- Extracts all slide photos at maximum resolution (1440×1440 or 1080×1350) and downloads interspersed video slides into an organized album folder.

### Facebook Photo Albums & Multi-Image Posts
- Facebook hides full albums behind dynamic single-page React pagination and login backdrops.
- **Autonomous Headless Traversal:** Sandboxed webview dismisses login modals, executes a 5-stage pointer event sequence (`pointerdown` &rarr; `mousedown` &rarr; `pointerup` &rarr; `mouseup` &rarr; `click` + `ArrowRight`), switches to grid scraping if redirected, and refreshes CDN tokens on HTTP 403.

### Image Formats & Automatic Normalization
- Supports conversion between **PNG**, **JPG**, **WebP**, **AVIF**, **BMP**, **GIF**, and **TIFF**.
- **EXIF Auto-Rotation:** Transposes images via `ImageOps.exif_transpose` so phone photos never appear sideways.
- **FFmpeg Frame Extraction:** Uses FFmpeg to extract pristine RGBA master frames from rare formats (HEIF, AVIF, animated WebP, PSD, QOI) before Pillow processing.
- **Color Profile Normalization:** Converts CMYK and palette images to standard sRGB.

---

## 6. The Story Capturer: Ephemeral Live Stories

> [!WARNING]
> **Borderline Feature / Grey-Line Capability**  
> Ephemeral 24-hour stories on Instagram and Facebook are designed to be temporary. JaneConverter includes a specialized extraction engine for archiving story feeds. This capability is **disabled by default** and requires explicit user activation.

### Overview & Architecture
Connects directly to platform story relay preloader endpoints (`xdt_api__v1__feed__reels_media`, `story_card_info`), bypassing web UI tracking to archive live story feeds in original master quality.

### Capturing Live Story Trays & Highlights
- **Full Tray Capture:** Paste an active story link or profile URL (`instagram.com/stories/username/` or `facebook.com/stories/...`). JaneConverter queries the active tray and downloads **every story card currently live** (whether 1 or 40+ slides) with pristine photos and full HD video.
- **Story Highlights:** Paste any highlight link (`instagram.com/stories/highlights/...`) to download the complete highlight collection.
- Stories are saved chronologically in your library, labeled with author handles and timestamps.

### Guest Sessions vs Authenticated Cookies
- **Public Accounts:** Downloaded via anonymous guest requests without sending user credentials (no viewer list entry).
- **Private / Friends-Only Stories:** Uses your active desktop browser session (see [Section 7](#7-browser-cookies--session-architecture)). If your browser can view it, JaneConverter can capture it.

### Activation Gate & Terms of Usage
To prevent inadvertent privacy violations, story extraction is gated behind an affirmative opt-in:
1. Open **Settings &rarr; Browser & Sessions**.
2. Toggle **Ephemeral Stories Extraction** to **ON**.
3. In the **Terms of Usage** modal, confirm authorization and compliance with privacy laws.
4. Click **I Understand & Agree** to unlock. *(CLI: pass `--allow-ephemeral-stories`).*

---

## 7. Browser Cookies & Session Architecture

### When Cookies Are Required
Over 90% of conversions operate 100% anonymously in guest mode. Cookies are needed only for:
- Age-gated YouTube videos (Error 152 / "Sign in to confirm you're not a bot").
- Private or unlisted videos accessible to your account.
- Friends-only Facebook posts and private Instagram accounts.
- Ephemeral stories from non-public profiles.

### Direct Edge & Chrome Cookie Access (Chromium 127+)
Chromium 127+ introduced Windows App-Bound Encryption, blocking standard external cookie decryption:
1. Open **Settings &rarr; Browser & Sessions**.
2. Enable **Read Browser Cookies** and **Direct Edge & Chrome Cookie Access**.
3. **Mechanism:** Configures user policy `ApplicationBoundEncryptionEnabled` to `0` in `HKCU\Software\Policies\Microsoft\Edge` and `Google\Chrome`, enabling standard Windows DPAPI decryption.
4. **Benefit:** Enables cookie reading without third-party extensions or manual `.txt` cookie exports. Can be toggled off at any time.

### Non-Chromium Browsers
Firefox, Vivaldi, and Brave use standard encryption vaults. Select your browser in the **Preferred Browser** dropdown in Settings without requiring registry policies.

### Volatile Memory Safety & Privacy Guarantees
- **Non-Locking Shadow Snapshot:** Creates a temporary copy of the SQLite database in RAM to prevent browser file-locking collisions.
- **Volatile Storage:** Decrypted cookies exist only in an ephemeral in-memory `RequestsCookieJar` during the active job.
- **Zero Disk Writes:** Passwords, session cookies, and tokens are **never written to disk or logs**. Memory is immediately cleared upon job completion.
- **Zero Telemetry:** No cookies or browsing history are ever transmitted to remote servers.

---

## 8. FL Studio (.flp) Project Downgrader

> [!NOTE]
> **DAW Tools Status:** The FL Studio (`.flp`) downgrader and Ableton Live (`.als`) migrator are **experimental creator studio utilities** engineered for Jane Cerys's personal workstation. All heuristics, version matrices, and patching algorithms are **Subject to Maintainer Decisions**. External critique or issue policing regarding these utilities is categorically out of scope.

### The Collaboration Lockout Problem
When an artist saves a project in a newer FL Studio release (e.g. FL 24 or 21.2) and shares it with a collaborator on an older release (e.g. FL 20.8), FL Studio halts loading with a blocking error: *"This project was saved in a newer version of FL Studio and cannot be opened."*

### Downgrading Workflow
1. Click **FL Studio Tools** in the left sidebar.
2. Drag-and-drop your `.flp` file or click **Browse FLP**.
3. **Inspect Metadata:** Displays project tempo (BPM), PPQ timebase, channel count, and original build version.
4. **Select Target Version:** Choose `20.8.4` (FL 20), `21.0.3` (FL 21 early), or `21.2.3` (FL 21 late).
5. **Click Downgrade Project:** Writes a safe copy (`<Original>_downgraded.flp`). **Your original project file is untouched.**

### Technical Details & Plugin Compatibility
- Modifies binary header events and version registration bytes while preserving pattern notes, automation clips, mixer routings, and sample links.
- **Plugin Note:** Stock plugins exclusive to newer versions (e.g. *Kepler*, *LuxeVerb*) will be flagged as missing by older FL Studio engines, but all patterns and third-party VSTs (Serum, Vital, FabFilter, Kontakt) load seamlessly.

---

## 9. Export Library & Storage Management

Converted files are organized automatically in your **Export Library**:
- `Music/` &rarr; Audio masters, albums, and tagged tracks (`Artist - Title.mp3`).
- `Video/` &rarr; MP4, MKV, WebM videos, Shorts, and Reels (`Channel - Title.mp4`).
- `Images/` &rarr; Pins, Instagram albums, and carousels (`Album_Title/slide_01.png`).

### Storage & Library Controls:
- **Change Directory:** Open **Settings &rarr; System & Updates &rarr; Data Root Folder** to retarget your library to any local drive.
- **Review History:** Click the **Converted** tab to view past jobs, play files in the mini-player, or click the folder icon to reveal files in Windows Explorer.
- **Disk Space Guard:** Conversions require at least **256 MB** of free drive space before starting, protecting drives from running out of storage.

---

## 10. Presets & Format Reference Cheat Sheet

| Preset | Format | Bitrate / Resolution | Mode | Recommended Application |
| :--- | :--- | :--- | :--- | :--- |
| **Fast MP3** | `.mp3` | 320 kbps CBR | Fast Transcode | Fast audio ripping; bypasses loudness leveling for maximum speed. |
| **Universal Music** | `.mp3` | 320 kbps CBR | DSP Normalization | Standard music library; applies -14 LUFS leveling and embeds square cover art. |
| **Lossless Audio** | `.flac` | 24-bit / 48kHz | Bit-Perfect | Archival listening, sampling, and studio production. Zero compression loss. |
| **Universal Video** | `.mp4` | 1080p Full HD (H.264/AAC) | Hardware Accelerated | General video playback across mobile, desktop, TV, and Discord sharing. |
| **4K Ultra HD** | `.mp4` / `.mkv` | Up to 3840×2160 | Hardware / Stream Copy | High-resolution displays and preserving original cinematography. |
| **Stream Copy** | Same as Source | Original Bitrate | Container Remux (`-c copy`) | Instant conversion when codecs match. Zero quality loss, zero CPU/GPU overhead. |
| **Lossless Image** | `.png` | Original Dimensions | Uncompressed | Social carousels, wallpapers, artwork, and Pinterest pins. |
| **Compact Image** | `.jpg` / `.webp` | High-Quality Web | Web Optimized | Quick photo sharing and saving storage space. |

---

## 11. Troubleshooting & Pro Tips

- **YouTube Bot Verification (Error 152):** Enable **Read Browser Cookies** in Settings. For Chrome or Edge, turn on **Direct Edge & Chrome Cookie Access** and ensure you are logged into YouTube in that browser.
- **Deleted / Unavailable YouTube Videos:** Expand **Advanced settings** on the Convert screen, toggle **Search archival vaults for unavailable media** to **ON**, and re-run. JaneConverter searches Filmot, Archive.org collections, Ghostarchive, and Wayback CDX streams.
- **"Ephemeral story extraction is disabled":** Open **Settings &rarr; Browser & Sessions**, enable **Ephemeral Stories Extraction**, and accept the terms modal.
- **Partial Carousel / Album Downloads:** Verify link points directly to the album post. For private accounts, ensure browser session cookies are enabled.
- **Why Stream Copy Re-encoded:** Stream Copy (`-c copy`) automatically switches to transcoding if audio normalization, video resizing, or cover art embedding is requested.
- **Batch Processing:** Drag and drop multiple files or entire folders into the window. Each file is staged in an isolated job directory (`temp/job_<id>/`) and processed in sequence.
- **Viewing Logs:** Click the **Console** icon in the sidebar for live debug logs, or click **Export Logs** to save a diagnostic file.

---

*JaneConverter is sovereign software engineered with pride by Jane Cerys (`project//aspyr`).*
