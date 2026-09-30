# JaneConverter Roadmap Task List

## Phase 0: Baseline & Defensive Protection

- [x] Task 1: Define the supported conversion matrix (explicit boundary for stream-copy vs transcode)
- [x] Task 2: Establish the conversion regression baseline (fixtures for audio, video, images, corrupted inputs)

### Checkpoint: Baseline & Regression
- [x] Supported conversion matrix documented & approved
- [x] All existing test suites pass (Python, Rust, and frontend unit tests)
- [x] Conversion failure paths map cleanly to specific stages (`InputInvalid`, `ExtractorFailed`, `FFmpegProcessError`, `ValidationFailed`)

---

## Phase 1: Performance Optimization & Engine Refinement

- [x] Task 3: Transparent FFmpeg & hardware diagnostics (startup health check & GPU encoder probe)
- [x] Task 4: High-throughput yt-dlp extraction enhancements (concurrent fragments, format sorting, anti-throttling heuristics)
- [x] Task 5: High-efficiency, audiophile-grade FFmpeg pipelines (conditional `-c copy`, SoX resampling, bit-depth precision, `ffprobe` output validation)

### Checkpoint: Engine Optimization
- [x] Stream-copy (`-c copy`) executes instantly when safe, and reliably transcodes when filters/resampling are active
- [x] Post-conversion `ffprobe` verification eliminates false-positive completions
- [x] SoX high-precision resampling and explicit 24-bit PCM depth active for lossless audio
- [x] Hardware GPU encoders (NVENC, AMF, QSV, VAAPI) discoverable with multi-core CPU fallback

---

## Phase 2: Consumer Workflow Polish

- [x] Task 6: Lightweight conversion queue (drag-and-drop batch conversions with per-item progress and retry)
- [x] Task 7: Context-aware media controls & intent presets (dynamic Audio/Video/Image UI, plain-English goals)
- [x] Task 8: Library completion & post-conversion actions (1-click Open File, Open Folder, Copy Path, Send to Converter)

### Checkpoint: Consumer Workflow
- [x] Non-technical user can process single files or small batches effortlessly
- [x] UI dynamically adapts controls to the active media type without visual clutter
- [x] Converted files are immediately discoverable and accessible

---

## Phase 3: The Adaptive "Mahoraga" Story & Browser Capture Engine

- [x] Task 9: Story surface detection & candidate scoring (modal geometry + accessibility signals + evidence weighting)
- [x] Task 10: Multi-tier capture strategy ladder (Direct → Page fetch → Network → Canvas → Tab crop → MediaRecorder)
- [x] Task 11: Composite story fingerprinting & deduplication (perceptual hashing across rotating CDN tokens)
- [x] Task 12: Local adaptation memory & graceful recovery (structural layout caching without saving secrets/cookies)

### Checkpoint: Adaptive Story Capture
- [x] Story surface detector successfully isolates story modals from avatar/profile thumbnails
- [x] Strategy ladder falls back smoothly through alternatives upon DOM or delivery changes
- [x] Captured items normalize cleanly into Fetched Media
- [x] Story capture failures remain quarantined and cannot freeze or crash the core converter

---

## Phase 4: Maintenance, Security & Release Hardening

- [x] Task 13: User-initiated engine health checks (in-app version check with verified updates & rollback; no silent auto-updates)
- [x] Task 14: Packaged clean-machine smoke tests (automated CI verification of bundled Python, FFmpeg, and Node on clean OS)

### Final Release Gate
- [x] Core local conversion fixture matrix passes across all supported targets
- [x] Conditional stream-copy and high-fidelity SoX audio processing verified
- [x] Post-conversion `ffprobe` validation prevents false completions
- [x] Lightweight batch queue operates reliably without memory leaks
- [x] Mahoraga story engine adapts across test fixtures without destabilizing the core app
- [x] Packaged Windows installer and portable builds convert cleanly on fresh machines

---

## Phase 5: Public Photo Collections

- [x] Task 15: Pinterest board, section, and Pin URL capture through bounded guest-page scrolling
- [x] Task 16: TikTok photo posts, Reddit galleries, and Tumblr photo posts through platform-scoped CDN validation
- [x] Task 17: Converter routing, grouped source folders, documentation, and URL/CDN regression coverage
- [x] Route Instagram `/p/` posts through video extraction when a video preset is selected; keep the primary action label fixed as `Convert media`.
- [ ] Verify capture against real public desktop pages for each platform
- [ ] Verify the supplied Instagram Reel completes as MP4 in the desktop app. The exact `/p/DdwWRyTRMut/` link loaded as a Reel in an isolated guest browser and completed as a validated MP4 through the current CLI engine; the desktop flow remains unverified.
- [ ] Add Snapchat Public Story capture after guest desktop viewing is confirmed

