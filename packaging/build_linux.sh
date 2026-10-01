#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
FFMPEG_PATH=""
FFPROBE_PATH=""
NODE_PATH=""
OUTPUT_DIR="$REPO_ROOT/dist"
KEEP_STAGING=0
ENABLE_UPDATER=0
UPDATER_ONLY=0
UPDATER_VERSION=""
BUILD_COMMIT="${JANECONVERTER_BUILD_COMMIT:-}"
signing_private_key="${TAURI_SIGNING_PRIVATE_KEY:-}"
signing_private_key_password="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

usage() {
  cat <<'EOF'
Usage: packaging/build_linux.sh [options]
  --ffmpeg PATH       static-compatible FFmpeg executable
  --ffprobe PATH      static-compatible FFprobe executable
  --node PATH         Node.js executable
  --output-dir PATH   artifact directory (default: dist)
  --enable-updater    also build a signed updater-capable AppImage
  --updater-only      build only a signed continuous updater AppImage
  --updater-version VERSION   semver build version used by the continuous feed
  --build-commit SHA  full source commit embedded in the application
  --keep-staging      retain the intermediate payload
EOF
}

while (($#)); do
  case "$1" in
    --ffmpeg) FFMPEG_PATH="${2:?missing value for --ffmpeg}"; shift 2 ;;
    --ffprobe) FFPROBE_PATH="${2:?missing value for --ffprobe}"; shift 2 ;;
    --node) NODE_PATH="${2:?missing value for --node}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:?missing value for --output-dir}"; shift 2 ;;
    --enable-updater) ENABLE_UPDATER=1; shift ;;
    --updater-only) UPDATER_ONLY=1; ENABLE_UPDATER=1; shift ;;
    --updater-version) UPDATER_VERSION="${2:?missing value for --updater-version}"; shift 2 ;;
    --build-commit) BUILD_COMMIT="${2:?missing value for --build-commit}"; shift 2 ;;
    --keep-staging) KEEP_STAGING=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

ARCH="$(uname -m)"
if [[ "$ARCH" != "x86_64" && "$ARCH" != "amd64" ]]; then
  echo "Unsupported architecture: $ARCH. Linux releases are x86_64 only." >&2
  exit 1
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required build tool not found: $1" >&2
    exit 1
  }
}

resolve_executable() {
  local explicit="$1" command_name="$2" description="$3" resolved
  if [[ -n "$explicit" ]]; then
    resolved="$(realpath -- "$explicit")"
  else
    resolved="$(command -v "$command_name" || true)"
  fi
  if [[ -z "$resolved" || ! -f "$resolved" || ! -x "$resolved" ]]; then
    echo "$description was not found or is not executable. Pass its explicit path." >&2
    exit 1
  fi
  printf '%s\n' "$resolved"
}

for command_name in uv npm cargo tar sha256sum install realpath; do
  require_command "$command_name"
done

FFMPEG_PATH="$(resolve_executable "$FFMPEG_PATH" ffmpeg FFmpeg)"
FFPROBE_PATH="$(resolve_executable "$FFPROBE_PATH" ffprobe FFprobe)"
NODE_PATH="$(resolve_executable "$NODE_PATH" node Node.js)"
"$FFMPEG_PATH" -version >/dev/null
"$FFPROBE_PATH" -version >/dev/null
"$NODE_PATH" --version >/dev/null
cargo --version >/dev/null

cd -- "$REPO_ROOT"
uv sync --locked --python 3.12
uv run --locked pyinstaller --version >/dev/null
VERSION="$(uv run --locked python -c 'from janeconverter.version import __version__; print(__version__)' 2>/dev/null)"
if [[ -z "$VERSION" ]]; then
  echo "Could not determine the version from src/janeconverter/version.py." >&2
  exit 1
