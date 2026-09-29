param(
    [string]$Version = "",
    [string]$FFmpegPath = "",
    [string]$FFprobePath = "",
    [string]$NodePath = "",
    [string]$OutputDirectory = "",
    [string]$UpdaterBuildVersion = "",
    [string]$BuildCommit = "",
    [switch]$EnableUpdater,
    [switch]$UpdaterOnly,
    [switch]$SkipInstaller,
    [switch]$SkipPortable,
    [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$packagingDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Split-Path -Parent $packagingDir
Set-Location $repoRoot

function Invoke-Checked {
    param([scriptblock]$Action, [string]$Description)
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}

function Resolve-Tool {
    param([string]$ExplicitPath, [string]$CommandName, [string]$Description)
    if ($ExplicitPath) {
        $resolved = (Resolve-Path -LiteralPath $ExplicitPath -ErrorAction Stop).Path
    } else {
        $command = Get-Command $CommandName -ErrorAction SilentlyContinue
        if (-not $command) { throw "$Description was not found. Pass its explicit path." }
        $resolved = $command.Source
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "$Description is not a file: $resolved"
    }
    return $resolved
}

function Write-Checksum {
    param([string]$Path)
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$Path.sha256" -Value "$hash  $(Split-Path $Path -Leaf)" -Encoding ascii
}

if ($SkipInstaller -and $SkipPortable) {
    throw "At least one of the installer or portable outputs must be enabled."
}
if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
    throw "The consumer release build supports Windows x64 only."
}

$engineVersion = [regex]::Match(
    (Get-Content -Raw (Join-Path $repoRoot "src\janeconverter\version.py")),
    '__version__\s*=\s*"([^"]+)"'
).Groups[1].Value
if (-not $engineVersion) { throw "Could not determine the version from src/janeconverter/version.py." }
if ($Version -and $Version -ne $engineVersion) {
    throw "Requested version $Version does not match src/janeconverter/version.py ($engineVersion)."
}
$Version = $engineVersion
$enableUpdater = $EnableUpdater -or $UpdaterOnly
$signingPrivateKey = $env:TAURI_SIGNING_PRIVATE_KEY
$signingPrivateKeyPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD

if ($enableUpdater) {
    if (-not $BuildCommit) { $BuildCommit = $env:JANECONVERTER_BUILD_COMMIT }
    if (-not $BuildCommit -or $BuildCommit -notmatch '^[0-9a-fA-F]{40}$') {
        throw "Updater builds require a full 40-character source commit."
    }
    if ($UpdaterOnly -and (-not $UpdaterBuildVersion -or $UpdaterBuildVersion -notmatch "^$([regex]::Escape($Version))\+build\.\d+\.g$BuildCommit$")) {
        throw "Updater build version must be $Version+build.<sequence>.g$BuildCommit."
    }
    if (-not $env:JANECONVERTER_UPDATER_PUBKEY) {
        throw "Set the JANECONVERTER_UPDATER_PUBKEY GitHub Actions variable before building updater packages."
    }
    if (-not $signingPrivateKey) {
        throw "Set the TAURI_SIGNING_PRIVATE_KEY GitHub Actions secret before building updater packages."
    }
    $env:JANECONVERTER_BUILD_COMMIT = $BuildCommit.ToLowerInvariant()
}
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue

$applicationVersion = if ($UpdaterOnly) { $UpdaterBuildVersion } else { $Version }

if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "dist" }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$buildRootName = if ($UpdaterOnly) { "consumer-build-updater-windows-x64" } else { "consumer-build-$Version-windows-x64" }
$buildRoot = Join-Path $OutputDirectory $buildRootName
$payloadRoot = Join-Path $buildRoot "payload\JaneConverter"
$runtimeRoot = Join-Path $payloadRoot "resources\runtime"
$runtimeEngine = Join-Path $runtimeRoot "engine"
$runtimeBin = Join-Path $runtimeRoot "bin"
$pyinstallerRoot = Join-Path $buildRoot "pyinstaller"
$tauriTarget = Join-Path $buildRoot "tauri-target"
$installerOutput = Join-Path $OutputDirectory "JaneConverter-$Version-windows-x64-setup.exe"
$portableOutput = Join-Path $OutputDirectory "JaneConverter-$Version-windows-x64-portable.zip"
$updaterOutput = Join-Path $OutputDirectory "JaneConverter-continuous-windows-x64.nsis.zip"
$updaterSignature = "$updaterOutput.sig"

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $buildRoot) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
foreach ($artifact in @($installerOutput, "$installerOutput.sha256", $portableOutput, "$portableOutput.sha256", $updaterOutput, $updaterSignature)) {
    if (Test-Path -LiteralPath $artifact) { Remove-Item -LiteralPath $artifact -Force }
}
New-Item -ItemType Directory -Path $runtimeEngine,$runtimeBin,$pyinstallerRoot -Force | Out-Null

