# AGENTS.md

Guidance for agents and contributors working in this repository.

## Project

JaneConverter is a universal media downloader and converter with a Tauri desktop app and a Python CLI. It downloads and converts media through a React/TypeScript frontend, a Rust native bridge, and a Python conversion engine.

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

Whenever a bug, issue, or failure on a media URL, extractor, or format is investigated or fixed, any agent or contributor working on JaneConverter **MUST** follow this strict verification protocol:

1. **NEVER assume or rely solely on unit tests / mocks:** Passing unit tests is necessary but never sufficient. Mocks cannot detect live platform API changes, CDN throttling, header checks, cookie structure updates, or redirect behavior.
2. **ALWAYS live test the exact source media link that failed:**
   - Execute the CLI engine against the exact URL that triggered the failure:
     ```bash
     uv run janeconverter --source "<failing_url>" --format <format> --output "<test_dir>"
     ```
   - Verify that the output media files are physically created, non-empty, and valid.
3. **Search and test at least 7 other real-world links of the same format/platform:**
   - Find and execute live extractions across at least 7 diverse real-world links of the same platform/media format (e.g., shortlinks, single items, multi-post collections/carousels, video pins/reels, board routes, author handles).
   - Verify that all 7 test cases succeed cleanly without crashes, auth walls, or missing assets.
4. **Test the frozen release engine executable (`JaneConverterEngine.exe`):**
   - After rebuilding per `packaging/REBUILD.md`, run the built `JaneConverterEngine.exe` on live links to verify that PyInstaller bundling, hidden imports, and frozen runtimes execute properly.
5. **Clean up temporary test artifacts:**
   - Delete temporary test output folders before committing and completing the task.


## Conventions

- Keep build and packaging scripts under `packaging/`. Do not add build scripts to the repository root.
- Keep the layout organized: engine code in `src/janeconverter/`, frontend in `desktop-ui/`, extension in `browser-extension/`, packaging in `packaging/`.
- The version is a single source in `src/janeconverter/version.py`. Bump it there; release tags must match `v<version>`.
- Keep files focused and small. Prefer 4-space indentation for Python and Rust, 2-space for JSON/TOML/YAML configuration.
- Do not modify unrelated code or add features beyond the current request.
