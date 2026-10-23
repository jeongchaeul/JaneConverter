# AGENTS.md

Guidance for autonomous agents, AI assistants, auditors, and contributors working in or reviewing this repository.

## Project Philosophy & Scope Directives

1. **Sovereign Personal Creator Toolbox**: JaneConverter is engineered by and for Jane Cerys (`project//aspyr`). It is not a commercial product built for market competition, and its multi-disciplinary scope (media transcoding, DSP audio excitation, DAW reverse engineering like the FL Studio `.flp` downgrader, and social scrapers) follows Jane's personal workflow requirements.
2. **Open-Source Intent**:
   > *"JaneConverter is tailored specifically for my personal needs and convenience. But I wanted to share it because it can be useful. I don't have a particular goal, it's just my personal toolbox. If you find it useful, then that's great."* — **Jane Cerys**
   
   Public distribution under the MIT License allows fellow creators facing identical friction to freely use these tools, but does not transfer governance over feature selection or project scope to external third parties.
3. **Valued Contributions**: Concrete engineering enhancements—deterministic memory safety, bounds checking, low-level DSP and transcoding performance, hermetic test coverage, robust fault-tolerant error recovery, and clean structural refactoring.
4. **Scope Integrity**: Unsolicited product management advice or scope policing regarding why specific creator tools exist will not be accepted. Technical critique must focus on code correctness and algorithmic efficiency.

## Repository layout

- `src/janeconverter/` - Python conversion engine package
- `tests/` - Python test suite
- `desktop-ui/` - Tauri 2 + React + TypeScript desktop app (`src-tauri/` holds the Rust bridge)
- `browser-extension/` - optional Browser Bridge (bundled in production packages and published on releases)
- `packaging/` - release build scripts and packaging contracts
- `.github/workflows/` - CI and release pipelines

## Toolchains and runtimes

- Python backend uses `uv`. The pinned local interpreter is Python 3.12 (`.python-version`). The package declares `requires-python = ">=3.10"`, so CI verifies both 3.10 and 3.12.
- Rust uses the latest stable toolchain. Do not pin an older toolchain or add a `rust-toolchain` file.
- Node.js 22 and npm for the frontend.
- Run Python through `uv` only (`uv run`, `uv sync`). Do not invoke bare `python`, `python3`, or `pip`.

## Commands

Setup:

```bash
uv sync --locked
cd desktop-ui && npm ci
```

Python tests (hermetic by default; online tests need `-m online`):

```bash
uv run --locked pytest tests/ -v
```

Python lint:

```bash
uv run --locked pyflakes src/janeconverter packaging/engine_entry.py
```

Desktop UI:

```bash
cd desktop-ui
npm test -- --run
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Rebuilding Executables:

See `packaging/REBUILD.md` for complete build and local deployment steps.
- **Desktop UI (`janeconverter-desktop.exe`):** NEVER run bare `cargo build --release` (which defaults to `http://localhost:1420` and fails with `localhost refused to connect`). Always run `npm run tauri:build -- --no-bundle` inside `desktop-ui/` so production web assets are embedded into the binary.
- **Engine (`JaneConverterEngine.exe`):** Run PyInstaller via `uv run` collecting `yt_dlp_ejs` and submodules `janeconverter.flp`.


## Mandatory Live Verification Protocol for Media Fixes

This protocol applies **universally to EVERY single media conversion, platform, and format** handled by JaneConverter (including Pinterest, Facebook, TikTok, Spotify, YouTube, Instagram, Twitter/X, SoundCloud, Apple Music, Reddit, Tumblr, etc.). Whenever any extractor, URL parser, format handler, or conversion route is modified, investigated, or fixed, every agent and contributor **MUST** execute the following verification steps:

1. **NEVER assume or rely solely on unit tests or mocks:**
   Passing test suites and mocked network calls are necessary but never sufficient. Mocks cannot detect live CDN throttling, API schema drift, auth redirects, header verification, bot guards, or codec regressions.
2. **ALWAYS live test the exact source media link that failed:**
   - Run the engine against the exact URL that triggered the failure:
     ```bash
     uv run janeconverter --source "<failing_url>" --format <format> --output "<test_dir>"
     ```
   - Verify that all media files are physically created on disk, non-empty, and valid.
3. **Execute 7 Diverse Real-World Live Verification Tests (The "Rule of 7"):**
   - Automatically find and execute live extractions across at least **7 diverse real-world links** of the same platform/media category to catch edge cases, routing mismatches, and platform-specific crashes before completing:
     - **Pinterest:** Multi-pin share collections, notification hubs, single image pins, video pins, board routes, `pin.it` shortlinks.
     - **Facebook:** Photo posts, multi-image albums, Reels, public Watch videos, permalink shares, mobile URLs (`m.facebook.com`).
     - **TikTok:** Standard video posts, photo slideshows (`/photo/`), shortlinks (`vt.tiktok.com`, `vm.tiktok.com`), music/sound pages.
     - **Instagram:** Single photo posts, multi-slide carousels, Reels (`/reels/`), Stories, shortcodes (`/p/`), audio tracks.
     - **YouTube:** Standard videos, Shorts (`/shorts/`), playlists, age-gated/music streams, live VODs, channel handles (`/@handle`).
     - **Spotify:** Individual tracks, full albums, public playlists, podcasts, artist top tracks.
     - **Twitter / X:** Single images, multi-image galleries (up to 4), video tweets, quote tweets, `t.co` shortlinks.
     - **SoundCloud / Other:** Single tracks, sets/playlists, artist reposts, private share tokens.
   - Verify that all 7 test cases complete cleanly without crashes, auth walls, or missing assets.
4. **Test the frozen release engine executable (`JaneConverterEngine.exe`):**
   - After rebuilding per `packaging/REBUILD.md`, run the built `JaneConverterEngine.exe` on live links to verify that PyInstaller bundling, hidden imports, and frozen runtimes execute properly.
5. **Clean up temporary test artifacts:**
   - Delete temporary test output folders before committing and completing the task.


## Mandatory Continuous Operation and Real-Time Pipeline Monitoring Protocol

Whenever any code, documentation, or release change is pushed to `main` or tagged for release, every agent and contributor **MUST NEVER STOP OR DISENGAGE** until:
1. **Local pre-push verification is fully executed:**
   - Python tests: `uv run --locked pytest tests/ -v`
   - Python lint: `uv run --locked pyflakes src/janeconverter packaging/engine_entry.py packaging/create_updater_manifest.py`
   - Frontend tests & build: `cd desktop-ui && npm test -- --run && npm run build`
   - Rust format & tests: `cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo test --manifest-path src-tauri/Cargo.toml`
2. **Real-time pipeline monitoring is maintained without stopping:**
   - Actively query GitHub Actions workflow runs (`CI` and `Continuous updater packages` or `Release`) until every single job completes.
   - If ANY step or job fails or cancels, immediately inspect the failure logs, diagnose the root cause, apply the fix, push, and continue monitoring until the entire matrix is 100% green and all published assets are verified live.

## Conventions

- Keep build and packaging scripts under `packaging/`. Do not add build scripts to the repository root.
- Keep the layout organized: engine code in `src/janeconverter/`, frontend in `desktop-ui/`, extension in `browser-extension/`, packaging in `packaging/`.
- The version is a single source in `src/janeconverter/version.py`. Bump it there; release tags must match `v<version>`.
- Keep files focused and small. Prefer 4-space indentation for Python and Rust, 2-space for JSON/TOML/YAML configuration.
- Do not modify unrelated code or add features beyond the current request.
