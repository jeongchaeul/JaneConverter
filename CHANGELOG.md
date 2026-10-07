# Changelog

All notable changes to JaneConverter are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.2.9] - 2026-10-08 - Experimental FL Studio Downgrade & Theme Harmony

### Added
- Added experimental FL Studio project (`.flp`) downgrade engine supporting inspection of project BPM, PPQ timebase, channel count, and build numbers.
- Added Windows auto-detection for local FL Studio installations (`--flp-detect-installed`) providing 1-click preset targeting in the desktop UI.
- Added surgical binary patching for Event 0xC7 (ASCII version), Event 0x9F (DWORD build number), and UTF-16LE version strings, with playlist clip records (Event 0xD4) adjustment and optional in-place `.bak` safety backup.
- Added explicit `Experimental` badge in the Converter sub-navigation and an informative in-app disclaimer for the FLP converter.

### Changed
- Refactored the Converter sub-navigation and FLP Converter view to strictly inherit the application's global CSS theme tokens (`.panel`, `.field`, `.subtle-button`, `.primary-button`), eliminating visual and styling discrepancies across dark and light modes.


### Added
- Added a conversion completion **Success Modal** showing output format and quality summary, elapsed conversion time, automatic fallback notes, and instant **Play / Open file** and **Open folder** actions, paired with host taskbar attention/glow notifications (`FlashWindowEx` / `request_user_attention`) whenever an operation finishes or fails.
- Added live **Pause / Resume** and **Abort** controls in the Converter and Console views for active conversions and social photo captures, and persisted Converter state across tab switches.
- Added a **Conversion History** tab in the Converted Library alongside **Explorer** and **Recent**, recording conversion duration, preset, output format/quality, status, and fallback notes with per-item and bulk clear controls.
- Added an **Adaptive GPU Acceleration** toggle and status panel in **Settings** that explains automatic GPU video encoding (`MP4`, `MKV`, `MOV`), automatic GPU bypass for *Preserve Quality (Source)*, audio, and images, and multi-core CPU fallback.
- Added bounded, policy-aware media conversion recovery (`src/janeconverter/recovery.py`) across `source-preserve`, `image-pillow` to `image-ffmpeg-frame`, optional lossless `PNG` fallback for non-standard source images, `stream-copy` to `gpu-transcode` to `cpu-transcode`, and `cover-normalized` artwork recovery.
- Added signed per-commit desktop updates via the rolling `continuous` GitHub release (Windows signed NSIS setup `.exe`, Linux `.AppImage`, and macOS app bundles) while disabling unsigned legacy installer downloads.
- Added expanded multi-format conversion support across Audio (`opus`, `aiff`, `aif`, `alac`, `ac3`, `mp2`, `wma`, `caf`, `au`), Video (`avi`, `flv`, `m4v`, `ts`, `m2ts`, `mpeg`, `mpg`, `vob`, `3gp`, `wmv`, `asf`), and Images (`jfif`, `bmp`, `tif`, `tiff`, `gif`, `ico`, `tga`, `ppm`, `pgm`, `pbm`, including animated GIF, APNG, and WebP preservation).
- Added adaptive Browser Bridge story sequence learning (`browser-extension/adaptation.js`) with a 14-day structural preference store and popup reset control.
- Added `packaging/smoke_test_engine.py` packaged engine conversion smoke tests, `FFMPEG-SOURCE-INFO.txt` provenance, bundled `yt-dlp-ejs` runtime support, and pinned FFmpeg release asset SHA-256 digests across consumer release builds.