$uv = Resolve-Tool "" "uv.exe" "uv"
$ffmpeg = Resolve-Tool $FFmpegPath "ffmpeg.exe" "FFmpeg"
$ffprobe = Resolve-Tool $FFprobePath "ffprobe.exe" "FFprobe"
$node = Resolve-Tool $NodePath "node.exe" "Node.js"
$npm = Resolve-Tool "" "npm.cmd" "npm"
$cargo = Resolve-Tool "" "cargo.exe" "Rust/Cargo"

Invoke-Checked { & $uv sync --locked --python 3.12 } "Locked Python environment sync"
Invoke-Checked { & $uv run --locked pyinstaller --version | Out-Null } "PyInstaller validation"
Invoke-Checked { & $ffmpeg -version | Out-Null } "FFmpeg validation"
Invoke-Checked { & $ffprobe -version | Out-Null } "FFprobe validation"
Invoke-Checked { & $node --version | Out-Null } "Node.js validation"
Invoke-Checked { & $cargo --version | Out-Null } "Cargo validation"

Write-Host "Building the frozen engine (onedir)..." -ForegroundColor Cyan
$engineDist = Join-Path $pyinstallerRoot "dist"
Invoke-Checked {
    & $uv run --locked pyinstaller --noconfirm --clean --onedir --contents-directory _internal `
        --name JaneConverterEngine `
        --paths (Join-Path $repoRoot "src") `
        --distpath $engineDist `
        --workpath (Join-Path $pyinstallerRoot "work") `
        --specpath (Join-Path $pyinstallerRoot "spec") `
        (Join-Path $repoRoot "packaging\engine_entry.py")
} "Frozen engine build"
$builtEngine = Join-Path $engineDist "JaneConverterEngine"
if (-not (Test-Path -LiteralPath (Join-Path $builtEngine "JaneConverterEngine.exe") -PathType Leaf)) {
    throw "PyInstaller did not produce the expected onedir engine."
}
Copy-Item -Path (Join-Path $builtEngine "*") -Destination $runtimeEngine -Recurse -Force
Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $runtimeBin "ffmpeg.exe")
Copy-Item -LiteralPath $ffprobe -Destination (Join-Path $runtimeBin "ffprobe.exe")
Copy-Item -LiteralPath $node -Destination (Join-Path $runtimeBin "node.exe")
Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $payloadRoot "LICENSE")

$extensionFolder = Join-Path $payloadRoot "browser-extension"
New-Item -ItemType Directory -Path $extensionFolder -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "browser-extension\manifest.json") -Destination $extensionFolder
Copy-Item -Path (Join-Path $repoRoot "browser-extension\*.js") -Destination $extensionFolder
Copy-Item -Path (Join-Path $repoRoot "browser-extension\*.html") -Destination $extensionFolder
Copy-Item -LiteralPath (Join-Path $repoRoot "browser-extension\README.md") -Destination $extensionFolder

Invoke-Checked { & (Join-Path $runtimeEngine "JaneConverterEngine.exe") --version | Out-Null } "Frozen engine smoke test"

