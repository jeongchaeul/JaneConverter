# The Adaptive Resilience Engine

*Multi-Tiered Automated Recovery, Dynamic Extraction Fallbacks, and Stream Healing*  
*(Architecture Codename: Mahoraga)*

JaneConverter's **Adaptive Resilience Engine** embodies a single, uncompromising principle:

**When media extraction, network transport, authentication barriers, DOM obfuscation, or hardware transcoding face resistance or failure, JaneConverter does not abort; it analyzes the roadblock, rotates strategy, and adapts until pristine media is delivered.**

This document serves as the comprehensive technical guide and reference for both human contributors and autonomous AI agents working on JaneConverter.

---

## Table of Contents

1. [Architecture Motivation: The Problem Space](#1-architecture-motivation-the-problem-space)
2. [Core Architecture & Flowchart](#2-core-architecture--flowchart)
3. [The 6 Pillars of Adaptive Resilience](#3-the-6-pillars-of-adaptive-resilience)
   - [Pillar 1: Stream Extraction & Network Adaptation](#pillar-1-stream-extraction--network-adaptation)
   - [Pillar 2: Authenticated Session Adaptation & DPAPI Recovery](#pillar-2-authenticated-session-adaptation--dpapi-recovery)
   - [Pillar 3: Cross-Platform Streaming Catalog Resolution](#pillar-3-cross-platform-streaming-catalog-resolution)
   - [Pillar 4: Autonomous DOM Scraping & Guest UI Traversal](#pillar-4-autonomous-dom-scraping--guest-ui-traversal)
   - [Pillar 5: Multi-Tiered Transcode & Hardware Resilience](#pillar-5-multi-tiered-transcode--hardware-resilience)
   - [Pillar 6: OS Resiliency & Self-Learning Evidence](#pillar-6-os-resiliency--self-learning-evidence)
4. [Case Study: Pinterest Notification Collections (`news_hub`)](#4-case-study-pinterest-notification-collections-news_hub)
5. [Agent & Developer Guidelines: Adding New Adaptations](#5-agent--developer-guidelines-adding-new-adaptations)

---

## 1. Architecture Motivation: The Problem Space

Modern web media ingestion and local format conversion exist in an inherently volatile environment:

- **Aggressive Anti-Bot Mechanisms**: Streaming platforms deploy runtime JavaScript challenges, changing signature algorithms (`nsig`), and experimental player layouts without warning.
- **Walled Gardens & Dynamic Auth**: Social platforms (Instagram, Facebook, Pinterest) redirect unauthenticated visitors from personal notifications or collections to homepage feeds, login screens, or low-resolution thumbnails.
- **Client Encryption Shifts**: Modern Chromium browsers (version 127+) restrict cookie access on Windows using App-Bound Encryption, breaking standard DPAPI extraction tools.
- **DOM Obfuscation & Synthetic Event Drops**: Web applications using React synthetic event systems often swallow standard mouse clicks or hide pagination arrows during scraping.
- **Hardware & Transcoder Instability**: Dedicated GPU encoders (NVENC, AMF, QSV) encounter VRAM exhaustion (CUDA OOM), driver limits, or unsupported profile combinations.
- **Host OS File Contention**: Windows Antivirus scanners and Windows Search indexers briefly hold exclusive file locks (`WinError 32/33 PermissionError: Access is denied`) right as a media file finishes writing.

Standard downloaders fail when encountering any single one of these barriers. The Adaptive Resilience Engine guarantees that JaneConverter treats errors as signals to pivot strategies rather than fatal termination points.

---

## 2. Core Architecture & Flowchart

The following diagram tracks the lifecycle of an ingestion request through each adaptation tier:

<p align="center">
  <img src="photos/mahoraga-pipeline.svg" width="100%" alt="Adaptive Resilience Pipeline Architecture" />
</p>

---

## 3. The 6 Pillars of Adaptive Resilience

### Pillar 1: Stream Extraction & Network Adaptation
*Modules: `src/janeconverter/extraction_recovery.py`, `src/janeconverter/extractor.py`*

1. **JavaScript & Signature Solver Adaptation (`ExtractionCategory.LAYOUT`)**:
   - Modern streaming platforms frequently push obfuscated challenge changes.
   - When detected, JaneConverter resets internal engine state, attaches bundled Node.js execution environments, activates `yt-dlp-ejs`, and runs external signature solvers.
2. **Universal Format Selector Cascades (`ExtractionCategory.FORMAT`)**:
   - When a strict format selector (e.g. `bestvideo[height<=1080]+bestaudio`) fails due to missing streams, the selector cascades to `bv*+ba/b/best` before failing.
3. **Bounded Jittered Backoff (`ExtractionCategory.RATE_LIMIT`, `NETWORK`)**:
   - Network timeouts, socket resets, and HTTP 429/502/503/504 errors trigger exponential backoff with jitter ($2^{\text{attempt}} \pm \text{random}$). Retries are bounded to a 45-second overall deadline to prevent hanging threads.
4. **Host Permutation & Direct Scraping (TikTok)**:
   - TikTok frequently blocks regional API endpoints. The engine rotates through endpoints (`api16-normal`, `api22-normal`) and falls back to `_fetch_tiktok_direct()` to parse direct HTML and stream candidates directly.

---

### Pillar 2: Authenticated Session Adaptation & DPAPI Recovery
*Modules: `src/janeconverter/social_photo_capture.py`, `src/janeconverter/auth.py`, `src/janeconverter/cookie_unlocker.py`*

1. **Air-Gap First, Ephemeral Probing Second**:
   - By default, JaneConverter operates in 100% air-gapped guest mode. No local browser profiles or cookie stores are accessed unless explicitly enabled or required by a private/authenticated link.
2. **Volatile In-Memory Cookie Jars**:
   - When an authenticated or age-gated link (e.g., YouTube Error 152, friends-only posts, Pinterest notifications) is processed, the engine takes a non-locking shadow copy of the browser SQLite cookie database into temporary memory.
   - Decrypted cookies are stored in a volatile `RequestsCookieJar` in RAM and immediately zeroed out after the request completes. No plaintext cookies are ever written to disk.
3. **Chromium App-Bound Encryption Navigation**:
   - Chromium 127+ introduced Windows App-Bound Encryption, which restricts DPAPI cookie decryption for non-system callers.
   - The Adaptive Engine negotiates with available browsers that use standard DPAPI (such as Vivaldi, Firefox, Brave, and Edge), automatically discovering which browser holds a valid active session.
4. **Loopback Browser Bridge Fallback**:
   - If local database extraction is completely locked, the engine falls back to the authenticated loopback **Browser Bridge Extension** (`127.0.0.1`), allowing users to capture directly from their active browser tab.

---

### Pillar 3: Cross-Platform Streaming Catalog Resolution
*Modules: `src/janeconverter/extractor.py`, `src/janeconverter/catalog.py`*

1. **Metadata Ingestion & Normalization**:
   - Resolves metadata for Spotify and Apple Music URLs via oEmbed, OpenGraph tags, and the iTunes Search API.
2. **Query Permutation & Tag Stripping**:
   - If initial matches fail, titles and artists are normalized: parenthetical additions (e.g., `(feat. ...)`, `(Remastered 2021)`), punctuation, and special characters are stripped to produce prioritized search query candidates.
3. **Multi-Source Cross-Probing**:
   - Searches across YouTube Music (`ytsearch5:`) and SoundCloud (`scsearch5:`).
4. **`choose_catalog_match()` Verification Algorithm**:
   - Evaluates search candidates against strict acceptance criteria:
     - Title Levenshtein similarity distance threshold.
     - Artist token inclusion.
     - Duration variance check: candidates differing by more than 15 seconds from the official catalog duration are rejected to avoid live versions, covers, or extended cuts.
   - The downloaded stream is re-tagged with the authoritative high-resolution album artwork, ISRC, and artist tags from the original catalog.

---

### Pillar 4: Autonomous DOM Scraping & Guest UI Traversal
*Modules: `desktop-ui/src-tauri/src/social_photo_capture.rs`, `desktop-ui/src-tauri/src/facebook_capture.rs`*

When capturing photo albums from walled gardens (Facebook, Instagram, TikTok) in a headless, sandboxed guest webview:

1. **Modal & Login Backdrop Dismissal**:
   - Detects `login_popup_cta_form` and full-page backdrop overlays, injecting scripts to prune overlay elements and restore `document.body.style.overflow = "scroll"`.
2. **5-Stage Pointer Event Synthesis**:
   - Modern SPA frameworks (React/Vue) listen to composite pointer events and ignore bare DOM `.click()` calls.
   - The engine fires a complete 5-stage event sequence:
     $$\text{pointerdown} \longrightarrow \text{mousedown} \longrightarrow \text{pointerup} \longrightarrow \text{mouseup} \longrightarrow \text{click}$$
     plus `KeyboardEvent("ArrowRight")` injection to navigate carousels reliably.
3. **Autonomous Mode Switching**:
   - If viewer carousels redirect to `/login` halfway through an album, the engine automatically catches the redirect, mutates the URL to an album grid mode (`/media/set/?set=pcb...`), and scrapes the remaining photos via grid thumbnails and expansion modals.
4. **Token Refresh on CDN 403**:
   - If a CDN media link returns HTTP 403 Forbidden during download, the engine reaches back into the active page context to refresh secondary alternate CDN URLs (`fbcdn.net`, `fbsbx.com`).

---

### Pillar 5: Multi-Tiered Transcode & Hardware Resilience
*Modules: `src/janeconverter/converter.py`, `src/janeconverter/image_format.py`*

Conversion cascades through three performance tiers:

1. **Zero-Loss Stream Copy (`-c copy`)**:
   - If input and output audio/video codecs match, no cover art needs muxing, and no resampling or resizing is requested, the engine executes direct container remuxing with zero quality loss and near-instant completion.
2. **GPU Acceleration Tier**:
   - When transcoding is required, hardware encoders (NVIDIA NVENC, AMD AMF, Intel QSV, Linux VAAPI) are engaged based on system availability.
3. **Graceful CPU Degradation**:
   - If hardware encoding crashes (CUDA out-of-memory, unsupported profile combination, or driver error), the engine purges the corrupted GPU staging buffer, switches to multi-core CPU software encoders (`libx264`, `libx265`, `svtav1`, `libvpx-vp9`), and completes the transcode without user intervention.
4. **Artwork Normalization (`cover-normalized`)**:
   - Incompatible cover images (animated GIFs, CMYK color profiles, excessive dimensions) can crash FFmpeg's `attached_pic` muxer. The engine catches muxing errors, extracts the primary frame using Pillow, applies `ImageOps.exif_transpose`, normalizes the image to a static square RGB PNG, and re-executes the transcode.
5. **Dynamic Loudness Limiter**:
   - During EBU R128 audio normalization (`-14 LUFS`), if linear gain adjustment would clip the true-peak ceiling, the engine shifts to a two-pass dynamic `loudnorm` limiter.
6. **Rare Image Frame Extraction (`image-ffmpeg-frame`)**:
   - If Pillow cannot decode rare or animated container formats (HEIF, AVIF, animated WebP, PSD, QOI), FFmpeg extracts a single pristine uncompressed PNG frame before passing it back to Pillow.

---

### Pillar 6: OS Resiliency & Self-Learning Evidence
*Modules: `src/janeconverter/converter.py`*

1. **Atomic File Staging & Publish**:
   - All conversions are processed in an isolated staging folder (`temp/job_<id>/`).
   - Destination files are only moved into the public output directory after full stream validation passes.
2. **`ffprobe` Stream & Zero-Byte Guards**:
   - Completed files are probed with `ffprobe` to verify valid headers, stream continuity, and minimum byte length. Corrupted outputs are immediately purged.
3. **Windows File Lock Collision Recovery**:
   - On Windows, security suites or Windows Search often hold open handles (`WinError 32 / 33`) immediately after a file is closed.
   - The engine executes exponential backoff across 5 attempts ($0.1\text{s} \times 2^{\text{attempt}}$) until the lock is released.
4. **Persistent Adaptation Memory**:
   - Successful recovery strategies are recorded into:
     ```text
     %APPDATA%/JaneConverter/recovery-evidence.json
     ```
   - Subsequent jobs analyze historical evidence to select the fastest winning strategy on the very first attempt.

---

## 4. Case Study: Pinterest Notification Collections (`news_hub`)

A prime example of the Adaptive Resilience Engine in action is the resolution of Pinterest notification collections:

### The Challenge
When a user pastes a Pinterest notification link:
```text
https://ph.pinterest.com/news_hub/3943610033677608128/
```
1. **Guest Wall**: In an unauthenticated session, Pinterest 302-redirects guest traffic to the homepage (`ph.pinterest.com/`). The standard guest scraping webview previously captured random homepage photos.
2. **Thumbnail Degradation**: Standard extractors only pulled low-resolution 150×150 or 236× thumbnails displayed on notification cards.
3. **Windows Chromium Encryption**: Chrome 127+ blocked external cookie reading via Windows App-Bound Encryption.

### The Adaptive Recovery Route
1. **Route Recognition**: The frontend identifies the URL as a notification route (`/news_hub/` or `/notifications/`) and routes it directly to the engine's browser session adapter.
2. **Browser Negotiation**: The engine checks active browsers on the system (Vivaldi, Firefox, Chrome, Edge) and discovers Vivaldi's active, DPAPI-readable Pinterest session containing `_auth=1`, `_pinterest_sess`, and `csrftoken`.
3. **API Level Interception**: Rather than fighting dynamic DOM rendering, the engine calls Pinterest's internal `NewsHubDetailsResource` API endpoint:
   ```text
   GET https://ph.pinterest.com/resource/NewsHubDetailsResource/get/?source_url=/news_hub/3943610033677608128/&data={"options":{"news_id":"3943610033677608128"},"context":{}}
   ```
4. **Resolution Upgrade**: Ingests all 15 photo nodes, discovers the collection title (`Made the cut`), and rewrites thumbnail CDN paths (`/150x150/`, `/236x/`) to `/originals/`.
5. **Parallel Download & Transcode**: Downloads 15 uncompressed (1440×1440) originals concurrently in **~5 seconds**, converting to pixel-for-pixel lossless PNGs in:
   ```text
   converted/Images/Pinterest/Made the cut/
   ```

---

## 5. Agent & Developer Guidelines: Adding New Adaptations

When extending JaneConverter, follow these core tenets to uphold the Adaptive Resilience architecture:

### 1. Never Fail Fast on Expected External Volatility
External websites and hardware encoders *will* fail. Do not raise bare fatal exceptions when a fallback path is mathematically or structurally possible.

### 2. Classify Failures into Structured Categories
Never catch generic `Exception` and guess the fix. Route errors through structured enum classifiers:
- `ExtractionCategory` (LAYOUT, FORMAT, ACCESS, RATE_LIMIT, NETWORK)
- `FailureCategory` (HARDWARE, ENCODER, CONTAINER, ARTWORK, DECODER, VALIDATION)

### 3. Maintain Maximum Resolution and Bit-Depth
When adapting to a fallback route, never degrade image resolution, audio sample rate, or video dimensions unless the user's explicit preset demands it. Prioritize `/originals/` CDN mirrors over downscaled display buckets.

### 4. Zero Secret Persistence
Session cookies, authentication tokens, and query credentials must remain strictly in volatile RAM. Never write raw cookies or auth payloads to logs, configuration files, or persistent storage.

### 5. Log Winning Strategies to Adaptation Memory
When a new recovery strategy succeeds, record the failure category, input signature, and winning strategy so the engine learns and applies the optimal path on subsequent runs.
