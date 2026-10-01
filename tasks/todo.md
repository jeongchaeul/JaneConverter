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


---

## Foundation and Workflow Advantage Extension — 2026-10-02

All tasks below are proposed and unchecked. They extend the same roadmap; previous incomplete work and historical completion records remain intact. See the matching section in `tasks/plan.md` for architecture, sequencing and measurement policy. No implementation or runtime verification was performed when adding this map.

### Task 34: Reconcile the workflow baseline

**Status:** Proposed. **Dependencies:** None. **Estimated scope:** Small.

**Deliverable:** Reconcile the workflow baseline as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Record implemented, fixture-tested, live-verified and experimental status separately; retain earlier open checks.
- [ ] Define complete/incomplete/unknown and original/rendered outcomes for the three priority workflows.
- [ ] List dated evidence and unknowns without treating old checkmarks as fresh test results.

**Verification:** Source trace and review of the support matrix against actual entry points.

**Likely files:** tasks/plan.md; tasks/todo.md; docs/workflow-support-matrix.md.

### Task 35: Build the representative regression corpus

**Status:** Proposed. **Dependencies:** 34. **Estimated scope:** Medium.

**Deliverable:** Build the representative regression corpus as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Catalog approximately 40 meaningful cases including Arabic paths, misleading thumbnails, changed layouts, missing members and near-identical patch-note images.
- [ ] Reuse existing harnesses, keep fixtures synthetic or sanitized, and record expected media identities and order.
- [ ] Record current results before changing engine behavior; unsupported cases remain explicit expected limitations.

**Verification:** Run targeted pytest, Vitest and node:test suites; record failures and baseline observations.

**Likely files:** desktop-ui/test/facebook-replay.test.js; desktop-ui/test/fixtures/; browser-extension/test/media-utils.test.js; tests/test_social_photo_capture.py.

### Checkpoint after Task 35

- [ ] All applicable task acceptance criteria are supported by current evidence.
- [ ] Focused checks pass; integration checkpoints include Python, Browser Bridge, frontend/build and Rust checks as affected.
- [ ] A representative packaged user flow works and source files remain untouched by the operation.
- [ ] Review the result and unresolved limits before expanding scope; no assumed live-site coverage.

### Task 36: Persist source context for one captured item

**Status:** Proposed. **Dependencies:** 34–35. **Estimated scope:** Medium.

**Deliverable:** Persist source context for one captured item as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Add versioned local catalog storage through the native boundary; evaluate a compatible SQLite binding before any dependency edit.
- [ ] Store a safe source permalink, capture time, method, dimensions, stable ID and file association; never store signed delivery URLs or credentials.
- [ ] Reopening the app retains those fields for a captured item and handles catalog-write failure without deleting accepted media.

**Verification:** Rust temporary-directory tests for reopen, redaction, schema migration and write failure; manual one-item restart check.

**Likely files:** desktop-ui/src-tauri/src/catalog.rs (new); desktop-ui/src-tauri/src/model.rs; desktop-ui/src-tauri/src/access.rs; desktop-ui/src-tauri/Cargo.toml.

### Task 37: Make conversion history durable

**Status:** Proposed. **Dependencies:** 36. **Estimated scope:** Medium.

**Deliverable:** Make conversion history durable as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Migrate existing 200-row localStorage history idempotently, retaining a backup and tolerating malformed entries.
- [ ] Record succeeded, failed and cancelled jobs with source/output relationships; never invent missing capture provenance.
- [ ] History survives restart and clearing history does not delete media; report persistence errors visibly.

**Verification:** Migration rerun and malformed-record tests; frontend history/restart and clear-with-files-preserved scenarios.

**Likely files:** desktop-ui/src-tauri/src/catalog.rs; desktop-ui/src-tauri/src/lib.rs; desktop-ui/src/bridge.ts; desktop-ui/src/App.tsx; desktop-ui/src/App.test.tsx.

### Task 38: Recover interrupted file publication

**Status:** Proposed. **Dependencies:** 36–37. **Estimated scope:** Medium.

**Deliverable:** Recover interrupted file publication as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Journal publication intent and reconcile interruptions around file publication and catalog commit with no-clobber behavior.
- [ ] Preserve validated files through disk-full, locked-file and crash cases; never list an unvalidated output as complete.
- [ ] Offer interrupted-job review after restart and make repeated recovery idempotent without silently restarting browser work.