fi
TAURI_VERSION="$VERSION"
if ((ENABLE_UPDATER)); then
  [[ "$BUILD_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || {
    echo "Updater builds require a full 40-character source commit." >&2
    exit 1
  }
  [[ -n "${JANECONVERTER_UPDATER_PUBKEY:-}" ]] || {
    echo "Set the JANECONVERTER_UPDATER_PUBKEY GitHub Actions variable before building updater packages." >&2
    exit 1
  }
  [[ -n "$signing_private_key" ]] || {
    echo "Set the TAURI_SIGNING_PRIVATE_KEY GitHub Actions secret before building updater packages." >&2
    exit 1
  }
  if ((UPDATER_ONLY)); then
    escaped_version="${VERSION//./\.}"
    [[ "$UPDATER_VERSION" =~ ^${escaped_version}\+build\.[0-9]+\.g${BUILD_COMMIT}$ ]] || {
      echo "Updater build version must be $VERSION+build.<sequence>.g$BUILD_COMMIT." >&2
      exit 1
    }
    TAURI_VERSION="$UPDATER_VERSION"
  fi
  BUILD_COMMIT="${BUILD_COMMIT,,}"
fi
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

OUTPUT_DIR="$(mkdir -p -- "$OUTPUT_DIR" && cd -- "$OUTPUT_DIR" && pwd)"
if ((UPDATER_ONLY)); then
  BUILD_ROOT="$OUTPUT_DIR/consumer-build-updater-linux-x86_64"
else
  BUILD_ROOT="$OUTPUT_DIR/consumer-build-$VERSION-linux-x86_64"
fi
PAYLOAD_ROOT="$BUILD_ROOT/payload/JaneConverter"
RUNTIME_ROOT="$PAYLOAD_ROOT/resources/runtime"
RUNTIME_ENGINE="$RUNTIME_ROOT/engine"
RUNTIME_BIN="$RUNTIME_ROOT/bin"
PYINSTALLER_ROOT="$BUILD_ROOT/pyinstaller"
TAURI_TARGET="$BUILD_ROOT/tauri-target"
ARCHIVE="$OUTPUT_DIR/JaneConverter-$VERSION-linux-x86_64.tar.gz"
if ((UPDATER_ONLY)); then
  UPDATER_ARTIFACT="$OUTPUT_DIR/JaneConverter-continuous-linux-x86_64.AppImage"
else
  UPDATER_ARTIFACT="$OUTPUT_DIR/JaneConverter-$VERSION-linux-x86_64.AppImage"
fi
UPDATER_SIGNATURE="$UPDATER_ARTIFACT.sig"

rm -rf -- "$BUILD_ROOT"
rm -f -- "$ARCHIVE" "$ARCHIVE.sha256"
rm -f -- "$UPDATER_ARTIFACT" "$UPDATER_ARTIFACT.sha256" "$UPDATER_SIGNATURE"
mkdir -p -- "$RUNTIME_ENGINE" "$RUNTIME_BIN" "$PYINSTALLER_ROOT/spec"

echo "Building the frozen engine (onedir)..."
uv run --locked pyinstaller --noconfirm --clean --onedir --contents-directory _internal \
  --collect-all yt_dlp_ejs \
  --name JaneConverterEngine \
  --paths "$REPO_ROOT/src" \
  --distpath "$PYINSTALLER_ROOT/dist" \
  --workpath "$PYINSTALLER_ROOT/work" \
  --specpath "$PYINSTALLER_ROOT/spec" \
  "$REPO_ROOT/packaging/engine_entry.py"

BUILT_ENGINE="$PYINSTALLER_ROOT/dist/JaneConverterEngine"
[[ -x "$BUILT_ENGINE/JaneConverterEngine" ]] || {
  echo "PyInstaller did not produce the expected onedir engine." >&2
  exit 1
}
cp -a -- "$BUILT_ENGINE/." "$RUNTIME_ENGINE/"
install -m 0755 -- "$FFMPEG_PATH" "$RUNTIME_BIN/ffmpeg"
install -m 0755 -- "$FFPROBE_PATH" "$RUNTIME_BIN/ffprobe"
install -m 0755 -- "$NODE_PATH" "$RUNTIME_BIN/node"
install -m 0644 -- "$REPO_ROOT/LICENSE" "$PAYLOAD_ROOT/LICENSE"
install -m 0644 -- "$REPO_ROOT/packaging/THIRD-PARTY-NOTICES.md" "$PAYLOAD_ROOT/THIRD-PARTY-NOTICES.md"
cat > "$PAYLOAD_ROOT/FFMPEG-SOURCE-INFO.txt" <<'EOF'
FFmpeg source revision: ge0c94b2d1c
FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/ge0c94b2d1c
BtbN build source: https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-09-30-13-08
BtbN release: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08
EOF
"$FFMPEG_PATH" -version > "$PAYLOAD_ROOT/FFMPEG-BUILD-INFO.txt"
uv run --locked python "$REPO_ROOT/packaging/smoke_test_engine.py" \
  --engine "$RUNTIME_ENGINE/JaneConverterEngine" \
  --runtime-bin "$RUNTIME_BIN" \
  --work-directory "$PYINSTALLER_ROOT/smoke"

if find "$RUNTIME_ROOT" -type f \( \
  -name 'JaneConverterPython*' -o -name 'JaneConverterNative*' -o \
  -name 'Program.cs' -o -name '*.py' -o -name 'pip' -o -name 'npm' -o \
  -name 'cargo' -o -name 'rustc' \) -print -quit | grep -q .; then
  echo "Private runtime contains a forbidden source or build-tool file." >&2
  exit 1
fi

TAURI_CONFIG="$BUILD_ROOT/tauri.release.json"
export JANECONVERTER_RUNTIME_ROOT="$RUNTIME_ROOT"
export JANECONVERTER_STAGED_LICENSE="$PAYLOAD_ROOT/LICENSE"
export JANECONVERTER_STAGED_NOTICES="$PAYLOAD_ROOT/THIRD-PARTY-NOTICES.md"
export JANECONVERTER_STAGED_FFMPEG_INFO="$PAYLOAD_ROOT/FFMPEG-BUILD-INFO.txt"
export JANECONVERTER_STAGED_FFMPEG_SOURCE_INFO="$PAYLOAD_ROOT/FFMPEG-SOURCE-INFO.txt"
write_tauri_config() {
  local config_mode="$1"
  export JANECONVERTER_RELEASE_VERSION="$TAURI_VERSION"
  export JANECONVERTER_TAURI_CONFIG="$TAURI_CONFIG"
  export JANECONVERTER_ENABLE_UPDATER="$ENABLE_UPDATER"
  export JANECONVERTER_TAURI_CONFIG_MODE="$config_mode"
  uv run --locked python - <<'PY'
import json
import os
from pathlib import Path

source = Path("desktop-ui/src-tauri/tauri.conf.json")
config = json.loads(source.read_text(encoding="utf-8"))
config["productName"] = "JaneConverter"
config["version"] = os.environ["JANECONVERTER_RELEASE_VERSION"]
config["build"]["beforeBuildCommand"] = ""
mode = os.environ["JANECONVERTER_TAURI_CONFIG_MODE"]
config["bundle"]["active"] = mode == "updater"
config["bundle"]["targets"] = ["appimage"] if mode == "updater" else []
if mode == "updater":
    config["bundle"]["createUpdaterArtifacts"] = True
    config["bundle"]["resources"] = {
        os.environ["JANECONVERTER_RUNTIME_ROOT"]: "runtime",
        os.environ["JANECONVERTER_STAGED_LICENSE"]: "LICENSE",
        os.environ["JANECONVERTER_STAGED_NOTICES"]: "THIRD-PARTY-NOTICES.md",
        os.environ["JANECONVERTER_STAGED_FFMPEG_INFO"]: "FFMPEG-BUILD-INFO.txt",
        os.environ["JANECONVERTER_STAGED_FFMPEG_SOURCE_INFO"]: "FFMPEG-SOURCE-INFO.txt",
    }
    config.setdefault("plugins", {})["updater"] = {
        "pubkey": os.environ["JANECONVERTER_UPDATER_PUBKEY"],
        "endpoints": ["https://github.com/jeongchaeul/JaneConverter/releases/download/continuous/latest.json"],
    }
elif os.environ["JANECONVERTER_ENABLE_UPDATER"] == "1":
    # The portable archive is deliberately built without the AppImage updater.
    config.pop("plugins", None)
Path(os.environ["JANECONVERTER_TAURI_CONFIG"]).write_text(
    json.dumps(config, indent=2) + "\n", encoding="utf-8"
)
PY
}

export CARGO_TARGET_DIR="$TAURI_TARGET"
export npm_config_cache="$BUILD_ROOT/npm-cache"
(
  cd -- "$REPO_ROOT/desktop-ui"
  npm ci --no-audit --no-fund --ignore-scripts
  npm run build
)
if ((!UPDATER_ONLY)); then
  write_tauri_config portable
  unset JANECONVERTER_BUILD_COMMIT
  echo "Building the portable Linux application..."
  (
    cd -- "$REPO_ROOT/desktop-ui"
    ./node_modules/.bin/tauri build --no-bundle --config "$TAURI_CONFIG"
  )
  TAURI_EXECUTABLE="$TAURI_TARGET/release/janeconverter-desktop"
  [[ -x "$TAURI_EXECUTABLE" ]] || {
    echo "Tauri did not produce the expected executable." >&2
    exit 1
  }
  install -m 0755 -- "$TAURI_EXECUTABLE" "$PAYLOAD_ROOT/JaneConverter"
  tar -C "$BUILD_ROOT/payload" -czf "$ARCHIVE" JaneConverter
  (
    cd -- "$OUTPUT_DIR"
    sha256sum "$(basename -- "$ARCHIVE")" >"$(basename -- "$ARCHIVE").sha256"
  )
  echo "Created $ARCHIVE"
fi

if ((ENABLE_UPDATER)); then
  export JANECONVERTER_BUILD_COMMIT="$BUILD_COMMIT"
  write_tauri_config updater
  echo "Building the signed Linux AppImage updater..."
  (
    cd -- "$REPO_ROOT/desktop-ui"
    export TAURI_SIGNING_PRIVATE_KEY="$signing_private_key"
    if [[ -n "$signing_private_key_password" ]]; then
      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$signing_private_key_password"
    fi
    ./node_modules/.bin/tauri build --config "$TAURI_CONFIG"
  )
  APPIMAGE_DIRECTORY="$TAURI_TARGET/release/bundle/appimage"
  BUILT_APPIMAGE="$(find "$APPIMAGE_DIRECTORY" -type f -iname '*.AppImage' -print -quit)"
  [[ -n "$BUILT_APPIMAGE" && -f "$BUILT_APPIMAGE.sig" ]] || {
    echo "Tauri did not produce the signed Linux AppImage updater." >&2
    exit 1
  }
  cp -p -- "$BUILT_APPIMAGE" "$UPDATER_ARTIFACT"
  cp -p -- "$BUILT_APPIMAGE.sig" "$UPDATER_SIGNATURE"
  (
    cd -- "$OUTPUT_DIR"
    sha256sum "$(basename -- "$UPDATER_ARTIFACT")" >"$(basename -- "$UPDATER_ARTIFACT").sha256"
  )
  echo "Created signed updater package $UPDATER_ARTIFACT"
fi

if ((KEEP_STAGING == 0)); then
  rm -rf -- "$BUILD_ROOT"
fi
