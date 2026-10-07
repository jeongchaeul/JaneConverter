# Rebuilding JaneConverter Executables

This guide documents the exact, reliable procedure for rebuilding both the Python conversion engine (`JaneConverterEngine.exe`) and the Tauri desktop application (`janeconverter-desktop.exe`).

> [!CRITICAL]
> **NEVER invoke bare `cargo build --release` to produce the desktop executable!**
> Bare `cargo build` bypasses the Tauri build macro, leaving the app in development fallback mode pointing to `devUrl` (`http://localhost:1420`). When launched without a running Vite dev server, the desktop window will display:
> `localhost refused to connect. ERR_CONNECTION_REFUSED`
>
> You **MUST** use `npm run tauri:build -- --no-bundle` (or `npx tauri build --no-bundle`) so production web assets are compiled and embedded directly into the standalone binary.

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

## Step 4: Full Release Installer / Packaging (Optional)

To create the full signed/unsigned NSIS installer and portable release zip, execute the dedicated packaging script:

```powershell
powershell -ExecutionPolicy Bypass -File packaging/build_consumer.ps1
```