### Checkpoint: Public Photo Collection Support
- [x] Captures use the existing one-link Converter flow and temporary isolated guest sessions
- [x] Incomplete or sign-in-gated collections do not produce saved partial albums
- [ ] Representative public collections complete end to end in the desktop app

---

## Phase 6: Facebook Album Capture Resilience

- [x] Task 18: Route Facebook photo collections and video posts to the correct capture path
- [x] Task 19: Use page-change signals and evidence-based album completion
- [x] Task 20: Handle supported image formats from Facebook rendition responses
- [x] Task 21: Preserve album order and support bounded same-session recovery, including an allowlisted refresh from the active guest page after observed renditions fail
- [ ] Task 22: Verify representative live public albums in the desktop app
  - [x] Replay coverage passes for response-format variation, CDN redirect rejection, observed alternates, refreshed renditions, ordering, and no-partial-save behavior
  - [ ] Manually verify public album capture end to end in the desktop app

The desktop now retains the isolated Facebook guest session for the bounded conversion window and can request fresh renditions for up to eight photos per album. URLs are allowlisted, refresh messages are bound to a request and photo ID, and validated staged photos remain in place while a failed rendition is retried. The supplied Facebook share link loaded as a public post with five visible thumbnails and 23 more items in an isolated guest browser; the desktop album capture check remains open.

### Checkpoint: Facebook Resilience
- [x] Facebook video intent reaches video extraction; photo intent keeps one-link batch capture
- [x] The app only reports a complete album when count/end evidence agrees and all images validate
- [x] Available rendition retries are bounded, order is preserved, and partial albums are never published

---

## Phase 7: Mahoraga Engine for General Conversions

- [x] Task 23: Define output intent, structured failures, and fallback policy
- [x] Task 24: Build the bounded conversion recovery coordinator
- [x] Task 25: Deliver the image recovery vertical slice
- [x] Task 26: Add policy-safe audio recovery strategies
- [x] Task 27: Add policy-safe video recovery strategies
- [x] Task 28: Report outcomes and retain privacy-safe local adaptation evidence

The conversion path now stages outputs, classifies FFmpeg failures, uses declared strategy transitions with attempt/time bounds, validates key audio/video/image properties including requested metadata and frame rate, reports each fallback and final output properties, and records structural local evidence. The image slice is covered by wrong-extension decoding, opt-in PNG recovery, animation/alpha/profile checks, and a stop for unsupported color-managed CMYK conversion. Real local FFmpeg checks cover audio container recovery to requested FLAC and video hardware failure to CPU conversion. A live Instagram Reel also exposed a transient Windows file lock at final publication; sharing violations now receive a bounded retry, with a regression test. The checkpoint remains open until the same paths are observed in the desktop app.

### Checkpoint: Mahoraga Image Recovery
- [ ] An eligible image failure recovers through a validated strategy allowed by the selected quality policy
- [ ] The user can see when recovery changes output format; invalid input and cancellation stop cleanly
- [ ] Failed attempts do not create library entries or alter source files

### Checkpoint: Mahoraga Audio and Video Recovery
- [ ] Existing retries are bounded and coordinated; identical attempts are not repeated
- [ ] Every accepted fallback meets output requirements and passes validation
- [ ] Diagnostics explain the attempted methods without recording private source data

---

## Phase 8: Optional Facebook Graph API Access

- [ ] Task 29: Prove complete Page-media coverage and compare API speed with guest capture
- [ ] Task 30: Add an advanced Settings connection with protected token handling
- [ ] Task 31: Add the in-app “How to get your own Facebook API access” guide
- [ ] Task 32: Route eligible Page media through the API with validated guest fallback
- [ ] Task 33: Verify permissions, pagination, token failure, rate limits, and the setup guide

### Checkpoint: Optional Facebook API
- [ ] Connected capabilities are tested and shown without exposing the token
- [ ] A supported Page collection completes through the API with every item validated and ordered
- [ ] Unsupported content and API failures retain clear, bounded behavior with no partial album

This phase requires a developer-owned Meta test Page and approved access for Task 29's coverage proof. No such access is available for this roadmap run, so the connector and its setup controls remain unbuilt rather than claiming unverified API support.
