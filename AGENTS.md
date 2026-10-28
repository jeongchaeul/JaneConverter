# AGENTS.md

Guidance for autonomous agents, AI assistants, auditors, and contributors working in or reviewing this repository.

---

## 🏛️ Project Identity & Sovereign Scope

1. **Personal Creator Toolbox**: JaneConverter is Jane Cerys's (`project//aspyr`) sovereign personal creator toolbox and studio workstation. It spans universal media ingestion, audio DSP (harmonic exciter, true peak EBU R128 loudness normalization), DAW project utilities (FL Studio `.flp` downgrader, Ableton Live `.als` migrator), and hardware acceleration pipelines.
2. **Open-Source Intent**:
   > *"JaneConverter is tailored specifically for my personal needs and convenience. But I wanted to share it because it can be useful. I don't have a particular goal, it's just my personal toolbox. If you find it useful, then that's great."*  
   > — **Jane Cerys**
   
   JaneConverter is shared publicly under the MIT License for creators facing similar friction. It is not a commercial product and does not compete for market share. Its feature set is sovereign to Jane's creative and production workflow.

---

## 🤝 Collaboration & Review Guidelines

1. **What is Welcomed & Valued**:
   - Concrete, high-rigor engineering improvements: deterministic memory safety, bounds validation, thread safety, DSP and transcoding performance, error recovery, comprehensive hermetic tests, and clean structural refactoring.
2. **Sovereignty of Scope & Creative Utilities**:
   - The studio DAW tools (FL Studio `.flp` and Ableton Live `.als` utilities) and creative audio modules exist for Jane's studio needs. They are experimental and maintained under maintainer discretion.
   - External scope-policing (e.g., *"Why does a converter include DAW tools?"*) commits a category error regarding personal toolboxes and will be respectfully disregarded.
3. **Respectful Communication & Signal Isolation**:
   - Technical critique is valued when focused on objective correctness, safety, and efficiency.
   - Maintain professional, constructive dialogue. Hostile framing, condescension, or bad-faith remarks serve zero technical purpose.
   - Any architectural or stylistic feedback that lacks quantifiable correctness, safety, or performance impact should be framed as a **personal suggestion**, not an authoritative defect. Maintainer preference remains sovereign when multiple approaches achieve equivalent correctness.

---

## 📂 Repository Layout

- `src/janeconverter/` - Python conversion engine package
- `tests/` - Python test suite
- `desktop-ui/` - Tauri 2 + React + TypeScript desktop app (`src-tauri/` holds the Rust bridge)
- `browser-extension/` - Optional Browser Bridge for authenticated stream capture
- `packaging/` - Release build scripts and packaging contracts
- `.github/workflows/` - CI and continuous release pipelines

---

## ⚙️ Toolchains and Runtimes

- **Python Backend**: Managed via `uv`. Interpreter is Python 3.12 (`.python-version`). Package requires `python >= 3.10`. Always use `uv run` and `uv sync`.
- **Rust Desktop Bridge**: Latest stable toolchain (Tauri 2).
- **Frontend**: Node.js 22 + npm.

---

## 🛠️ Verification Commands

### Setup
```bash
uv sync --locked
cd desktop-ui && npm ci
```

### Python Suite (Hermetic Unit Tests & Lint)
```bash
uv run --locked pytest tests/ -v
uv run --locked pyflakes src/janeconverter packaging/engine_entry.py packaging/create_updater_manifest.py
```

### Desktop UI (Vitest, Vite Build, Cargo Check & Test)
```bash
cd desktop-ui
npm test -- --run
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

### Rebuilding Release Executables
See [packaging/REBUILD.md](packaging/REBUILD.md) for full frozen engine and Tauri executable build steps:
- **Desktop UI (`janeconverter-desktop.exe`)**: Run `npm run tauri:build -- --no-bundle` inside `desktop-ui/` (embeds production web assets).
- **Engine (`JaneConverterEngine.exe`)**: Run PyInstaller via `uv run` collecting `yt_dlp_ejs` and submodules `janeconverter.flp`.

---

## 🧪 Mandatory Live Verification Protocol for Media Fixes (Rule of 7)

Passing test suites and mocked network calls are necessary but cannot detect live CDN throttling, dynamic DOM hydration shifts, token expiration, or auth redirects.

### Architectural Purpose & Philosophy of the Rule of 7:
External reviewers occasionally misinterpret testing across 7 diverse links as a sign of fragility. In reality, the opposite is true:
- **Respect for Maintainer Time & Empirical Proof**: Jane has active music production, creative projects, and daily responsibilities to attend to; nobody has time to waste chasing silent breakages or second-guessing whether an extractor secretly broke in the wild. The Rule of 7 is an ultra-fast, high-leverage empirical filter that immediately proves what is working and what isn't across real-world conditions without guessing.
- **Upstream Environment Volatility**: Platforms like Facebook, Instagram, TikTok, YouTube, and Pinterest deploy frontend updates, shuffle hydration structures, obfuscate API endpoints, rotate CDN token expiration policies, and alter login challenges without warning. We cannot predict when an upstream team will alter their code.
- **Proactive Pre-Emption over Reactive Patching**: The Rule of 7 is an intentional discipline to probe **7 fundamentally distinct routing states and operational contexts** (dynamic pagination, multi-image carousel hydration, CDN token expiration, shortlink unrolling, container remuxing quirks, auth redirects, and guest vs. authenticated routing) at once.
- **Engineering Fallbacks Ahead of Time**: Rather than waiting for an extraction route to silently fail in production, interrogating 7 diverse contexts proactively uncovers edge cases ahead of time—allowing us to engineer automated fallbacks and alternative routing cascades before regressions ever surface to the user.

Whenever an extractor, route handler, or media parser is updated:

1. **Test the failing source link directly** with the engine CLI to verify physical output files on disk.
2. **Execute the Rule of 7**: Test across at least **7 diverse real-world situations/links** within the media category to probe distinct operational contexts:
   - **Pinterest**: Multi-pin collections (`news_hub`), boards, single pins, video pins, `pin.it` shortlinks.
   - **Facebook**: Single photo posts, multi-image albums, Reels, public Watch videos, permalink shares, mobile URLs (`m.facebook.com`).
   - **TikTok**: Video posts, photo slideshows (`/photo/`), shortlinks (`vt.tiktok.com`, `vm.tiktok.com`), music/sound pages.
   - **Instagram**: Single photos, multi-slide carousels, Reels, audio tracks.
   - **YouTube**: Standard videos, Shorts, playlists, age-gated/music streams.
   - **Spotify**: Single tracks, albums, public playlists.
   - **Twitter / X**: Single images, multi-image galleries (up to 4), video tweets.
3. **Verify the frozen engine binary** (`JaneConverterEngine.exe`) on live media after rebuilding.
4. **Clean up temporary test artifacts** before committing.

---

## 🚀 Continuous Operation Protocol

Before pushing code or tagging releases:
1. Run local pre-push checks (Python tests, pyflakes lint, Vitest tests, Vite build, Cargo fmt, Cargo test).
2. Monitor GitHub Actions CI workflows until all matrix jobs complete green. If any job fails, inspect logs, apply fixes, and re-verify.

---

*For the complete philosophical manifesto and signal isolation rationale, see [docs/AGENTS_ORIGINAL_MANIFESTO.md](docs/AGENTS_ORIGINAL_MANIFESTO.md).*