**Verification:** Inject at least 20 interruptions across transfer/validation/publication/catalog boundaries; confirm no loss or duplicate publication.

**Likely files:** desktop-ui/src-tauri/src/catalog.rs; desktop-ui/src-tauri/src/access.rs; desktop-ui/src-tauri/src/process.rs; src/janeconverter/converter.py; tests/test_recovery.py.

### Checkpoint after Task 38

- [ ] All applicable task acceptance criteria are supported by current evidence.
- [ ] Focused checks pass; integration checkpoints include Python, Browser Bridge, frontend/build and Rust checks as affected.
- [ ] A representative packaged user flow works and source files remain untouched by the operation.
- [ ] Review the result and unresolved limits before expanding scope; no assumed live-site coverage.

### Task 39: Wrap Facebook capture in the shared contract

**Status:** Proposed. **Dependencies:** 35–38. **Estimated scope:** Medium.

**Deliverable:** Wrap Facebook capture in the shared contract as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Expose ordered candidates, source identity, count/end evidence and categorized outcomes from the existing Facebook path.
- [ ] Move only shared coordination into the new contract while preserving one-link automatic collection behavior.
- [ ] Existing successful fixtures remain equivalent and conflicting completion evidence remains incomplete.

**Verification:** Run Facebook replay, Rust and Python Facebook capture tests; verify representative permitted desktop collection.

**Likely files:** desktop-ui/src-tauri/src/capture.rs (new); desktop-ui/src-tauri/src/facebook_capture.rs; desktop-ui/src-tauri/src/lib.rs; desktop-ui/test/facebook-replay.test.js.

### Task 40: Adopt the same contract for Instagram

**Status:** Proposed. **Dependencies:** 39. **Estimated scope:** Medium.

**Deliverable:** Adopt the same contract for Instagram as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Route Instagram photos and video handoff through the common contract without a Facebook-shaped navigation assumption.
- [ ] Preserve carousel order and refuse unrelated grid/comment media.
- [ ] One platform failure leaves the other adapter and local conversion working.

**Verification:** Instagram carousel/reel/changed-layout replay cases and permitted desktop examples; cross-adapter regression checks.

**Likely files:** desktop-ui/src-tauri/src/capture.rs; desktop-ui/src-tauri/src/social_photo_capture.rs; desktop-ui/src-tauri/src/lib.rs; desktop-ui/test/instagram-replay.test.js (new).

### Task 41: Make story-session state explicit

**Status:** Proposed. **Dependencies:** 35–36,39. **Estimated scope:** Medium.

**Deliverable:** Make story-session state explicit as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Test the actual CDID viewer after identifying its platform; track observed item transitions and completion evidence instead of treating silence as completion.
- [ ] Maintain capture while the popup is closed using the existing collection lifecycle where possible; enforce session budgets and cancellation.
- [ ] Preserve sequence order and distinguish original media from rendered content, including whether patch-note overlays were retained.

**Verification:** Replay slow transitions, long videos, popup closure, duplicate URLs, changed text, missing audio and unknown sequence totals; manual CDID session check.

**Likely files:** browser-extension/popup.js; browser-extension/collect.js; browser-extension/media-utils.js; browser-extension/test/collect-contract.test.js; browser-extension/README.md.

### Checkpoint after Task 41

- [ ] All applicable task acceptance criteria are supported by current evidence.
- [ ] Focused checks pass; integration checkpoints include Python, Browser Bridge, frontend/build and Rust checks as affected.
- [ ] A representative packaged user flow works and source files remain untouched by the operation.
- [ ] Review the result and unresolved limits before expanding scope; no assumed live-site coverage.

### Task 42: Retry only recoverable collection failures

**Status:** Proposed. **Dependencies:** 38–41. **Estimated scope:** Medium.

**Deliverable:** Retry only recoverable collection failures as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Classify transient network, expired reference, rate limit, layout, access, storage and cancellation outcomes with explicit bounded policies.
- [ ] Reuse validated members and refresh missing renditions only through an applicable approved source session with identity validation.
- [ ] After restart request browser reconnection where needed; resume ranges only for verified unchanged objects and respect per-host/global limits.

**Verification:** Network interruption, Retry-After, stale URL, changed object, denied access, storage failure and cancellation scenarios; inspect repeated-byte counts.

**Likely files:** desktop-ui/src-tauri/src/capture.rs; desktop-ui/src-tauri/src/access.rs; src/janeconverter/facebook_capture.py; src/janeconverter/social_photo_capture.py; tests/test_social_photo_capture.py.

