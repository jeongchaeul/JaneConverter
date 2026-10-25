# JaneConverter User Manual

A comprehensive, fool-proof guide to getting the most out of JaneConverter — the sovereign personal creator toolbox of Jane Cerys (`project//aspyr`).

---

## Table of Contents

1. [What is JaneConverter?](#1-what-is-janeconverter)
2. [Quick Start: Convert in 3 Steps](#2-quick-start-convert-in-3-steps)
3. [Music & Audio Ingestion (Spotify, Apple Music, YouTube, SoundCloud)](#3-music--audio-ingestion)
   - [Streaming Catalog Resolution (Spotify & Apple Music)](#streaming-catalog-resolution-spotify--apple-music)
   - [Playlists & Album Sets](#playlists--album-sets)
   - [Audio Formats, DSP & EBU R128 Loudness Normalization](#audio-formats-dsp--ebu-r128-loudness-normalization)
4. [Video Ingestion & Hardware Transcoding](#4-video-ingestion--hardware-transcoding)
   - [Supported Video Platforms](#supported-video-platforms)
   - [Zero-Loss Stream Copy Mode](#zero-loss-stream-copy-mode)
   - [Time Trimming & Offsets](#time-trimming--offsets)
   - [Hardware Acceleration (GPU vs CPU Fallback)](#hardware-acceleration-gpu-vs-cpu-fallback)
5. [Photo, Asset & Gallery Ingestion](#5-photo-asset--gallery-ingestion)
   - [Pinterest Pins, Boards & Notification Hubs](#pinterest-pins-boards--notification-hubs)
   - [Instagram Multi-Photo Carousels](#instagram-multi-photo-carousels)
   - [Facebook Photo Albums & Multi-Image Posts](#facebook-photo-albums--multi-image-posts)
   - [Image Formats & Automatic Normalization](#image-formats--automatic-normalization)
6. [The Story Capturer: Ephemeral Live Stories & Trays](#6-the-story-capturer-ephemeral-live-stories--trays)
   - [What is the Story Capturer?](#what-is-the-story-capturer)
   - [How to Snatch an Entire Story Tray or User Feed](#how-to-snatch-an-entire-story-tray-or-user-feed)
   - [Story Highlights](#story-highlights)
   - [Guest Sessions vs Authenticated Browser Cookies](#guest-sessions-vs-authenticated-browser-cookies)
   - [The Activation Gate & Acceptable Use Policy](#the-activation-gate--acceptable-use-policy)
7. [Browser Cookies & Zero-Extension Session Architecture](#7-browser-cookies--zero-extension-session-architecture)
   - [Why are Cookies Needed?](#why-are-cookies-needed)
   - [Direct Edge & Chrome Cookie Access (Chromium 127+ Fix)](#direct-edge--chrome-cookie-access-chromium-127-fix)
   - [Non-Chromium Browsers (Firefox, Vivaldi, Brave)](#non-chromium-browsers-firefox-vivaldi-brave)
   - [Volatile Memory Safety & Privacy Guarantee](#volatile-memory-safety--privacy-guarantee)
8. [FL Studio (.flp) Project Downgrader](#8-fl-studio-flp-project-downgrader)
   - [The Problem: Collaboration Lockouts](#the-problem-collaboration-lockouts)
   - [Step-by-Step Downgrading Instructions](#step-by-step-downgrading-instructions)
   - [Supported Versions & Technical Details](#supported-versions--technical-details)
9. [Export Library & Storage Management](#9-export-library--storage-management)
10. [Presets & Format Reference Cheat Sheet](#10-presets--format-reference-cheat-sheet)
11. [Troubleshooting, Edge Cases & Pro Tips](#11-troubleshooting-edge-cases--pro-tips)

---

## 1. What is JaneConverter?

JaneConverter is the sovereign, all-in-one personal creator toolbox engineered by and for **Jane Cerys** (`project//aspyr`). 

It is explicitly **NOT a generic ad-bloated media downloader or narrow commercial SaaS utility**. It is a high-rigor, personal Swiss Army knife and creator workstation built to eliminate real-world friction across:
- **Universal Media Ingestion**: Fetch high-definition video, lossy/lossless audio, full photo carousels, and ephemeral live stories from virtually every major platform without watermark corruption or rate-limit lockouts.
- **Studio-Grade Audio Engineering**: EBU R128 (-14 LUFS) loudness normalization, dynamic true-peak limiting, harmonic excitement, and bit-perfect FLAC/WAV masters.
- **Cross-Platform Catalog Matching**: Paste Spotify or Apple Music URLs to automatically identify songs, locate public audio masters, and embed authoritative ID3 tags and high-resolution cover artwork.
- **DAW Binary Reverse Engineering**: Downgrade newer FL Studio (`.flp`) project files so producers on older FL Studio versions can collaborate seamlessly without blocking error screens.
- **Adaptive Resilience Engine (Mahoraga)**: Multi-tiered fallback pipelines that adapt to layout shifts, signature changes, anti-bot screens, CDN token expirations, and GPU memory exhaustion.

JaneConverter is free, local-first, telemetry-free, and respects user sovereignty.

---

## 2. Quick Start: Convert in 3 Steps

JaneConverter works immediately with zero configuration required.

```
+-----------------------------------------------------------------------------------------+
|  [ 1. INPUT MEDIA ]          -->         [ 2. CHOOSE FORMAT ]        -->  [ 3. CONVERT ]|
|  - Paste any URL                         - Quick Preset                      - Real-time|
|  - Or Drag & Drop file/folder            - Or custom Bitrate/Resolution        progress |
+-----------------------------------------------------------------------------------------+
```

### Step 1: Input Your Media
- **Online Links:** Paste any supported media link into the search bar at the top (e.g., YouTube video, Spotify playlist, Instagram carousel, Facebook album, TikTok, or Pinterest pin).
- **Local Files or Folders:** Click **Choose File / Folder** or drag-and-drop any audio, video, or image file directly into the JaneConverter window. You can drop individual files or entire folders for batch conversion.

### Step 2: Choose Your Preset or Format
- **Quick Presets (One-Click):**
  - `Fast MP3`: Instant 320kbps audio rip at maximum processing speed.
  - `Universal Music`: 320kbps MP3 normalized to -14 LUFS with genuine cover art and tags.
  - `Lossless Audio`: Bit-perfect FLAC or WAV for music production and studio mastering.
  - `Universal Video`: 1080p Full HD MP4 compatible with any phone, TV, browser, or editor.
  - `4K Ultra HD`: Preserves up to 3840×2160 video at maximum source bitrate.
  - `Lossless Image`: Pixel-perfect PNG preserving uncompressed original dimensions.
- **Custom Configuration:** Click any format pill (`MP3`, `FLAC`, `WAV`, `MP4`, `MKV`, `WebM`, `PNG`, `JPG`, `WebP`) to fine-tune bitrates (128k–320k), video resolution (720p, 1080p, 1440p, 4K), frame rate, loudness normalization, or time trim offsets.

### Step 3: Click Convert & Monitor
- Click the prominent **Convert** button.
- Real-time progress displays stream download, demuxing, and transcode stages.
- When finished, your file is automatically staged, validated, and placed in your **Export Library**. Click **Open Folder** to reveal your file in Windows Explorer, or play it directly inside the app.

---

## 3. Music & Audio Ingestion

JaneConverter provides studio-grade audio extraction, playlist unrolling, catalog resolution, and DSP mastering.

### Streaming Catalog Resolution (Spotify & Apple Music)

Spotify and Apple Music utilize proprietary DRM-protected playback streams. JaneConverter solves this through an intelligent **Catalog Resolution Pipeline**:

1. **Metadata Ingestion:** When you paste a Spotify or Apple Music track/album link, JaneConverter queries oEmbed, OpenGraph, and the Apple iTunes API to read the official title, primary artists, album name, release year, ISRC code, and uncompressed high-resolution cover artwork.
2. **Intelligent Query Permutation:** The engine normalizes the track title by stripping redundant release tags (e.g. `(feat. ...)`, `(Remastered 2021)`, `[Club Mix]`) to generate prioritized candidate search strings.
3. **Cross-Platform Master Probing:** Searches YouTube Music (`ytsearch5:`) and SoundCloud (`scsearch5:`) in parallel for matching public studio recordings.
4. **Verification Algorithm (`choose_catalog_match`):**
   - **Levenshtein String Distance:** Evaluates title similarity against candidate names.
   - **Artist Token Matching:** Ensures the main performer is present.
   - **Strict Duration Variance Filter:** Any candidate whose length deviates by more than 15 seconds from the official catalog duration is automatically discarded. This completely prevents accidental downloads of live recordings, acoustic covers, sped-up edits, or extended radio edits.
5. **Authoritative Tagging:** The downloaded audio stream is re-encoded into your chosen format (MP3, FLAC, WAV, M4A) and stamped with the pristine catalog metadata, embedding the original 1400×1400+ cover art directly into the audio container tags. A separate high-res cover `.jpg` is also saved alongside the track.

### Playlists & Album Sets

- **Supported Playlists:** Spotify Playlists & Albums, YouTube Playlists & Channels, SoundCloud Sets, Apple Music Albums.
- **The Playlist Dialog:** When you paste a playlist URL, JaneConverter fetches the complete track manifest without downloading streams yet. A modal pops up displaying:
  - Album/Playlist title and creator.
  - Track count and estimated total duration.
  - Individual track titles, artists, durations, and thumbnails.
- **Flexible Ingestion:** Click **Select All** to download the complete collection, or use checkboxes to cherry-pick specific tracks. The engine processes your selections sequentially with atomic staging, organizing the album into a dedicated folder.

### Audio Formats, DSP & EBU R128 Loudness Normalization

| Format | Extension | Bitrate / Specs | Ideal Use Case |
| :--- | :--- | :--- | :--- |
| **MP3** | `.mp3` | 128k, 192k, 256k, 320k CBR | Universal compatibility across car stereos, phones, and DJ software. |
| **FLAC** | `.flac` | Lossless 16-bit / 24-bit | Archival listening, sampling, and music production. Zero compression artifacts. |
| **WAV** | `.wav` | Uncompressed PCM | Direct import into FL Studio, Ableton Live, Pro Tools, and audio editors. |
| **AAC / M4A** | `.m4a` | High-efficiency AAC | Apple ecosystem, iTunes, and mobile playback. |
| **OGG Vorbis** | `.ogg` | High-fidelity open container | Game development (Godot, Unity), Linux systems. |
| **OPUS** | `.opus` | Modern low-latency codec | Superior fidelity at lower bitrates. |

#### Studio DSP Enhancements:
- **EBU R128 Loudness Normalization (-14 LUFS):** Automatically balances volume across all tracks to the international broadcast streaming standard (-14 LUFS). No more sudden volume spikes between quiet acoustic songs and loud EDM tracks.
- **True-Peak Limiting:** When applying loudness leveling, JaneConverter uses a dynamic two-pass limiter (`loudnorm`) to ensure true-peak levels never exceed `-1.0 dBTP`, completely preventing inter-sample DAC clipping and distortion.
- **Harmonic Exciter & Air:** Subtle high-frequency phase and harmonic restoration to restore presence to dull lossy web rips.

---

## 4. Video Ingestion & Hardware Transcoding

### Supported Video Platforms
JaneConverter downloads from virtually any video platform on the modern web:
- **YouTube:** Standard videos, Shorts (`/shorts/`), live VODs, 4K HDR streams, and channel feeds (`/@handle`).
- **TikTok:** Full 1080p watermark-free video downloads or direct audio extraction.
- **Instagram:** Reels (`/reels/`), feed videos, and IGTV.
- **Facebook:** Public Watch videos, group videos, and Reels.
- **Other Platforms:** Reddit, Vimeo, Twitter/X, Dailymotion, Twitch clips, and Bilibili.

### Zero-Loss Stream Copy Mode
If you input a video (e.g. an MP4 or MKV from YouTube) and your target format matches the native stream codecs (e.g. H.264 video + AAC audio into an MP4 container) with no resizing or audio normalization requested:
- JaneConverter automatically invokes **Stream Copy Mode** (`-c copy`).
- The audio and video streams are remuxed at the container level without touching a single pixel or audio sample.
- **Result:** Conversion completes in **under 2 seconds** with **100% bit-perfect original quality** and zero CPU/GPU workload.

### Time Trimming & Offsets
Need only a specific section of a 2-hour podcast or concert?
- In the format settings, specify **Start Offset** and **End Offset** (e.g., `00:01:30` to `00:03:45`, or exact seconds like `90` to `225`).
- JaneConverter extracts and transcodes only the chosen time slice, saving disk space and processing time.

### Hardware Acceleration (GPU vs CPU Fallback)
JaneConverter automatically detects and initializes dedicated GPU acceleration engines based on your system hardware:
- **NVIDIA:** NVENC (`h264_nvenc`, `hevc_nvenc`)
- **AMD:** AMF (`h264_amf`, `hevc_amf`)
- **Intel:** QuickSync Video / QSV (`h264_qsv`, `hevc_qsv`)
- **Apple Silicon:** VideoToolbox (`h264_videotoolbox`, `hevc_videotoolbox`)

#### The Self-Healing CPU Fallback Guarantee:
If your GPU encounters VRAM exhaustion (e.g., you are playing a heavy game or running a 3D render in the background), or if a specific driver profile fails, JaneConverter's Adaptive Engine catches the error, purges the staging buffer, and seamlessly falls back to multi-threaded CPU software encoding (`libx264`, `libx265`, `svtav1`) without interrupting your conversion or failing the job.

---

## 5. Photo, Asset & Gallery Ingestion

JaneConverter treats images with the same engineering rigor as audio and video. It does not scrape compressed web previews; it extracts pristine original masters.

### Pinterest Pins, Boards & Notification Hubs
- **Single Pins (`pinterest.com/pin/...`):** Downloads the original full-resolution master photo, stripping preview scaling parameters (`236x`, `564x`, `736x`) to fetch the uncompressed `originals/` CDN file.
- **Board Routes (`pinterest.com/username/boardname/`):** Recursively crawls public board pages, collecting all pins into an organized local gallery folder.
- **Notification Collections (`news_hub`):** When following notification links from emails or mobile alerts, Pinterest often redirects guest users to notification hubs (`/news_hub/`). JaneConverter unpacks the notification collection structure and extracts all target photos without getting trapped on the landing feed.
- **Shortlinks (`pin.it/...`):** Automatically expands shortlinks through HTTP 301/302 redirects to extract the underlying target pin.

### Instagram Multi-Photo Carousels
- Instagram posts often contain 2 to 10+ slides mixing photos and videos.
- Paste a carousel URL (e.g., `https://www.instagram.com/p/ABC.../`).
- JaneConverter parses all slides, extracts every photo at maximum available resolution (typically 1440×1440 or 1080×1350), downloads any interspersed video slides, and saves the complete set inside an album folder named after the post title and author.

### Facebook Photo Albums & Multi-Image Posts
- **Album URLs (`facebook.com/media/set/?set=...`) and Shared Posts:**
- Facebook uses dynamic React single-page architecture that hides photos behind login overlays and dynamic pagination.
- **Autonomous Headless Traversal:** JaneConverter launches a sandboxed, isolated webview that:
  1. Detects and dismisses login prompts and modal backdrops.
  2. Fires a 5-stage synthetic pointer event sequence (`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click` + `ArrowRight`) to navigate carousels reliably.
  3. Detects redirects and switches dynamically between carousel mode and album grid thumbnail expansion mode.
  4. Automatically refreshes CDN security tokens if a photo link returns HTTP 403 Forbidden.

### Image Formats & Automatic Normalization
Convert any image between **PNG**, **JPG**, **WebP**, **AVIF**, **BMP**, **GIF**, and **TIFF**.
- **EXIF Auto-Rotation:** Transposes images automatically based on camera orientation tags (`ImageOps.exif_transpose`), ensuring phone photos never appear upside-down or sideways.
- **Rare Format Extraction via FFmpeg:** When reading uncommon or proprietary containers (HEIF, AVIF, animated WebP, PSD, QOI), the engine utilizes FFmpeg to extract an uncompressed RGBA/RGB master frame into Pillow for perfect conversion.
- **Color Profile Normalization:** Normalizes CMYK and palette-based images into standard sRGB for flawless web and desktop display.

---

## 6. The Story Capturer: Ephemeral Live Stories & Trays

> [!WARNING]
> **Borderline Feature / Grey-Line Capability**  
> Ephemeral 24-hour stories on Instagram and Facebook are designed by social networks to be temporary and restricted. JaneConverter includes a specialized, high-rigor extraction engine capable of archiving live story feeds. Because of the personal and fleeting nature of this media, this feature operates under strict ethical and legal boundaries. It is **disabled by default** and requires explicit user activation.

### What is the Story Capturer?
Normally, saving Instagram or Facebook stories requires manual screen recording, third-party shady websites loaded with popups, or fragile browser extensions that steal session cookies.

JaneConverter's **Story Capturer** connects directly to platform story relay preloader endpoints (`xdt_api__v1__feed__reels_media`, `story_card_info`, `ScheduledServerJS`), allowing you to archive live story feeds in original master quality.

### How to Snatch an Entire Story Tray or User Feed

The standout power of JaneConverter's story engine is its ability to **snatch and capture the entire present live story feed of a user in a single action, no matter how many stories are present**:

1. **Copy the Target Link:**
   - **Instagram:** Copy the user's active story URL:
     ```
     https://www.instagram.com/stories/username/
     ```
     *(Or simply copy the user's profile URL: `https://www.instagram.com/username/`)*
   - **Facebook:** Copy the user's story tray URL or story ID:
     ```
     https://www.facebook.com/stories/123456789012345/
     ```
2. **Paste into JaneConverter:**
   - Paste the link into the URL input bar.
3. **Automatic Tray Unrolling:**
   - Instead of fetching only the currently visible story slide, JaneConverter queries the user's active story bucket/tray.
   - **No matter how many story cards are currently live** (whether 1, 6, or 40+ slides), the engine extracts **every single story card** in the live feed.
   - **Photo Stories:** Synthesized and exported as crisp, uncompressed original images (JPG/PNG).
   - **Video Stories:** Downloaded with full HD video and pristine audio streams.
   - All stories are placed in your Export Library organized chronologically with author handles and timestamps.

### Story Highlights
Want to archive permanent story highlights from an Instagram profile?
- Paste any highlight URL:
  ```
  https://www.instagram.com/stories/highlights/17923456789012345/
  ```
- JaneConverter traverses the `xdt_api__v1__feed__reels_media__connection` preloader and downloads the complete highlight album at original quality.

### Guest Sessions vs Authenticated Browser Cookies
- **Public Accounts:** If an Instagram or Facebook account has public stories accessible without an active account, JaneConverter attempts extraction via guest session mode.
- **Friends-Only & Logged-In Stories:** If the account is private, followers-only, or requires an active account to view, JaneConverter utilizes your active desktop browser session (see [Section 7](#7-browser-cookies--zero-extension-session-architecture)). If your desktop browser can see the story, JaneConverter can capture it.

### The Activation Gate & Acceptable Use Policy

Because ephemeral media capture touches privacy and copyright boundaries, JaneConverter gates this ability behind a mandatory safety lock:

```
[ Settings ] --> [ Browser & Sessions ] --> [ Ephemeral Stories Extraction: ON ]
                                                        |
                                                        v
                                       [ Terms of Usage Modal ]
                                       - Legal compliance check
                                       - Consent & rights verification
                                       - Accept to Unlock
```

#### How to Enable Story Extraction:
1. Open **Settings** (gear icon in the sidebar).
2. Click on the **Browser & Sessions** tab.
3. Locate the **Ephemeral Stories Extraction** section.
4. Toggle the switch to **ON**.
5. The **Terms of Usage & Acceptable Use Policy** modal will appear.
6. Read and acknowledge the policy:
   - You confirm you have permission, authorization, or legal rights to archive the media.
   - You agree not to use the tool for harassment, stalking, unauthorized redistribution, or infringing creators' privacy.
7. Click **I Understand & Agree**. Story extraction is now unlocked for your session.
8. *(CLI users: pass the `--allow-ephemeral-stories` flag when executing commands).*

---

## 7. Browser Cookies & Zero-Extension Session Architecture

### Why are Cookies Needed?
Over 90% of conversions (YouTube videos, public Instagram posts, Spotify matching, TikTok, Pinterest) work 100% anonymously in guest mode without ever touching your browser.

However, certain situations strictly require authentication:
- Age-gated YouTube videos (Error 152 / "Sign in to confirm you're not a bot").
- Private or unlisted videos you have access to.
- Friends-only Facebook posts, restricted photo albums, or private group media.
- Instagram stories or followers-only accounts.

### Direct Edge & Chrome Cookie Access (Chromium 127+ Fix)

In mid-2024, Chromium version 127 introduced **App-Bound Encryption** on Windows. This security change locked standard DPAPI cookie extraction, causing third-party tools and downloaders to break unless users installed shady browser extensions or manually exported dangerous plaintext `.txt` cookie files.

**JaneConverter solves this natively without any extensions:**
1. Open **Settings** -> **Browser & Sessions**.
2. Turn on **Read Browser Cookies**.
3. Enable **Direct Edge & Chrome Cookie Access**.
4. **What this does:** JaneConverter configures the official user policy `ApplicationBoundEncryptionEnabled` to `0` in `HKCU\Software\Policies\Microsoft\Edge` and `HKCU\Software\Policies\Google\Chrome`. This instructs the browser to use standard Windows DPAPI encryption for local session cookies.
5. **The Benefit:** JaneConverter can read your logged-in sessions directly from Edge and Chrome with **zero third-party browser extensions** and **zero manual file exports**.
6. *Note on Security:* This adjusts Edge/Chrome encryption policy for your Windows user account. You can toggle it off at any time directly in Settings.

### Non-Chromium Browsers (Firefox, Vivaldi, Brave)
If your primary browser is **Mozilla Firefox**, **Vivaldi**, or **Brave**:
- These browsers utilize standard encryption or dedicated master key vaults.
- Simply select your browser in the **Preferred Browser** dropdown in Settings. No registry policy adjustments are required!

### Volatile Memory Safety & Privacy Guarantee
JaneConverter is architected with strict, zero-leak privacy principles:
- **Shadow Copy Mirror:** When reading cookies, JaneConverter makes a non-locking, temporary snapshot of the browser's SQLite database into RAM. It never locks your active browser or causes browser crashes.
- **Volatile Storage:** Decrypted session tokens are placed in an ephemeral in-memory `RequestsCookieJar`.
- **Zero Disk Leakage:** Plaintext cookies, passwords, and tokens are **NEVER written to disk or logged to files**. Once the media extraction completes, the RAM buffer is immediately zeroed out.
- **No Remote Telemetry:** No cookie data or browsing activity is ever transmitted to any remote server.

---

## 8. FL Studio (.flp) Project Downgrader

### The Problem: Collaboration Lockouts
FL Studio project files (`.flp`) are binary chunk formats. When an artist saves a project in a newer version of FL Studio (e.g. FL Studio 21.2 or FL Studio 24) and sends it to a collaborator who is running an earlier release (e.g. FL Studio 20.8), FL Studio halts loading and displays a blocking modal:

> *"This project was saved in a newer version of FL Studio and cannot be opened."*

This forces producers to either purchase costly upgrades mid-collaboration or manually bounce audio stems.

### Step-by-Step Downgrading Instructions

JaneConverter includes a built-in binary project patcher that edits the project header events, allowing older FL Studio engines to load the project:

```
[ FL Studio Tools ] --> [ Browse .flp ] --> [ Inspect Info ] --> [ Pick Target ] --> [ Downgrade ]
                                              - Tempo / PPQ        - FL 20.8.4        - Safe Copy
                                              - Channel Count      - FL 21.0.3          Created
```

1. Click **FL Studio Tools** in JaneConverter's left sidebar.
2. Click **Browse FLP** or drag-and-drop your `.flp` file into the window.
3. **Inspect Project Metadata:** JaneConverter immediately parses and displays:
   - Project Tempo (BPM)
   - Timebase resolution (PPQ - Pulses Per Quarter Note)
   - Total channel / instrument count
   - Original FL Studio build version
4. **Choose Target Version:** In the dropdown, select the target version used by your collaborator:
   - `20.8.4` (FL Studio 20 compatibility)
   - `21.0.3` (FL Studio 21 early release)
   - `21.2.3` (FL Studio 21 late release)
5. **Click Downgrade Project:**
   - The engine validates the binary chunks, updates the header version identifier, and writes a new file:
     ```
     <OriginalName>_downgraded.flp
     ```
   - **Your original project file is 100% untouched and safe.**

### Supported Versions & Technical Details
- **How it works:** Modifies header event tags and version registration bytes while preserving all pattern notes, automation clips, mixer tracks, plugin routings, and sample references.
- **Plugin Caveat:** If the project utilizes native stock plugins or generators introduced exclusively in newer versions (e.g., *Kepler*, *LuxeVerb*, or *Hyper Chorus*), older FL Studio versions will load the rest of the project normally but report those specific missing plugins as unavailable. Third-party VSTs (Serum, Vital, FabFilter, Kontakt) load seamlessly across versions.

---

## 9. Export Library & Storage Management

All converted files are placed in your structured **JaneConverter Export Library**:

```
JaneConverter Export Library/
├── Music/                  <-- MP3, FLAC, WAV, M4A, Spotify/Apple Music downloads
│   └── Artist - Title.mp3
├── Video/                  <-- MP4, MKV, WebM, YouTube, TikTok, Reels
│   └── Channel - Video Title.mp4
└── Images/                 <-- PNG, JPG, Instagram Carousels, Facebook Albums, Pinterest
    ├── Pin_123456789.png
    └── Instagram_Album_username/
        ├── slide_01.png
        └── slide_02.png
```

### Changing Your Storage Location:
1. Open **Settings** -> **System & Updates**.
2. Under **Data Root Folder**, click **Change Folder**.
3. Select any local folder or external drive (e.g. `D:\MediaLibrary\JaneConverter`).
4. JaneConverter updates its paths instantly. All future conversions and album folders will be saved to your new location.

### Managing Converted Media:
- Click the **Converted** tab in the sidebar to review your history.
- Click any media item to play audio/video directly in the built-in mini-player.
- Click the **Folder** icon next to any file to highlight it directly in Windows Explorer.
- Clear items from history individually or in batch without deleting files from disk.

---

## 10. Presets & Format Reference Cheat Sheet

| Preset Name | Container | Default Bitrate / Resolution | Processing Mode | Recommended Application |
| :--- | :--- | :--- | :--- | :--- |
| **Fast MP3** | `.mp3` | 320 kbps CBR | Fast Transcode | Everyday listening, sample ripping, quick audio tests. Bypasses volume leveling for maximum speed. |
| **Universal Music** | `.mp3` | 320 kbps CBR | DSP Normalization | Archiving songs and playlists. Applies EBU R128 (-14 LUFS) normalization and embeds square cover art. |
| **Lossless Audio** | `.flac` | 24-bit / 48kHz | Bit-Perfect | Studio masters, archiving vinyl/CD rips, DAW sampling. 0% compression loss. |
| **Universal Video** | `.mp4` | 1080p Full HD (H.264/AAC) | Hardware Accelerated | YouTube videos, phone/tablet storage, Discord sharing, TV playback. Universal hardware compatibility. |
| **4K Ultra HD** | `.mp4` / `.mkv` | Up to 3840×2160 | Hardware / Stream Copy | High-end displays, cinematography, preserving maximum source resolution. |
| **Stream Copy** | Same as Source | Original Bitrate | Container Remux (`-c copy`) | Millisecond conversion when source and target formats match. Zero quality loss, zero CPU/GPU overhead. |
| **Lossless Image** | `.png` | Original Dimensions | Uncompressed | Social carousels, wallpapers, artwork, Pinterest pins. Pixel-for-pixel fidelity. |
| **Compact Image** | `.jpg` / `.webp`| High-Quality Web | Web Optimized | Quick photo sharing, web uploads, saving disk storage. |

---

## 11. Troubleshooting, Edge Cases & Pro Tips

### Q: YouTube shows "Sign in to confirm you're not a bot" or Error 152.
**Why it happens:** YouTube triggers bot-detection challenges when requests originate from datacenter ranges or when an account is flagged.  
**How to fix:**
1. Open **Settings** -> **Browser & Sessions**.
2. Make sure **Read Browser Cookies** is enabled.
3. If using Google Chrome or Microsoft Edge, turn on **Direct Edge & Chrome Cookie Access**.
4. Ensure you are signed into YouTube in that browser. JaneConverter will use your active session automatically.

### Q: An Instagram or Facebook story link fails with "Ephemeral story extraction is disabled".
**Why it happens:** Ephemeral story extraction is gated by default to uphold privacy boundaries.  
**How to fix:** Go to **Settings -> Browser & Sessions**, toggle **Ephemeral Stories Extraction** to ON, and accept the Terms of Usage modal.

### Q: An Instagram carousel or Facebook album only downloaded some of the pictures.
**Why it happens:** The post may contain mixed media, or the user's account may be restricted to friends.  
**How to fix:**
1. Ensure the link points directly to the album or post (e.g. `https://www.instagram.com/p/.../` or `https://www.facebook.com/media/set/?set=...`).
2. Make sure your browser is signed into that social network and **Read Browser Cookies** is enabled.

### Q: Why did Stream Copy mode re-encode my file instead of copying?
**Why it happens:** Stream Copy (`-c copy`) is lightning-fast, but it can only execute when:
1. The source and target container types are compatible.
2. No audio filters (e.g. EBU R128 loudness leveling) are requested.
3. No video resolution resizing is selected.
4. No cover art muxing is required.  
If any audio/video modifications are active, the engine intelligently switches to hardware transcoding to apply your settings accurately.

### Q: Can I run multiple conversions at the same time?
**Yes!** Drag and drop multiple files or a complete folder into the app. JaneConverter stages each conversion in an isolated temporary job directory (`temp/job_<id>/`), executing them smoothly in sequence.

### Q: What is the minimum free disk space required?
JaneConverter requires at least **256 MB** of free disk space on your target drive before initiating a conversion. This prevents unfinished, corrupted files from filling a nearly full drive.

### Q: Where are application logs located if I encounter a bug?
Click the **Console** icon in the sidebar to view the live debug stream. Click **Export Logs** to save the log file to your desktop for easy bug reporting or troubleshooting.

---

*JaneConverter is sovereign software engineered with pride by Jane Cerys (`project//aspyr`).*
