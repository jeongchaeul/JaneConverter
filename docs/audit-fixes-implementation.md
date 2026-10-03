# JaneConverter audit fixes

Implemented and verified on 2026-10-04; a local executable test build was subsequently rebuilt, with no installer or signed release produced.

JaneConverter remains a personal media fetching and conversion tool; these changes improve recovery, output integrity, and honest reporting when a platform changes.

| Finding | Implemented fix | Regression evidence |
| --- | --- | --- |
| Quiet pages could make partial social collections appear complete. | Require an observed total, acknowledged matching items, end evidence, and no count conflict; classify missing evidence as unknown and refuse publication. | Actual capture-script replays cover complete, incomplete, and unknown posts. |
| Browser bytes could be published without proving readable media. | Decode images or probe and decode audio/video before publication, choose the detected container suffix, and reject empty, unreadable, or mismatched bytes. | Tests cover disguised HTML, wrong suffixes, decoder failures, empty streams, and playable WebM without duration metadata. |
| Perceptual similarity could discard distinct stories. | Use exact SHA-256 content identity with sequence context; preserve changed bytes even when their URL or visual hash stays the same. | Collect and signed-in image replays cover repeated bytes, rotated URLs, and changed bytes. |
| Browser operations could outlive their request deadline. | Bound response bodies, script calls, recordings, upload chunks, and sequence work; enforce byte budgets and abort incomplete uploads. | Stalled body/API, stream overflow, rejected-upload cleanup, and native slow-request tests. |
| Catalog searches could download the wrong recording. | Preview candidates and require matching title, artist, version, and available duration; reject ambiguous results and retain the actual public source. | Integrated extraction tests prove uncertain candidates are never downloaded. |
| Extraction retries did not distinguish recoverable changes from terminal failures. | Classify failures, cap recovery attempts, respect server waits, support cancellation, and retry obsolete provider overrides with maintained defaults. | Tests cover changed extractors, access failures, cancellation, and rate-limit delays. |
| Release updates could ship an incompatible companion extension. | Build the archive from current source, require bridge protocol 2, add compatibility metadata, and smoke-test the engine's extractor and media validator. | Archive bytes are compared with source; updater-enabled compilation and source runtime smoke checks pass. |
| History and capture provenance depended on browser storage or filenames. | Migrate history into a native versioned catalog, sync writes with a previous snapshot, retain source/time/method, and show failed history writes with Retry. | Tests cover migration failure/retry, corrupt snapshots, failed writes, signed-query redaction, and same-name captures. |
| Playlist loading could keep the desktop waiting indefinitely. | Run the loader off the UI thread with a 60-second native deadline and an explicit Cancel control. | Native process deadline/cancellation and desktop overlay cancellation tests. |
| Requested linear loudness normalization could be reported as guaranteed linear processing. | Read FFmpeg's actual second-pass result and disclose linear, dynamic, or unconfirmed processing. | Real FFmpeg conversions exercise linear and dynamic results; invalid measurements are rejected. |
| Static checks did not sufficiently exercise changing-platform failure paths. | Add executable collection, story, extraction, persistence, and rendered-media replays alongside the existing contracts. | The engine, native, desktop, and extension suites pass. |

The native catalog uses versioned JSON snapshots with serialized, synced writes and recovery backups; it does not claim SQLite transactions or resumable interrupted conversions.

Adaptation remains bounded: public extraction can refresh provider defaults, browser capture can try alternative existing methods, and a method is remembered only after native validation acknowledges success. Sign-in failures now get one automatic browser-session fallback as described below; DRM, deleted content, and ordinary access refusals do not trigger it.

## Automatic sign-in recovery

Public extraction still runs first. For supported HTTPS media platforms, an explicit sign-in/cookie requirement now makes yt-dlp read the supported default browser's existing session and retry the same source using provider-maintained client defaults. No extension toggle or cookie-file export is required. The authenticated request retains only that platform's cookies, forces HTTPS cookie delivery, suppresses credential-bearing debug output, and clears its cookie jar on success, failure, or cooperative cancellation. Playlist retries do not repeat terminal browser-session failures.

yt-dlp reads the selected browser's cookie database across sites before JaneConverter filters its cookie jar; its browser-reader may make a temporary database copy, which it cleans after normal extraction. This changes the engine's previous no-cookie-reading promise; the Browser Bridge extension remains cookie-free. Unsupported default-browser detection, missing site cookies, browser locks, and unsupported encryption produce an actionable failure with Browser Capture as an alternative. No other browser's profile is tried automatically.

Synthetic-cookie tests use the actual yt-dlp browser-cookie loader integration and verify public-first behavior, successful recovery, domain filtering, cleanup, cancellation, private diagnostic suppression, and a single failed authentication attempt. They do not establish that the two reported videos are accessible with the user's account.

After this follow-up, 256 engine tests and 61 desktop tests passed, along with Python lint, TypeScript compilation, and the frontend production build. The executable was rebuilt at `dist/adaptive-session-test-exe/JaneConverter.exe`; its embedded frontend and frozen engine's automatic-session capability were verified, and the packaged engine passed the local WAV-to-MP3 smoke check. No installer was rebuilt. Actual browser-cookie access was not exercised against the user's profile.

## Verification

- Engine: 237 tests passed; 9 online tests deselected.
- Native bridge: 60 tests passed; updater-enabled compilation and Rust formatting passed.
- Desktop: 61 tests passed; TypeScript and production frontend build passed.
- Browser Bridge: 37 tests passed; the 2.0.1 archive matches current source with canonical line endings across Windows and Unix checkouts.
- Python lint and diff whitespace checks passed.
- Source runtime smoke: local WAV converted to a readable one-second MP3, then validated through the new capture validator.
- Frozen engine smoke: the rebuilt engine converted and validated audio, accepted readable JPEG bytes, and rejected HTML disguised as an image.
- Local EXE: `dist/audit-test-exe/JaneConverter.exe` embeds the current frontend and includes the rebuilt engine and matching Browser Bridge in its test folder; generated test files are excluded from Git.

## Practical limits

- Live signed-in platforms, interactive desktop behavior, signed updates, and macOS/Linux builds were not exercised here.
- Collections without trustworthy count/end evidence are refused rather than presented as complete; improving platform-specific evidence remains ongoing maintenance.
- Catalog identity is checked against metadata, not an audio fingerprint; uncertain matches require the intended recording's direct link.
- Audio/video validation decodes up to the first second, so it cannot certify an entire long recording; missing duration is permitted only when decoding proves playable data.
- Perceptual hashes no longer prove equality; exact image bytes are deduplicated where available, while differently encoded recordings can remain separate captures.
- Recovery deadlines limit retries between extraction calls; network socket limits bound individual I/O, but the extraction helper does not forcibly terminate every underlying provider operation.
- The frontend build retains its bundle-size advisory; no unrelated bundle refactor was included.

## Update recovery

Before installing an update, the app preserves the readable history catalog and capture catalog under `update-backup` in its selected data folder; media files remain in their existing folders.

For a manual rollback, close JaneConverter, preserve a copy of the current data folder, install a previously trusted compatible application build, and reload its matching bundled Browser Bridge; restore `update-backup/catalog.json` into the data folder and `update-backup/capture-catalog.json` into the configured fetched-media folder only if their schemas are supported by that build.

An older build that predates the native catalog cannot display its history; retain the catalog files for a compatible build instead of deleting or rewriting them.
