# Rebuilding JaneConverter Executables & Release Protocol

This guide documents the exact, reliable procedure for rebuilding both the Python conversion engine (`JaneConverterEngine.exe`) and the Tauri desktop application (`janeconverter-desktop.exe`), deploying them locally, and executing a complete multi-platform release.

> [!CRITICAL]
> **NEVER invoke bare `cargo build --release` to produce the desktop executable!**
> Bare `cargo build` bypasses the Tauri build macro, leaving the app in development fallback mode pointing to `devUrl` (`http://localhost:1420`). When launched without a running Vite dev server, the desktop window will display:
> `localhost refused to connect. ERR_CONNECTION_REFUSED`
>
> You **MUST** use `npm run tauri:build -- --no-bundle` (or `npx tauri build --no-bundle`) so production web assets are compiled and embedded directly into the standalone binary.

> [!IMPORTANT]
> ### 🛑 Mandatory Post-Update Host Confirmation Protocol
> Whenever code modifications, fixes, or feature updates are completed and validated through local test suites, **do NOT arbitrarily rebuild local binaries or deploy without asking**.
>
> The agent or contributor **MUST** first ask and confirm with the host which delivery route they desire:
> 1. **Option 1: Recreate Local Binary Builds:**
>    - Rebuild the frozen engine (`JaneConverterEngine.exe`) and Tauri desktop application (`janeconverter-desktop.exe`) locally and deploy them to `D:\Programs\JaneConverter\`.
> 2. **Option 2: Commit & Push Updates for the Live In-App Updater:**
>    - Commit and push the verified changes to `main`.
>    - When committing and pushing updates, the **Continuous Updater Package pipeline** (`.github/workflows/continuous-updates.yml`) must be triggered and updated.
>    - The agent/contributor must monitor the pipeline in real-time until all cross-platform package matrices, signatures, and updater manifests are verified live so the host can conveniently update using the in-app updater.

---

## Prerequisites & Environment

- **Python & uv:** Python 3.12 managed via `uv` (`uv sync --locked`).
- **Node.js:** Node.js 22 and `npm`. On Windows, ensure Node.js is on PATH (`$env:PATH = "D:\node.js\Node.js;" + $env:PATH`).
- **Rust toolchain:** Latest stable toolchain with Cargo.

---

## Step 1: Rebuilding the Frozen Engine (`JaneConverterEngine.exe`)

Run from the repository root:

```powershell
uv run --locked pyinstaller --noconfirm --clean --onedir --contents-directory _internal `
    --collect-all yt_dlp_ejs `
    --collect-submodules janeconverter.flp `
    --hidden-import urllib.request `
    --name JaneConverterEngine `
    --paths "src" `
    --distpath "build_engine\dist" `
    --workpath "build_engine\work" `
    --specpath "build_engine\spec" `
    "packaging\engine_entry.py"
```

### Verification
```powershell
.\build_engine\dist\JaneConverterEngine\JaneConverterEngine.exe --version
```
Expected output: `JaneConverter <version>`

---

## Step 2: Rebuilding the Desktop Application (`janeconverter-desktop.exe`)

Run from the `desktop-ui` directory:

```powershell
cd desktop-ui
$env:PATH = "D:\node.js\Node.js;" + $env:PATH
npm run tauri:build -- --no-bundle
```

This runs `beforeBuildCommand` (`npm run build`) to produce the optimized bundle in `desktop-ui/dist`, then compiles Rust with assets embedded directly into:
`desktop-ui/src-tauri/target/release/janeconverter-desktop.exe`

---

## Step 3: Deploying Binaries to Local Installation (`D:\Programs\JaneConverter\`)

1. **Stop any existing instances first** (Windows locks open executables):
   ```powershell
   Stop-Process -Name "*janeconverter*" -Force -ErrorAction SilentlyContinue
   ```

2. **Deploy the desktop executable:**
   ```powershell
   Copy-Item -Path "desktop-ui\src-tauri\target\release\janeconverter-desktop.exe" `
             -Destination "D:\Programs\JaneConverter\janeconverter-desktop.exe" -Force
   Copy-Item -Path "desktop-ui\src-tauri\target\release\janeconverter-desktop.exe" `
             -Destination "D:\Programs\JaneConverter\JaneConverter.exe" -Force
   ```

