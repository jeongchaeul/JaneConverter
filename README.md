# JaneConverter

<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="JaneConverter application icon" />
</p>

<p align="center">
  <strong>Universal Media Downloader & High-Fidelity Audio / Video / Image Transcode Studio</strong>
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

JaneConverter is a high-speed personal media toolbox and format conversion studio designed by Jane Cerys (`project//aspyr`). Built for audio engineering, video transcode workflows, and social media archival, it runs locally through a modern Tauri desktop app or Python CLI.

[Latest Release](https://github.com/jeongchaeul/JaneConverter/releases/latest) · [Changelog](CHANGELOG.md) · [Rebuild Guide](packaging/REBUILD.md)

---

## Highlights

- **Multi-Format Processing**: 15+ audio outputs (WAV, FLAC, MP3, AAC, Opus, AIFF, ALAC...), 15+ video outputs (MP4, MKV, WebM, MOV, AVI...), and all modern image formats (PNG, WebP, JPG/JFIF, TIFF, GIF, AVIF).
- **Audiophile Sound Engine**: 64-bit float SoX resampler (`soxr`, precision 28), EBU R128 loudness normalization (`-14 LUFS`), cover-art muxing (`attached_pic`), and strict `ffprobe` stream validation.
- **Zero-Loss Stream Copy**: Instant container remuxing (`-c copy`) when source codecs match the target, bypassing unnecessary re-encoding.
- **Adaptive GPU Acceleration**: Hardware-accelerated encoding via NVIDIA NVENC, AMD AMF, Intel QSV, or Linux VAAPI, with transparent multi-core CPU software fallback.
- **Smart Online & Social Extraction**: Powered by `yt-dlp` and `yt-dlp-ejs`. Public Spotify and Apple Music catalog matching, plus public guest-mode scraping for Facebook, Instagram, TikTok, Twitter/X, and Reddit photo albums.
- **Batch Queue & Library Explorer**: Drag-and-drop links or files, sequential batch processing, real-time conversion speed/progress, pause/resume, and converted library explorer.
- **Air-Gapped Privacy & Session Recovery**: 100% local by default. Opt-in ephemeral in-memory browser session probing for age-gated (YouTube Error 152) or friends-only content with zero disk writes.
- **Browser Bridge Companion**: Optional extension to pipe audio, video, or story streams directly from active browser tabs over authenticated loopback (`127.0.0.1`).
- **FL Studio (.flp) Project Downgrade**: Binary header inspector and surgical event patcher for cross-version collaboration across FL Studio releases.

---

## The Mahoraga Fallback Engine (Adaptive Architecture)

JaneConverter's core engineering philosophy is anchored in the **Mahoraga Engine**—an adaptive resilience framework inspired by Mahoraga's ability from *Jujutsu Kaisen*. When encountering an obstacle, resistance, or unexpected failure, it does not crash; it analyzes the roadblock and continuously discovers alternative routes until the conversion succeeds:

```mermaid
flowchart TD
    %% Styling Classes
    classDef intake fill:#1e293b,stroke:#475569,stroke-width:2px,color:#f8fafc;
    classDef decision fill:#0f172a,stroke:#64748b,stroke-width:1.5px,color:#f1f5f9;
    classDef errorNode fill:#450a0a,stroke:#dc2626,stroke-width:1.5px,color:#fee2e2;
    classDef adaptNode fill:#042f2e,stroke:#0d9488,stroke-width:2px,color:#ccfbf1;
    classDef transcode fill:#172554,stroke:#2563eb,stroke-width:1.5px,color:#dbeafe;
    classDef goal fill:#14532d,stroke:#16a34a,stroke-width:2px,color:#dcfce7;

    %% 01. INTAKE & ROUTING
    subgraph S_Intake["01. Intake & Source Classification"]
        StartReq["Media Processing Request<br/>(URL / Local File / FLP / Browser Bridge)"]:::intake
        CheckInput{"Source Type<br/>(identify_source_type)"}:::decision
        StartReq --> CheckInput

        CheckInput -- "Local File Path" --> LocalFile["Local Media Direct Ingestion"]:::intake
        CheckInput -- "Browser Bridge Capture" --> BridgeFast["Browser Bridge Fast Path<br/>(Local Loopback 127.0.0.1)"]:::intake
        CheckInput -- "FL Studio Project (.flp)" --> FLPRoute["FLP Binary Patcher & Inspector<br/>(Header Event 0xC7 / 0x9F / 0xD4)"]:::intake
        CheckInput -- "Catalog Link (Spotify / Apple Music)" --> CatRoute["Streaming Catalog Resolution"]:::intake
        CheckInput -- "Social Photo / Album Link" --> SocRoute["Social Guest-Page Scraping<br/>(Facebook / IG / TikTok / X / Reddit)"]:::intake
        CheckInput -- "Standard Media Stream URL" --> WebRoute["yt-dlp Universal Stream Extractor"]:::intake
    end

    %% 02. STREAM EXTRACTION & NETWORK ADAPTATION
    subgraph S_Extraction["02. Online Stream Extraction & Network Adaptation (yt-dlp / EJS)"]
        WebRoute --> ExtractExec["extract_with_recovery()<br/>(Parallel fragments, format_sort HTTPS)"]:::intake
        ExtractExec --> ExtractResult{"Extraction Successful?"}:::decision

        %% Error: Layout / JS Challenge
        ExtractResult -- "Error: ExtractionCategory.LAYOUT<br/>(nsig fail / JS challenge / player drift)" --> ErrLayout["Layout / Signature Challenge Block"]:::errorNode
        ErrLayout --> AdaptLayout["Mahoraga Adaptation: Reset extractor_args,<br/>engage bundled Node.js runtime & yt-dlp-ejs,<br/>fetch fresh upstream challenge solvers"]:::adaptNode
        AdaptLayout --> ExtractExec

        %% Error: Format Not Found
        ExtractResult -- "Error: ExtractionCategory.FORMAT<br/>(requested format not available / no streams)" --> ErrFormat["Format Selector Mismatch"]:::errorNode
        ErrFormat --> AdaptFormat["Mahoraga Adaptation: Strip format constraints,<br/>fall back to resilient universal selector<br/>'bv*+ba/b/best'"]:::adaptNode
        AdaptFormat --> ExtractExec

        %% Error: Network / Rate Limit
        ExtractResult -- "Error: RATE_LIMIT or NETWORK<br/>(HTTP 429 / 502 / 503 / 504 / Socket Timeout)" --> ErrNet["Transient Network / Rate-Limit Barrier"]:::errorNode
        ErrNet --> AdaptNet["Mahoraga Adaptation: Parse Retry-After header,<br/>execute exponential jitter backoff (delay = 2^attempt),<br/>bounded 3-cycle retry within 45s deadline"]:::adaptNode
        AdaptNet --> ExtractExec

        %% Error: Access / Age Gate / Anti-Bot
        ExtractResult -- "Error: ExtractionCategory.ACCESS<br/>(Error 152 18+ / Sign-in Wall / Bot Check / Private)" --> ErrAccess["Access Gate / Age Restriction Trap"]:::errorNode
        ErrAccess --> CheckAuthSetting{"Session Recovery<br/>Enabled in Settings?"}:::decision

        CheckAuthSetting -- "Yes (Opt-In)" --> AdaptAuthProbe["Mahoraga Adaptation: Ephemeral Browser Probing<br/>(Non-locking shadow copy of Chrome/Edge/Brave/Vivaldi/Firefox SQLite DB,<br/>domain-isolated scoping, ephemeral RAM RequestsCookieJar)"]:::adaptNode
        AdaptAuthProbe --> ExtractAuthExec["extract_with_browser_fallback()<br/>(Authenticated in-memory retry)"]:::adaptNode
        ExtractAuthExec --> ExtractAuthResult{"Session Valid?"}:::decision
        ExtractAuthResult -- "Success" --> StreamReady["Raw Stream Ingested<br/>(Preexisting file stat deduplicated)"]:::intake
        ExtractAuthResult -- "Locked DB / DPAPI Fail / Expired Session" --> FallbackBridge["Mahoraga Fallback: Air-Gapped Browser Bridge<br/>(Loopback extension captures active tab buffer)"]:::adaptNode

        CheckAuthSetting -- "No (Air-Gap Default)" --> FallbackBridge
        FallbackBridge --> BridgeFast

        %% TikTok API Host Block
        WebRoute -. "TikTok Source" .-> CheckTikTok{"TikTok API Blocked / Watermarked?"}:::decision
        CheckTikTok -- "API Host Failure" --> AdaptTikTokHost["Mahoraga Adaptation: Rotate API hostnames<br/>(api16-normal vs api22-normal)"]:::adaptNode
        AdaptTikTokHost --> ExtractExec
        CheckTikTok -- "yt-dlp Extractor Exhausted" --> AdaptTikTokDirect["Mahoraga Adaptation: _fetch_tiktok_direct()<br/>(Direct HTML parse & candidate URL permutations)"]:::adaptNode
        AdaptTikTokDirect --> StreamReady

        ExtractResult -- "Success" --> StreamReady
    end

    %% 03. STREAMING CATALOG RECOVERY
    subgraph S_Catalog["03. Cross-Platform Streaming Catalog Recovery (Spotify & Apple Music)"]
        CatRoute --> ResolveMeta["Metadata Scraper & Catalog Resolver<br/>(oEmbed + OpenGraph + iTunes Search API)"]:::intake
        ResolveMeta --> CheckMetaResolved{"Metadata Resolved?"}:::decision

        CheckMetaResolved -- "404 / Region Gated / Private Track" --> ErrMetaFail["Catalog Metadata Gated"]:::errorNode
        ErrMetaFail --> AdaptFallbackTags["Mahoraga Adaptation: Client-Provided Tag Fallback<br/>(fallback_title + fallback_artist)"]:::adaptNode
        AdaptFallbackTags --> BuildCands["Synthesize Search Candidates<br/>(Exact title/artist, stripped feat/remaster/punctuation)"]:::intake

        CheckMetaResolved -- "Metadata Extracted (ISRC/Title/Artist)" --> BuildCands
        BuildCands --> CrossSearch["Cross-Platform Audio Probe<br/>(YouTube Music 'ytsearch5:' & SoundCloud 'scsearch5:')"]:::intake
        CrossSearch --> MatchAlgo["choose_catalog_match() Scoring Engine<br/>(Title Levenshtein, Artist token match, Duration delta <= 15s)"]:::decision

        MatchAlgo -- "Candidate Match Approved" --> IngestMatched["Download Alternate Public Recording<br/>(Retains authoritative catalog tags & album art)"]:::intake
        MatchAlgo -- "Identity Drift / Mismatch Mid-Download" --> RejectCand["Candidate Discarded"]:::errorNode
        RejectCand --> TryNextCand["Mahoraga Adaptation: Shift to Next Ranked Candidate Query"]:::adaptNode
        TryNextCand --> CrossSearch
        IngestMatched --> StreamReady
    end

    %% 04. SOCIAL GUEST SCRAPING & AUTONOMOUS DOM ADAPTATION
    subgraph S_Social["04. Social Guest Scraping & Autonomous DOM Adaptation"]
        SocRoute --> LaunchGuest["Spawn Isolated Sandboxed Guest WebView<br/>(Zero local profile access, ephemeral session)"]:::intake
        LaunchGuest --> GuestScan["DOM Inspection & Media Element Scanner"]:::intake

        %% Login CTA Modal Barrier
        GuestScan --> CheckLoginModal{"Login Wall / Overlay Trap?<br/>(login_popup_cta_form / modal backdrop)"}:::decision
        CheckLoginModal -- "Overlay Detected" --> ErrLoginWall["Login Modal Blocking Content"]:::errorNode
        ErrLoginWall --> AdaptDismiss["Mahoraga Adaptation: closeGuestPrompt()<br/>(Dismiss CTA, prune fixed backdrop overlay,<br/>restore body overflow: scroll)"]:::adaptNode
        AdaptDismiss --> GuestScan

        %% Video Post in Photo Route
        GuestScan --> CheckMediaType{"Content Type in Page?"}:::decision
        CheckMediaType -- "Reel / Video Detected (video tag / og:video)" --> AdaptVideoHandoff["Mahoraga Adaptation: Auto Video Handoff<br/>(Redirect URL to Video Transcode Pipeline)"]:::adaptNode
        AdaptVideoHandoff --> WebRoute

        %% Navigation Deadlock / Button Dropping
        CheckMediaType -- "Public Photo Set / Album" --> ViewerLoop["Photo Viewer Sequencer"]:::intake
        ViewerLoop --> CheckClickStall{"Carousel Click Ignored?<br/>(React synthetic event deadlock)"}:::decision
        CheckClickStall -- "Click Dropped" --> ErrClickDrop["DOM Event Listener Stalled"]:::errorNode
        ErrClickDrop --> AdaptPointerEvent["Mahoraga Adaptation: 5-Stage Event Dispatch<br/>(pointerdown -> mousedown -> pointerup -> mouseup -> click)<br/>+ ArrowRight KeyboardEvent injection"]:::adaptNode
        AdaptPointerEvent --> ViewerLoop

        %% Navigation Stall / Missing Next Arrow
        ViewerLoop --> CheckNavStall{"Next Photo Arrow Missing?"}:::decision
        CheckNavStall -- "Arrow Absent / Obfuscated" --> ErrNavStall["Viewer Navigation Stall"]:::errorNode
        ErrNavStall --> AdaptURLMutation["Mahoraga Adaptation: findFallbackNextPhotoUrl()<br/>(Inspect script tags for nextMediaAfterNodeId,<br/>execute direct URL mutation via location.replace)"]:::adaptNode
        AdaptURLMutation --> ViewerLoop

        %% Viewer Hard Redirect to /login
        ViewerLoop --> CheckViewerRedirect{"Hard Redirect to /login?"}:::decision
        CheckViewerRedirect -- "Viewer Locked by Redirect" --> ErrViewerLock["Viewer Crashed into Sign-in Wall"]:::errorNode
        ErrViewerLock --> AdaptModeSwitch["Mahoraga Adaptation: Autonomous Mode Switch<br/>(Abandon Viewer Mode -> Mutate to Grid Mode /media/set/?set=pcb...)"]:::adaptNode
        AdaptModeSwitch --> GridMode["Album Grid Scroller Mode<br/>(findAlbumScroller() + clickPhotoExpansionControl())"]:::adaptNode
        GridMode --> CollectManifest["Compile Validated Photo Manifest<br/>(Deduplicate photo IDs & high-res CDN URLs)"]:::intake

        ViewerLoop -- "All Photos Captured" --> CollectManifest

        %% CDN 403 Expiry
        CollectManifest --> DownloadPhotos["Download Photos via Streaming Session"]:::intake
        DownloadPhotos --> CheckCDNToken{"CDN URL Expired (HTTP 403)?"}:::decision
        CheckCDNToken -- "Token Expired" --> ErrCDNExpire["403 Media Token Expiry"]:::errorNode
        ErrCDNExpire --> AdaptCDNRefresh["Mahoraga Adaptation: refreshed_candidate_urls()<br/>(Probe secondary alternate CDN URLs from fbcdn/fbsbx,<br/>refresh token from active page context)"]:::adaptNode
        AdaptCDNRefresh --> DownloadPhotos

        CheckCDNToken -- "Valid CDN Stream" --> SocialPhotoDone["Validated Image Batch<br/>(Magic-byte verified JPEG/MPO/WebP/PNG)"]:::goal
    end

    %% 05. TRANSCODING & HARDWARE ACCELERATION RESILIENCE
    subgraph S_Transcode["05. Multi-Tiered Transcode & Hardware Resilience (FFmpeg / Pillow)"]
        StreamReady --> MergeInput["Ingest into Local Processing Engine"]:::intake
        LocalFile --> MergeInput
        BridgeFast --> MergeInput

        MergeInput --> CheckIntent{"Conversion Preset & Intent"}:::decision

        %% Preserve Quality Fast-Path
        CheckIntent -- "Preserve Quality (source/original)" --> SourcePreserve["Fast-Path: Stream Preservation<br/>(Zero transcoding, lossless stream trim if needed)"]:::transcode
        SourcePreserve --> ValidatePreserve{"Format Validated?"}:::decision
        ValidatePreserve -- "Valid" --> StageFile["Staged Output Stored in Temp Directory"]:::intake
        ValidatePreserve -- "Corrupted Container (FailureCategory.VALIDATION)" --> ErrValSource["Source Container Validation Failure"]:::errorNode
        ErrValSource --> AdaptLosslessPNG["Mahoraga Adaptation: image-png Fallback<br/>(Lossless transcode to standard PNG without visual loss)"]:::adaptNode
        AdaptLosslessPNG --> StageFile

        %% Still Image Pipeline
        CheckIntent -- "Target Format: Image (WebP/JPG/PNG/TIFF...)" --> ImagePipeline["Pillow Image Processing (image-pillow)"]:::transcode
        ImagePipeline --> CheckImageDecode{"Pillow Decoder Valid?"}:::decision
        CheckImageDecode -- "Success" --> StageFile
        CheckImageDecode -- "FailureCategory.DECODER<br/>(Rare format: HEIF/AVIF/JXL/PSD/QOI/video-frame)" --> ErrImgDecode["Pillow Decoder Unsupported"]:::errorNode
        ErrImgDecode --> AdaptFFmpegFrame["Mahoraga Adaptation: image-ffmpeg-frame<br/>(Invoke FFmpeg subprocess to extract single pristine PNG frame,<br/>then re-engage Pillow for target format encoding)"]:::adaptNode
        AdaptFFmpegFrame --> StageFile

        %% Audio/Video Transcode Pipeline
        CheckIntent -- "Target Format: Audio or Video" --> CheckStreamCopySafe{"Is Stream Copy Safe?<br/>(Matching codecs, no cover, original res/rate)"}:::decision

        %% Stream Copy Tier
        CheckStreamCopySafe -- "Yes" --> ExecStreamCopy["Strategy: stream-copy<br/>(FFmpeg -c copy instant remuxing)"]:::transcode
        ExecStreamCopy --> CheckCopyResult{"Stream Copy Successful?"}:::decision
        CheckCopyResult -- "Success" --> StageFile
        CheckCopyResult -- "FailureCategory.CONTAINER<br/>(Header write error / incompatible container tags)" --> ErrContainerCopy["Container Stream Incompatibility"]:::errorNode

        %% GPU Acceleration Tier
        CheckStreamCopySafe -- "No" --> CheckGPUAllowed{"Adaptive GPU Acceleration<br/>Active & Supported?"}:::decision
        ErrContainerCopy --> CheckGPUAllowed

        CheckGPUAllowed -- "Yes (NVENC / AMF / QSV / VAAPI)" --> ExecGPU["Strategy: gpu-transcode<br/>(Hardware-accelerated encoding, e.g. h264_nvenc)"]:::transcode
        ExecGPU --> CheckGPUResult{"GPU Encode Successful?"}:::decision
        CheckGPUResult -- "Success" --> StageFile
        CheckGPUResult -- "FailureCategory.HARDWARE / ENCODER<br/>(CUDA OOM / NVENC limit / driver crash / missing device)" --> ErrGPUCrash["Hardware Acceleration Failure"]:::errorNode

        %% CPU Software Fallback Tier
        CheckGPUAllowed -- "No" --> ExecCPU["Strategy: cpu-transcode<br/>(Multi-core CPU: libx264 / libx265 / libvpx / svtav1 / SoX)"]:::transcode
        ErrGPUCrash --> AdaptCPUDowngrade["Mahoraga Adaptation: Graceful Degradation<br/>(Purge broken GPU staging buffer, switch to multi-core CPU)"]:::adaptNode
        AdaptCPUDowngrade --> ExecCPU

        ExecCPU --> CheckCPUResult{"CPU Encode Successful?"}:::decision
        CheckCPUResult -- "Success" --> StageFile

        %% Artwork Embedding Failure
        CheckCPUResult -- "FailureCategory.ARTWORK<br/>(attached_pic mux error / animated GIF cover / bad dimensions)" --> ErrArtwork["Cover Art Muxing Failure"]:::errorNode
        ExecGPU -. "FailureCategory.ARTWORK" .-> ErrArtwork
        ErrArtwork --> AdaptCoverNorm["Mahoraga Adaptation: cover-normalized Strategy<br/>(PIL extracts 1st frame, applies exif_transpose, normalizes to<br/>square 24-bit static RGB PNG, rewrites FFmpeg -map arguments)"]:::adaptNode
        AdaptCoverNorm --> ExecCPU

        %% EBU R128 Dynamic Normalization Fallback
        ExecCPU -. "Loudness Normalization Active" .-> CheckLoudness{"Audio Dynamics Within<br/>Linear EBU R128 Limits?"}:::decision
        CheckLoudness -- "True-Peak Headroom Exceeded" --> AdaptLoudnessDynamic["Mahoraga Adaptation: Dynamic Normalization<br/>(Auto-switch from linear gain to dynamic loudnorm limiter)"]:::adaptNode
        AdaptLoudnessDynamic --> ExecCPU
        CheckLoudness -- "Pass" --> StageFile
    end

    %% 06. POST-PROCESSING, OS RESILIENCY & SELF-LEARNING
    subgraph S_Finalize["06. Post-Validation, OS Resiliency & Self-Learning Evidence"]
        StageFile --> PostProbe{"ffprobe Stream Validation<br/>(Check header, duration, zero-byte guard)"}:::decision
        PostProbe -- "Corrupted / 0-Byte Stream" --> ErrCorrupt["Corrupt Output Detected"]:::errorNode
        ErrCorrupt --> PurgeCorrupt["Purge Corrupted Temp Staging File"]:::errorNode

        PostProbe -- "Validation Passed" --> PublishAtomic["Publish Staged File to Target Directory<br/>(_publish_staged_file)"]:::intake

        %% Windows File Lock Retries
        PublishAtomic --> CheckWinLock{"File In Use?<br/>(WinError 32 / 33 PermissionError from Antivirus / Explorer)"}:::decision
        CheckWinLock -- "Sharing Violation / Locked Handle" --> ErrWinLock["Windows File Lock Collision"]:::errorNode
        ErrWinLock --> AdaptLockRetry["Mahoraga Adaptation: Exponential Jitter Backoff<br/>(5 retry attempts, 0.1s * 2^attempt sleep delay)"]:::adaptNode
        AdaptLockRetry --> PublishAtomic

        CheckWinLock -- "Published Successfully" --> RecordMemory["Mahoraga Adaptation Memory<br/>(Record failure category & winning recovery strategy<br/>to %APPDATA%/JaneConverter/recovery-evidence.json)"]:::adaptNode

        RecordMemory --> FinalSuccess["Goal Accomplished: Ready in Converted Library<br/>(Cover thumbnail attached, duration & bitrate badges registered)"]:::goal
        SocialPhotoDone --> FinalSuccess
        FLPRoute --> FinalSuccess
    end
```

### The 6 Pillars of Mahoraga Adaptation

1. **Extraction & Network**: Bypasses signature/JS challenge changes via bundled Node.js + `yt-dlp-ejs`, handles deprecated stream formats with `bv*+ba/b/best`, and mitigates HTTP 429/5xx rate limits with exponential jitter backoff.
2. **Session Self-Healing**: Ephemerally reads active browser cookies (Chrome, Edge, Brave, Vivaldi, Firefox, Opera) in volatile RAM for age-gated (YouTube Error 152) or private posts, with instant memory wiping upon completion.
3. **Cross-Platform Catalog Matching**: Resolves metadata for Spotify & Apple Music tracks, relaxing query syntax to match and retrieve audio across YouTube Music and SoundCloud with Levenshtein title/duration verification.
4. **Autonomous DOM Navigation**: Dismisses guest login walls on Facebook/Instagram/TikTok, overcomes click-dropping with 5-stage synthetic pointer events, and auto-switches to album grid mode or video handoff when needed.
5. **Multi-Tiered Transcode Resilience**: Cascades smoothly: zero-loss stream copy (`-c copy`) $\to$ GPU acceleration (NVENC/AMF/QSV/VAAPI) $\to$ multi-core CPU encoding, with single-frame extraction for rare image formats.
6. **OS & File Resiliency**: Enforces `ffprobe` zero-byte guards, recovers from Windows file locks (WinError 32/33) via retry backoff, and logs successful patterns to `recovery-evidence.json` for continuous self-learning.

---

## Platform Support

| Platform | Supported Media | Extraction Route | Status |
| :--- | :--- | :--- | :--- |
| **YouTube, SoundCloud** | Audio, Video, Playlists | Direct yt-dlp + Node.js EJS | Verified |
| **Spotify, Apple Music** | Tracks, Albums, Playlists | Catalog Metadata + Public Source Matching | Verified |
| **Instagram** | Single/Multi Photos, Reels | Sandboxed Guest WebView + Video Handoff | Verified |
| **Facebook** | Single/Multi Photos, Group Sets (`gm.`), Reels | Sandboxed Guest WebView + Grid Mode Switch | Verified |
| **TikTok** | Photos, Slideshows, Videos | Direct Stream Extractor + yt-dlp fallback | Verified |
| **X/Twitter, Reddit, Pinterest** | Photos, Galleries, Pins | Guest Page Scraper | Supported |
| **Stories (IG / FB / TT)** | Ephemeral Stories | Browser Bridge Extension (`Collect mode`) | Extension Required |

> [!NOTE]
> Public content is converted directly without browser access. For friends-only posts, private media, or age-gated streams, enable **Session Recovery** in Settings or use the **Browser Bridge** extension.

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

## Installation & Setup

Download the pre-packaged binary for your operating system from the [Latest Release](https://github.com/jeongchaeul/JaneConverter/releases/latest):

- **Windows x64**: `JaneConverter-<version>-windows-x64-setup.exe` (or standalone portable `.zip`)
- **Linux x86_64**: `JaneConverter-<version>-linux-x86_64.AppImage` (or `.tar.gz`)
- **macOS Apple Silicon**: `JaneConverter-<version>-macos-arm64.dmg`
- **macOS Intel**: `JaneConverter-<version>-macos-x86_64.dmg`

Python, FFmpeg, FFprobe, and Node.js runtimes are bundled automatically.

> [!TIP]
> **macOS First Launch**: Because DMGs are ad-hoc signed, Control-click `JaneConverter.app`, choose **Open**, and confirm the Gatekeeper prompt.

---

## How to Use

1. **Add Media**: Paste any media URL or drag & drop files/links directly into the application window.
2. **Choose a Preset or Format**: Select a 1-click goal preset (*Preserve Quality*, *Studio Master 32-bit WAV*, *Universal 1080p MP4*, *Lossless PNG*) or toggle **Advanced settings** for custom bitrates, sample rates, and resolutions.
3. **Convert**: Monitor live encoding speed and progress in the queue. Outputs are organized automatically in the **Explorer** and **History** tabs.

### Privacy & Session Recovery (Opt-In)

- **Air-Gap Default**: JaneConverter never touches local browser files or cookie stores by default. All public media converts completely out-of-the-box.
- **Session Recovery (Settings > Read Browser Cookies)**: Enables ephemeral, in-memory reading of active desktop browser sessions (Chrome, Edge, Brave, Vivaldi, Firefox, Opera) to bypass YouTube Error 152 (age-gate) or friends-only walls.
  - **Local & Ephemeral**: Strictly in-memory RAM (`RequestsCookieJar`); zero cookie files are ever written to disk.
  - **Domain-Isolated**: Only loads cookies for the exact target domain (e.g. `youtube.com`). Passwords, banking, and email data are never accessed.
  - **Instant RAM Wipe**: Session cookies are flushed immediately once the stream download finishes.

---

## Browser Bridge Extension (Optional)

The **JaneConverter Browser Bridge** allows 1-click media and story capture directly from active browser tabs over a local authenticated loopback (`127.0.0.1`):

1. Open your browser's extensions manager (`chrome://extensions` or `vivaldi://extensions`) and toggle **Developer mode**.
2. Click **Load unpacked** and select the repository's `browser-extension` folder.
3. Pin the icon, click **Create access link** in the JaneConverter desktop app, and approve access to start piping media straight to your queue.

---

## FL Studio Project (.flp) Downgrade (Experimental)

Built for music producers collaborating across different FL Studio editions:
- **What it does**: Inspects project tempo (BPM), PPQ timebase, channel count, and build numbers, auto-detects locally installed FL Studio versions on Windows, and surgically patches version headers (ASCII Event `0xC7`, DWORD Event `0x9F`, Event `0xD4`).
- **Notice**: Because recent FL Studio releases introduce proprietary plugin wrappers, always keep backups of original project files before downgrading.

---

## CLI & Development

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

## Governance & Legal

JaneConverter is an independent personal media toolbox developed by Jane Cerys (`project//aspyr`) and shared freely under the MIT License.

- [Legal Disclaimer & Acceptable Use Policy](DISCLAIMER.md)
- [Security Policy & Vulnerability Reporting](SECURITY.md)
- [Third-Party Software Notices](packaging/THIRD-PARTY-NOTICES.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [MIT License](LICENSE)

Copyright © 2026 project//aspyr. All third-party trademarks belong to their respective holders.