### Changed
- Coordinated desktop storage paths (`%APPDATA%\JaneConverter` on Windows with automatic migration from legacy `%LOCALAPPDATA%` installs, cleaned Windows extended-length `\\?\` paths, and explicit UTF-8 subprocess environment variables) and hardened Browser Bridge loopback session lifecycle and diagnostics.
- Converted the playlist track selector (`PlaylistDialog`) into a native modal `<dialog>` with focus restoration and Escape-key dismissal.
- Accelerated media transcoding with fast-seek input handling, multi-threaded decoding/encoding, and atomic no-clobber staged file publication (`_publish_staged_file`).

### Fixed
- Detected downloaded social photos from verified image bytes (including Multi-Picture Object / Ultra HDR JPEGs, GIF, BMP, TIFF, and AVIF) rather than relying solely on CDN `Content-Type` headers, and kept two-frame `MPO` gain-map JPEGs as single-frame PNGs.
- Supported username-prefixed Instagram post and Reel links (`/{username}/p/{shortcode}/` and `/{username}/reel/{shortcode}/`), filtered out comment stickers/GIFs and footer post grids, and preserved multi-photo carousel `<ul>` slide tracks.
- Automatically handed off video-only social posts and Reels from the photo capture flow to the video conversion pipeline, and respected user-selected Video presets on social URLs.
- Hardened Facebook album and public Group post photo viewer traversal (`pcb.<post_id>` set synthesis, `all_subattachments` and `currMedia` JSON extraction across nested `container_story`/`creation_story` payloads, `nextMediaAfterNodeId` pagination, and accurate wrap-around detection), photo-set completeness checks, and login-wall/sign-in overlay dismissal across public social photo capture paths.
- Fixed MP3 and audio stream validation so embedded cover art (`attached_pic` video stream) does not falsely fail audio-only validation or trigger unnecessary recovery retries.
- Added backdrop blur (`backdrop-blur-md`) and an opaque surface to the conversion error dialog so console output behind the modal does not bleed through.

## [2.2.6] - 2026-09-29 - FFmpeg Conversion Fallback Fix

### Added
- Added one-link public photo capture code paths for Facebook, Instagram, X/Twitter, TikTok photo posts, Reddit galleries, Tumblr photo posts, and Pinterest Pins, boards, and sections. Live JaneConverter capture has not yet been verified on these platforms; Jane confirmed that the supplied Facebook post is publicly viewable, but app capture of it remains unverified.

### Fixed
- Removed the invalid `-thread_queue_size` arguments from local FFmpeg input commands so Universal Video CPU fallback can proceed with current FFmpeg builds.
- Added a public GitHub releases-feed fallback so the in-app updater can find published updates when the unauthenticated GitHub API is rate-limited or unavailable.
- Automatically remove recognizable login-prompt overlays and restore page scrolling across supported social photo capture paths. Facebook capture also scrolls the photo grid's own lazy-loading container instead of the outer page.

## [2.2.5] - 2026-09-27 - Social Photo Capture and Hardware Pipeline

### Added
- Added local capture of every photo exposed to logged-out visitors in public Facebook multi-photo posts and Instagram/X posts, with grouped exports and safeguards against incomplete or sign-in-gated captures.
- Added the Hardware & Pipeline screen with live CPU, memory, and supported NVIDIA GPU telemetry plus conversion-stage progress.
- Added All, Audios, Videos, Images, and Metadata filters to the converted library.
- Added a JaneConverter market and competitive audit with a product roadmap.

### Changed
- Social photo downloads now honor the selected image output format and quality instead of always keeping the downloaded WebP format.
- Preserved international characters in downloaded album and post names, and made console output safe for unusual Unicode characters.
- Updated the README with the public Facebook, Instagram, and X/Twitter photo capture workflow and its logged-out access limits.

### Fixed
- Prevented files dropped back into the library from being treated as a new library root; the root can only be changed with the library controls.
- Kept files draggable out to other apps while requiring a double-click to open a file from the library.

## [2.2.3] - 2026-09-25 - Preset Selection and UI Improvements

### Added
- Added a Studio Cinematic video preset for source-resolution, highest-quality MKV output.
- Added native file dragging from the converted library into other Windows applications.

### Changed
- Grouped presets under Audio, Video, and Image tabs with distinct icons and accent-color selection states.
- Replaced the advanced-parameters dropdown with an Advanced settings switch; incompatible controls remain visible but disabled.
- Clarified video compression and image-quality labels, and aligned the export-folder controls.

### Fixed
- Selecting an active preset again now clears it and restores the previous manual conversion settings, without a separate No preset button.

## [2.2.2] - 2026-09-22 - First Milestone Stable Release

### Added
- Added `[No preset]` button that reveals advanced conversion parameters for custom settings.
- Added raw stream zero-transcode fast-path for `[Preserve Quality]`, keeping original video and audio intact without re-encoding.

### Changed
- Configured bundled FFmpeg binary path for yt-dlp to merge separate DASH 4K video (`bv*`) and audio (`ba`) streams instead of falling back to legacy single-stream 720p.
- Streamlined category tabs to `Audio`, `Video`, and `Image`, removing the redundant Miscellaneous tab.
- Formatted console download progress as a calm single updating line that updates in-place, eliminating terminal bloat.
- Overhauled presets: Studio Master (32-bit WAV), Universal Music (320k MP3), Lossless FLAC (24-bit), Universal Video (1080p MP4), Lossless Image (PNG).
- Reworded video controls into intuitive consumer language (*Picture quality* and *Picture size*).

### Fixed
- Fixed CLI unpacking crash (`TypeError: cannot unpack non-iterable NoneType object`) on `source`/`original` format.
- Fixed hardware encoder bitrate starvation and rate control (`-rc:v vbr`) on 4K video conversions.

## [2.2.1] - 2026-09-22

### Added
- Added a controlled in-app update flow that lets users install an available update or dismiss it and decide later.
- Added the Preserve Quality conversion preset for outputs that should retain the source quality as closely as the target format allows.

### Changed
- Updated the Browser Capture access page with clearer, consumer-friendly instructions and confirmation wording.
- Refined the conversion controls and settings presentation for a simpler mass-consumer workflow.
- Published stable releases as the updater's discoverable GitHub latest release.

### Fixed
- Corrected conversion preset dropdown alignment and removed the unnecessary alternate theme switch.

## [2.0.0] - 2026-09-21

### Added
- Self-contained Windows x64 installer, Windows portable ZIP, and Linux x86_64 tarball.
- Bundled frozen conversion engine, FFmpeg, FFprobe, and Node.js runtime.
- Tagged release publishing with SHA-256 checksums through GitHub Actions.

### Changed
- Bumped the Python package, desktop app, and Browser Bridge to 2.0.0 for the consolidated product redesign.
- Made the Tauri application the only supported desktop interface.
- Moved packaged settings, temporary files, and converted media to OS user-data directories.
- Updated release checks for versioned installer filenames.
- Migrated the Python backend to the installable `src/janeconverter/` package, managed and locked by uv.
- Replaced source-script execution with the `janeconverter` console command across Tauri, CI, and release packaging.

### Removed
- Legacy Python and Rust desktop interfaces and the C# launcher.
- Source installer, launcher, uninstall, compatibility-build, and staged-update scripts.
- Root Python launch and requirements files superseded by project metadata and `uv.lock`.

## [1.2.0] - 2026-09-20

### Added
- Added the Main UI release surface built with Tauri 2, React, TypeScript, Tailwind CSS, Framer Motion, and Rust-native process/file-dialog bridging.
- Added a shared converted-library browser with root-safe navigation, Open folder, Move library, media thumbnails, cover-art previews, refresh, and safe delete actions.
- Added immediate Relaunch controls to the Main UI, Legacy Rust, and Legacy Python interfaces so the saved launcher preference can be applied without manual restarts.
- Added Apple Music catalog resolution for public song and album links, album track listing, matching-source search, and source troubleshooting guidance.
- Added stale-download protection and Unix frontend preference handling so older native binaries are not silently reused after installation.
- Added the optional local Browser Bridge extension, allowing all three launchers to use a confirmed source-scoped browser session without closing Vivaldi or another Chromium browser.

### Changed
- Made the universal launcher the single entry point for all three interfaces while preserving the legacy launchers as recovery paths.
- Kept converted-library data project-local and consistent across launchers, with the Main UI using the same configured output directory as the legacy interfaces.

### Fixed
- Windows setup now ignores the Microsoft Store Python execution alias and validates a working Python runtime before creating the private environment.
- Preserved per-track playlist credits files even when a provider has no description.
- Added bounded retries for transient playlist downloads and FFmpeg conversions, with fresh temporary directories for each download attempt.
- Added a Python 3.10+ guard to the macOS/Linux installer and clearer Apple Music no-match errors.
- Windows setup now builds the Rust frontend when Cargo is available and moves stale native binaries aside when it is not.
- Windows setup now uses non-interactive winget installs and visible pip progress, so setup should not require Enter to continue.
- Removed the setup wrapper's hidden PAUSE prompt; failed setup runs now preserve the error code and close automatically after a short message.
- Account access now tries a source-scoped, read-only in-memory Chromium session before yt-dlp's normal cookie-database path, so supported Chromium browsers can remain open during conversion.
- Account access now keeps the confirmed localhost handoff alive until the current session is cleared, so the Browser Bridge can connect after confirmation and pass the session to Python over stdin without creating a cookie file.
- Removed the rejected exported-cookie fallback; browser-session authentication never creates or stores a cookie file.

## [1.1.0] - 2026-09-11

### Fixed
- Bounded native output delivery and frame-by-frame event draining to prevent noisy yt-dlp/FFmpeg output from freezing the interface.
- Moved native converted-library scans off the UI thread.
- Abort and window-close now terminate the complete Python/FFmpeg process tree on Windows.
- Added in-app playlist track selection to the Rust frontend.
- Persisted native converter settings beside the application.
- Prevented the writable-directory probe from touching a user-created `.write-test` file.
- Added a restart handoff helper for staged updates and expanded uninstall cleanup for portable installs.

### Changed
- Updated the native launcher and CLI version to 1.1.0.
- Updated release packaging and documentation for the inline live console, playlist selection, supported formats, and restart-safe updates.

### Added
- Experimental macOS/Linux launch scripts, file-manager integration, and CI coverage.
- Native Rust/egui desktop frontend with a smoothly collapsible workspace sidebar, bounded console rendering, non-blocking conversion controls, library actions, and the temporary account-access handoff.
- Optional browser-session authentication for authorized account-only media. JaneConverter can use an existing Chrome, Edge, Firefox, Brave, or Vivaldi session through yt-dlp without requesting passwords or writing cookie files.
- Clear authentication failure guidance and CLI support via `--browser-session`.
- Temporary localhost account-access handoff in the GUI. Users can create a one-time link, sign in through the host's default browser, and enable the existing browser session for the current app session without storing credentials or cookies.
- Native Rust account-access URL validation and browser-session test coverage.
- Rust frontend unit tests for browser detection, HTML escaping, and account-access URL safety.
- Release-package validation that excludes Python bytecode, logs, caches, and runtime data.
- CI coverage for the Rust frontend and Windows release archive contents.
- Reversible interface preference with direct Rust and legacy Python launcher shortcuts.

### Changed
- Extractor update checks are read-only by default; installation now requires explicit permission and remains within the tested dependency range.
- Staged update archives reject traversal, drive-qualified paths, alternate data streams, encrypted entries, excessive file counts, and oversized uncompressed payloads.

## [1.0.0] - 2026-09-07

### Fixed
- **Launch crash**: `gui.py` failed to import (`Callable` used without being imported) on Python 3.13 and earlier.
- **Broken error dialogs**: exception variables captured in deferred lambdas were deleted before display (`NameError` on every conversion or playlist-fetch failure path).
- **Playlist selector**: checkboxes were keyed by a shared fallback index, so selecting one track could silently control another.
- **Single-track credits files**: Source URL and Platform lines were never written (metadata keys did not match the writer).
- **Orphaned partial files**: failed ffmpeg transcodes left truncated output files behind and retries saved under a different name; partials are now cleaned up before every retry and on final failure.
- **Linux VAAPI**: encoder arguments were missing the required render device and `format=nv12,hwupload` filter chain, so VAAPI never worked; webm was also excluded from the GPU-to-CPU fallback.
- **Silent Spotify failures**: unresolvable Spotify links now produce a clear, actionable error instead of feeding a Spotify URL to yt-dlp.
- **Filename sanitization**: Windows reserved device names (CON, NUL, COM1-9, LPT1-9) and control characters are now handled.
- **Video mode in the GUI** no longer parses the resolution menu as an audio bitrate.
- Playlist button styling is restored correctly after a failed catalog fetch.
- `-thread_queue_size` is now applied per input, and output thread scaling applies to the encoder.

### Changed
- **Update pipeline hardened**: yt-dlp upgrades are pinned to the exact PyPI version; the repository self-patch now requires explicit user consent on the "Check for Updates" button, uses `--ff-only` pulls against the configured upstream branch, and honestly reports pip/compiler failures instead of logging unconditional success.
- Engine update checks run once per application start / CLI invocation instead of before every conversion (`--no-update` now actually exists in the CLI).
- Worker threads no longer swap the global `sys.stdout`/`sys.stderr` — a single process-wide console redirector feeds the UI log.
- All worker-to-UI communication goes through a thread-safe UI queue instead of calling Tkinter from worker threads.
- Hardware telemetry runs in a single persistent loop (no thread respawn every 1.5 s; CPU readings no longer flicker 0%).
- Real transcode progress via `ffmpeg -progress pipe:1` (was a hardcoded 0.8→1.0 jump).
- Playlist track lists render progressively, so very large playlists no longer freeze the selection window.
- Conversion success is reported in the status bar with elapsed time instead of a blocking dialog.
- Closing the window during an active conversion asks before aborting; stale temp jobs (older than 24 h) are cleaned up instead of wiping a concurrently running instance's work.
- Disk-space checks before processing; playlist batches abort early after 5 consecutive failures (network-dead detection).
- CLI validates `--format/--bitrate/--sample-rate/--resolution` with clear errors, refuses `--playlist` on local files, and exits non-zero when tracks fail.
- Dependencies carry upper bounds (`<next-major`) to keep fresh installs working; `requirements-dev.txt` added.

### Added
- `--version` CLI flag and `engine/version.py` version singleton (v1.0.0).
- GitHub Actions CI (Windows + Ubuntu, Python 3.10/3.12, pyflakes lint, hermetic tests, opt-in online tests).
- Hermetic test suite (58 tests, no network required) with an opt-in `@pytest.mark.online` marker for the 8 live-network tests.
- Legal & platform notice in the README.

### Removed
- Compiled `JaneConverter.exe` from version control (rebuilt locally by `install.ps1`).
- Undocumented `--no-nvenc` CLI alias (superseded by `--no-gpu`).
- Dead code: unused `_play_latest_file` handler and unused imports.