3. **Deploy the engine:**
   ```powershell
   Copy-Item -Path "build_engine\dist\JaneConverterEngine\*" `
             -Destination "D:\Programs\JaneConverter\runtime\engine" -Recurse -Force
   ```

4. **Clean up staging files:**
   ```powershell
   Remove-Item -Path "build_engine" -Recurse -Force -ErrorAction SilentlyContinue
   ```

---

## Version Bump & Release Protocol

Whenever instructed to bump to a new version or prepare a multi-platform release, follow this mandatory step-by-step protocol:

### 1. Synchronize Version Metadata
Never edit version strings by hand across individual files. Always use the canonical synchronizer:

```powershell
uv run --locked python packaging/set_version.py <version>
uv run --locked python packaging/set_version.py --check
```

This synchronizes all 6 metadata files simultaneously:
- `src/janeconverter/version.py`
- `desktop-ui/package.json`
- `desktop-ui/package-lock.json`
- `desktop-ui/src-tauri/Cargo.toml`
- `desktop-ui/src-tauri/Cargo.lock`
- `desktop-ui/src-tauri/tauri.conf.json`

### 2. Document Release Notes
Update `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):
- Add a new section `## [<version>] - YYYY-MM-DD - <Release Title>`
- Detail changes under `### Added`, `### Changed`, and `### Fixed`.

### 3. Rebuild Binaries Locally
Execute Steps 1, 2, and 3 above:
- Rebuild engine via PyInstaller and verify `JaneConverterEngine.exe --version`.
- Rebuild desktop app via `npm run tauri:build -- --no-bundle`.
- Deploy both to `D:\Programs\JaneConverter\`.

### 4. Execute Pre-Release Verification Gates
Run all test suites and quality gates to prevent breaking CI builds:

```powershell
# Check Rust formatting
cargo fmt --manifest-path desktop-ui/src-tauri/Cargo.toml --check

# Check Desktop UI tests and production web build
cd desktop-ui
npm test -- --run
npm run build
cd ..

# Verify packaging contracts
uv run --locked pytest tests/test_consumer_packaging.py

# Lint Python engine
uv run --locked pyflakes src/janeconverter packaging/engine_entry.py

# Run hermetic test suite
uv run --locked pytest tests/ -v
```

### 5. Commit, Tag, and Push
Stage the synchronized manifest files, changelog, and any related changes:

```powershell
git add CHANGELOG.md desktop-ui/package-lock.json desktop-ui/package.json desktop-ui/src-tauri/Cargo.lock desktop-ui/src-tauri/Cargo.toml desktop-ui/src-tauri/tauri.conf.json src/janeconverter/version.py packaging/REBUILD.md
git commit -m "chore(release): bump version to <version>"
git tag v<version>
git push origin main
git push origin v<version>
```

### 6. Continuous Real-Time Release Pipeline Monitoring
Pushing tag `v<version>` automatically triggers the `.github/workflows/release.yml` GitHub Actions pipeline:
1. **`validate` matrix**: Runs cross-platform tests and builds on Ubuntu, Windows, and macOS (Python 3.10 and 3.12).
2. **Packaging matrix**:
   - `windows-x64`: Produces NSIS setup installer (`JaneConverter-*-windows-x64-setup.exe`), portable zip, and browser bridge extension.
   - `linux-x86_64`: Produces standalone AppImage (`JaneConverter-*-linux-x86_64.AppImage`), portable tarball, and signatures.
   - `macos-arm64`: Produces Apple Silicon DMG (`JaneConverter-*-macos-arm64.dmg`).
   - `macos-x86_64`: Produces Intel DMG (`JaneConverter-*-macos-x86_64.dmg`).
3. **`publish`**: Aggregates all uploaded release assets across all platforms, generates release notes, and publishes the official release on GitHub.

**Mandatory Continuous Operation Protocol**: Never stop operations after pushing code or release tags. The operator/agent must continuously monitor GitHub Actions CI and packaging workflows in real time. If any job or matrix step fails, immediately inspect logs, apply root-cause fixes, push updates, and continue monitoring until all checks are 100% green and all published packages and updater manifests are verified live.