$forbiddenRuntimeNames = @("JaneConverterPython.exe", "JaneConverterNative.exe", "Program.cs", "pip.exe", "npm.exe", "cargo.exe", "rustc.exe")
foreach ($name in $forbiddenRuntimeNames) {
    if (Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Force -File -Filter $name) {
        throw "Private runtime unexpectedly contains $name."
    }
}
if (Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Force -File -Filter "*.py") {
    throw "Private runtime unexpectedly contains Python source files."
}

$baseConfig = Get-Content -Raw (Join-Path $repoRoot "desktop-ui\src-tauri\tauri.conf.json") | ConvertFrom-Json
$baseConfig.productName = "JaneConverter"
$baseConfig.version = $applicationVersion
$baseConfig.build.beforeBuildCommand = ""
$baseConfig.bundle.active = $UpdaterOnly -or -not $SkipInstaller
$baseConfig.bundle.targets = @("nsis")
$baseConfig.bundle | Add-Member -MemberType NoteProperty -Name resources -Value ([ordered]@{
    $runtimeRoot = "runtime"
    $extensionFolder = "browser-extension"
}) -Force
if ($enableUpdater) {
    $baseConfig.bundle | Add-Member -MemberType NoteProperty -Name createUpdaterArtifacts -Value $true -Force
    $baseConfig | Add-Member -MemberType NoteProperty -Name plugins -Value ([ordered]@{
        updater = [ordered]@{
            pubkey = $env:JANECONVERTER_UPDATER_PUBKEY
            endpoints = @("https://github.com/jeongchaeul/JaneConverter/releases/download/continuous/latest.json")
            windows = [ordered]@{ installMode = "passive" }
        }
    }) -Force
}
$baseConfig.bundle | Add-Member -MemberType NoteProperty -Name windows -Value ([ordered]@{
    nsis = [ordered]@{
        installMode = "currentUser"
        installerIcon = (Join-Path $repoRoot "assets\icon.ico")
        startMenuFolder = "JaneConverter"
    }
}) -Force
$tauriConfig = Join-Path $buildRoot "tauri.release.json"
$baseConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $tauriConfig -Encoding utf8

Write-Host "Building the production Tauri UI..." -ForegroundColor Cyan
$previousCargoTarget = $env:CARGO_TARGET_DIR
$previousNpmCache = $env:npm_config_cache
$env:CARGO_TARGET_DIR = $tauriTarget
$env:npm_config_cache = Join-Path $buildRoot "npm-cache"
try {
    Push-Location (Join-Path $repoRoot "desktop-ui")
    try {
        Invoke-Checked { & $npm ci --no-audit --no-fund --ignore-scripts } "Desktop dependency installation"
        Invoke-Checked { & $npm run build } "Desktop frontend build"
        $tauri = Join-Path (Get-Location) "node_modules\.bin\tauri.cmd"
        if ($enableUpdater) {
            $env:TAURI_SIGNING_PRIVATE_KEY = $signingPrivateKey
            if ($signingPrivateKeyPassword) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $signingPrivateKeyPassword }
        }
        try {
            if ($SkipInstaller) {
                Invoke-Checked { & $tauri build --no-bundle --config $tauriConfig } "Tauri application build"
            } else {
                Invoke-Checked { & $tauri build --config $tauriConfig } "Tauri application and NSIS build"
            }
        } finally {
            Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
            Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
        }
    } finally {
        Pop-Location
    }
} finally {
    if ($null -eq $previousCargoTarget) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $previousCargoTarget }
    if ($null -eq $previousNpmCache) { Remove-Item Env:npm_config_cache -ErrorAction SilentlyContinue } else { $env:npm_config_cache = $previousNpmCache }
}

$tauriExecutable = Join-Path $tauriTarget "release\janeconverter-desktop.exe"
if (-not (Test-Path -LiteralPath $tauriExecutable -PathType Leaf)) {
    throw "Tauri did not produce the expected executable."
}