### Task 43: Enforce output-quality and item-identity contracts

**Status:** Proposed. **Dependencies:** 35,39–42. **Estimated scope:** Medium.

**Deliverable:** Enforce output-quality and item-identity contracts as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Validate requested streams and properties; test truncated-but-probeable files, orientation, alpha, animation, color and audio retention.
- [ ] Use exact byte hashes for identity; similarity must not silently merge two distinct patch-note images.
- [ ] Expose rendered, re-encoded, source-preserved and catalog-matched origin differences without promising restoration of lost quality.

**Verification:** Real local decode fixtures plus targeted browser fingerprint tests; verify successful fallbacks preserve output policy.

**Likely files:** src/janeconverter/converter.py; src/janeconverter/recovery.py; tests/test_validation_and_stream_copy.py; browser-extension/media-utils.js; browser-extension/test/media-utils.test.js.

### Task 44: Expose actionable local failure details

**Status:** Proposed. **Dependencies:** 42–43. **Estimated scope:** Medium.

**Deliverable:** Expose actionable local failure details as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Show saved/expected/unknown counts and one appropriate action such as reconnect browser, retry missing, or free disk space.
- [ ] Present original/rendered method and completeness separately from a generic success badge.
- [ ] Provide an opt-in local diagnostic export with redacted source secrets and explicit include/exclude choices.

**Verification:** User-flow tests for each failure category and redaction checks; confirm ordinary completion remains concise.

**Likely files:** desktop-ui/src/bridge.ts; desktop-ui/src/components/ConverterView.tsx; desktop-ui/src/components/FetchedMediaView.tsx; src/janeconverter/diagnostics.py; desktop-ui/src/components/ConverterView.test.tsx.

### Checkpoint after Task 44

- [ ] All applicable task acceptance criteria are supported by current evidence.
- [ ] Focused checks pass; integration checkpoints include Python, Browser Bridge, frontend/build and Rust checks as affected.
- [ ] A representative packaged user flow works and source files remain untouched by the operation.
- [ ] Review the result and unresolved limits before expanding scope; no assumed live-site coverage.

### Task 45: Find and group captured updates

**Status:** Proposed. **Dependencies:** 37,41,44. **Estimated scope:** Medium.

**Deliverable:** Find and group captured updates as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Filter/search by source, title, capture date, media kind and collection; create a CDID collection without moving unrelated files.
- [ ] Open the saved item and its safe source link; show unknown original publication date honestly.
- [ ] Distinguish original and converted derivatives and offer export of a collection with a portable metadata manifest.

**Verification:** Restart and export/reimport metadata round-trip tests; retrieve a known update by date/source.

**Likely files:** desktop-ui/src-tauri/src/catalog.rs; desktop-ui/src-tauri/src/lib.rs; desktop-ui/src/bridge.ts; desktop-ui/src/components/LibraryView.tsx; desktop-ui/src/components/LibraryView.test.tsx.

### Task 46: Evaluate optional local text search for patch notes

**Status:** Proposed. **Dependencies:** 45. **Estimated scope:** Small prototype, then separately sized implementation.

**Deliverable:** Evaluate optional local text search for patch notes as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Evaluate a small local OCR approach on Jane's actual language/script needs, footprint and license before choosing dependencies.
- [ ] Keep originals authoritative; OCR errors are visible and never alter original media.
- [ ] Approve integration only if a representative patch-note query finds the expected image with documented limitations.

**Verification:** Measure retrieval accuracy on permitted/synthetic patch notes with overlays, small text and mixed scripts; document a go/no-go.

**Likely files:** docs/local-ocr-evaluation.md (new); tests/fixtures/ocr/.

### Task 47: Save repeatable collection and conversion recipes

**Status:** Proposed. **Dependencies:** 37,44–45. **Estimated scope:** Medium.

**Deliverable:** Save repeatable collection and conversion recipes as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Save simple user choices for output format, folder, quality policy and optional collection grouping; preserve the existing paste workflow.
- [ ] Offer explicit repeat/retry from history without replaying expired browser sessions or credentials.
- [ ] Keep recipes usable across app updates through versioned validation and clear handling of unsupported settings.

**Verification:** Repeat a mixed-media workflow after restart and settings migration; compare required manual actions to baseline.

