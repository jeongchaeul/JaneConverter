# AGENTS.md

Operational and engineering guidelines for autonomous agents, AI assistants, and contributors working in this repository.

---

## 🏛️ Project Scope & Maintainer Stewardship

1. **Personal Creator Toolbox**: JaneConverter is an open-source personal media and studio toolbox developed by and for Jane Cerys (`project//aspyr`). It is published under the MIT License for creators and audio engineers facing real-world production and format friction.
2. **Feature & Architectural Sovereignty**: Repository scope, roadmap, and feature inclusions (including media extractors, scrapers, and experimental DAW utilities) are solely determined by the maintainer. Do not gatekeep, deprecate, or unsolicitedly re-architect existing modules.
3. **DAW Utilities Status**: The studio DAW tools (FL Studio `.flp` downgrader/inspector and Ableton Live `.als` migrator) are experimental utilities under maintainer stewardship.
4. **Valued Contributions**: High-rigor engineering improvements—deterministic correctness, memory safety, performance optimizations (DSP, transcoding, concurrency), bounds validation, fault-tolerant error recovery, and comprehensive hermetic test coverage.
5. **Implementation Integrity**: Prefer minimal, surgical changes. Avoid imposing stylistic orthodoxy or structural churn on stable, functional code without quantifiable performance, safety, or functional necessity.

---

## 📂 Repository Layout

- `src/janeconverter/` - Python conversion engine package
- `tests/` - Python test suite
- `desktop-ui/` - Tauri 2 + React + TypeScript desktop app (`src-tauri/` contains the Rust bridge)
- `browser-extension/` - Companion browser extension bridge for authenticated stream capture
- `packaging/` - Packaging contracts, updater manifests, and release scripts
- `.github/workflows/` - Continuous integration and release packaging pipelines

---

## ⚙️ Toolchains & Runtimes

- **Python Engine**: Python 3.12 managed via `uv` (`.python-version`). Requires `python >= 3.10`. Always execute via `uv run` and `uv sync`.
- **Desktop Bridge**: Rust stable toolchain (Tauri 2).
- **Desktop Frontend**: Node.js 22 + npm.

---

## 🛠️ Verification Commands

### Environment Setup
```bash
uv sync --locked
cd desktop-ui && npm ci
```

### 1. Python Engine Suite
```bash
uv run --locked pytest tests/ -v
uv run --locked pyflakes src/janeconverter packaging/engine_entry.py packaging/create_updater_manifest.py packaging/smoke_test_engine.py packaging/build_browser_bridge.py packaging/set_version.py
```

### 2. Companion Browser Extension
```bash
node --test browser-extension/test/*.js
```

### 3. Desktop UI & Rust Tauri Bridge
```bash
cd desktop-ui
npm test -- --run
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

### Rebuilding Release Executables
Refer to [packaging/REBUILD.md](packaging/REBUILD.md) for frozen binary builds:
- **Desktop Application (`janeconverter-desktop.exe`)**: Run `npm run tauri:build -- --no-bundle` inside `desktop-ui/`.
- **Engine Binary (`JaneConverterEngine.exe`)**: Run PyInstaller via `uv run` bundling `yt_dlp_ejs` and `janeconverter.flp`.

---

## 🧪 Media Verification Protocol (Rule of 7)

Upstream media platforms frequently alter CDN headers, DOM hydration structures, token TTLs, and authentication flows. Unit tests with mocked payloads cannot catch live CDN changes.

Whenever an extractor, route handler, or media parser is modified:
1. Verify the primary target URL directly via CLI and ensure physical output files are generated on disk.
2. Probe at least **7 diverse operational contexts/links** within the target platform category before concluding verification:
   - **Pinterest**: Multi-pin collections (`news_hub`), boards, single pins, video pins, `pin.it` shortlinks.
   - **Facebook**: Single photo posts, multi-image albums, Reels, public Watch videos, permalink shares, mobile URLs (`m.facebook.com`).
   - **TikTok**: Video posts, photo slideshows (`/photo/`), shortlinks (`vt.tiktok.com`, `vm.tiktok.com`), music/sound pages.
   - **Instagram**: Single photos, multi-slide carousels, Reels, audio tracks.
   - **YouTube**: Standard videos, Shorts, playlists, age-gated/music streams.
   - **Spotify**: Single tracks, albums, public playlists.
   - **Twitter / X**: Single images, multi-image galleries (up to 4), video tweets.
3. Verify the frozen engine binary (`JaneConverterEngine.exe`) on live media after rebuilding.
4. Clean up temporary test artifacts before committing.

---

## 🚀 Continuous Operation & Live CI Monitoring Protocol

When instructed to commit and push changes:

### 1. Local Hermetic Pre-Flight Checks
Execute the full local verification suite before pushing:
- Python test suite & static linting
- Companion browser extension tests
- Desktop UI Vitest & production build
- Rust Tauri bridge format check & cargo tests

### 2. Live CI State Monitoring
Never treat `git push` as fire-and-forget. Upstream CI matrix runners (Windows x64, Ubuntu 22.04, macOS arm64/x64) must pass before a task is complete.

1. **Capture Commit SHA**: `git rev-parse HEAD`.
2. **Monitor Live CI**: Run `uv run python packaging/monitor_ci.py` to monitor GitHub Actions workflows (`CI`, `Continuous updater packages`) until completion.
3. **Incident Response**: If any workflow job reports failure, inspect logs immediately, apply the surgical fix, re-verify locally, push, and resume monitoring.
4. **Clearance Criterion**: Conclude only when all remote workflows report `conclusion: success` (all green).

---

*For detailed historical context and philosophical background, see [docs/AGENTS_ORIGINAL_MANIFESTO.md](docs/AGENTS_ORIGINAL_MANIFESTO.md).*