if ($EnableUpdater -and -not $UpdaterOnly -and -not $SkipPortable) {
    $portableTarget = Join-Path $buildRoot "portable-tauri-target"
    $portableConfigObject = $baseConfig | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $portableConfigObject.version = $Version
    $portableConfigObject.bundle.active = $false
    $portableConfigObject.bundle.targets = @()
    $portableConfigObject.PSObject.Properties.Remove("plugins")
    $portableConfig = Join-Path $buildRoot "tauri.portable.json"
    $portableConfigObject | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $portableConfig -Encoding utf8

    $previousCargoTarget = $env:CARGO_TARGET_DIR
    $previousBuildCommit = $env:JANECONVERTER_BUILD_COMMIT
    $env:CARGO_TARGET_DIR = $portableTarget
    Remove-Item Env:JANECONVERTER_BUILD_COMMIT -ErrorAction SilentlyContinue
    try {
        Push-Location (Join-Path $repoRoot "desktop-ui")
        try {
            Invoke-Checked { & $tauri build --no-bundle --config $portableConfig } "Portable Tauri application build"
        } finally {
            Pop-Location
        }
    } finally {
        if ($null -eq $previousCargoTarget) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $previousCargoTarget }
        if ($null -eq $previousBuildCommit) { Remove-Item Env:JANECONVERTER_BUILD_COMMIT -ErrorAction SilentlyContinue } else { $env:JANECONVERTER_BUILD_COMMIT = $previousBuildCommit }
    }
    $tauriExecutable = Join-Path $portableTarget "release\janeconverter-desktop.exe"
    if (-not (Test-Path -LiteralPath $tauriExecutable -PathType Leaf)) {
        throw "Tauri did not produce the expected portable executable."
    }
}
Copy-Item -LiteralPath $tauriExecutable -Destination (Join-Path $payloadRoot "JaneConverter.exe")

if ($UpdaterOnly) {
    $nsisDirectory = Join-Path $tauriTarget "release\bundle\nsis"
    $builtUpdater = Get-ChildItem -LiteralPath $nsisDirectory -Filter "*.nsis.zip" -File |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $builtUpdater) { throw "Tauri completed without producing a signed NSIS updater package." }
    $builtSignature = "$($builtUpdater.FullName).sig"
    if (-not (Test-Path -LiteralPath $builtSignature -PathType Leaf)) {
        throw "Tauri did not produce the NSIS updater signature."
    }
    Copy-Item -LiteralPath $builtUpdater.FullName -Destination $updaterOutput -Force
    Copy-Item -LiteralPath $builtSignature -Destination $updaterSignature -Force
    Write-Host "Created signed updater package $updaterOutput" -ForegroundColor Green
} elseif (-not $SkipInstaller) {
    $builtInstaller = Get-ChildItem -LiteralPath (Join-Path $tauriTarget "release\bundle\nsis") -Filter "*-setup.exe" -File |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $builtInstaller) { throw "Tauri completed without producing an NSIS installer." }
    Copy-Item -LiteralPath $builtInstaller.FullName -Destination $installerOutput -Force
    Write-Checksum $installerOutput
    Write-Host "Created $installerOutput" -ForegroundColor Green
}

if (-not $UpdaterOnly -and -not $SkipPortable) {
    Compress-Archive -LiteralPath $payloadRoot -DestinationPath $portableOutput -CompressionLevel Optimal
    Write-Checksum $portableOutput
    Write-Host "Created $portableOutput" -ForegroundColor Green
}

$extensionZips = Get-ChildItem -LiteralPath (Join-Path $repoRoot "browser-extension\releases") -Filter "JaneConverter-Browser-Bridge-*.zip" -File |
    Sort-Object LastWriteTimeUtc -Descending
if (-not $UpdaterOnly -and $extensionZips) {
    $latestExtensionZip = $extensionZips | Select-Object -First 1
    Copy-Item -LiteralPath $latestExtensionZip.FullName -Destination (Join-Path $repoRoot "dist\$($latestExtensionZip.Name)") -Force
    Write-Host "Copied $($latestExtensionZip.Name) to dist" -ForegroundColor Green
}

if (-not $KeepStaging) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