**Likely files:** desktop-ui/src-tauri/src/catalog.rs; desktop-ui/src/bridge.ts; desktop-ui/src/components/ConverterView.tsx; desktop-ui/src/components/SettingsView.tsx; desktop-ui/src/components/ConverterView.test.tsx.

### Checkpoint after Task 47

- [ ] All applicable task acceptance criteria are supported by current evidence.
- [ ] Focused checks pass; integration checkpoints include Python, Browser Bridge, frontend/build and Rust checks as affected.
- [ ] A representative packaged user flow works and source files remain untouched by the operation.
- [ ] Review the result and unresolved limits before expanding scope; no assumed live-site coverage.

### Task 48: Define a safe compatibility-fix release path

**Status:** Proposed. **Dependencies:** 39–44. **Estimated scope:** Medium.

**Deliverable:** Define a safe compatibility-fix release path as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Use current signed application releases for initial fixes; measure whether separate capture-engine delivery is justified.
- [ ] Document native/extension/engine protocol compatibility and visible mismatch diagnostics plus rollback behavior.
- [ ] Require user choice, verified origin and signatures for executable updates; do not introduce arbitrary remotely fetched scripts.

**Verification:** Packaged mismatch and rollback exercise; inspect release validation coverage before proposing independent component packaging.

**Likely files:** docs/UPDATER.md; packaging/smoke_test_engine.py; tests/test_release_hardening.py; browser-extension/README.md.

### Task 49: Verify packaged workflows and bridge onboarding

**Status:** Proposed. **Dependencies:** 38–45,48. **Estimated scope:** Medium.

**Deliverable:** Verify packaged workflows and bridge onboarding as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Use the packaged app to verify local conversion, persistent history, missing drive/disk-full recovery and bridge connect/capture/restart flows.
- [ ] Record dated live evidence for each promoted site/media type; mark site-specific failures without implying all conversion is broken.
- [ ] Guide installed/connected/ready bridge states and a successful first capture without routine engine jargon.

**Verification:** Clean-machine packaged smoke checks plus permitted live samples on two dates/build contexts; record app/browser/component versions.

**Likely files:** packaging/smoke_test_engine.py; tests/test_consumer_packaging.py; desktop-ui/src/components/FetchedMediaView.tsx; desktop-ui/src/components/FetchedMediaView.test.tsx; docs/workflow-support-matrix.md.

### Task 50: Prove narrow competitor advantages

**Status:** Proposed. **Dependencies:** 45,47,49. **Estimated scope:** Small.

**Deliverable:** Prove narrow competitor advantages as a complete, testable slice of the personal media workflow.

**Acceptance criteria:**
- [ ] Compare the same supported task and quality policy against relevant current tools, recording correctness, context retention, actions, time and cleanup.
- [ ] Publish denominators, versions, failures and limitations; distinguish not-tested/not-documented from unsupported.
- [ ] Replace unsubstantiated superiority claims with demonstrated workflow advantages; make no universal fastest/unbreakable claims.

**Verification:** Review benchmark reproducibility and official competitor documentation; verify each public claim points to evidence.

**Likely files:** docs/workflow-benchmarks.md (new); docs/market-analysis-audit.md; README.md.

### Checkpoint after Task 50

- [ ] All applicable task acceptance criteria are supported by current evidence.
- [ ] Focused checks pass; integration checkpoints include Python, Browser Bridge, frontend/build and Rust checks as affected.
- [ ] A representative packaged user flow works and source files remain untouched by the operation.
- [ ] Review the result and unresolved limits before expanding scope; no assumed live-site coverage.

## Verification commands for future implementation

Run Python through uv only. Select focused cases during development; use the relevant full suites at integration checkpoints. Run frontend commands from `desktop-ui`.

- Python: `uv run --locked pytest tests/ -v`; lint: `uv run --locked pyflakes src/janeconverter packaging/engine_entry.py`.
- Browser Bridge: `node --test browser-extension/test/*.test.js`.
- Frontend/replays: `npm test -- --run`; build: `npm run build`.
- Native: `cargo fmt --manifest-path desktop-ui/src-tauri/Cargo.toml --check`; `cargo test --manifest-path desktop-ui/src-tauri/Cargo.toml`.
- Packaged/live checks: use documented fixtures and permitted sources; record actual results separately from automated replay results.

A planning-document check is not an application test pass. Task 46 is deliberately an evaluation gate, and independent capture-component updates in Task 48 remain conditional. Neither authorizes adding an unassessed dependency or updater architecture.
