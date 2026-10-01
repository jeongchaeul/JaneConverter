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
BUILD_ROOT=""

usage() {
  cat <<'EOF'
Usage: packaging/build_macos.sh [options]
  --ffmpeg PATH       native FFmpeg executable
  --ffprobe PATH      native FFprobe executable
  --node PATH         native Node.js executable
  --output-dir PATH   artifact directory (default: dist)
  --enable-updater    configure the signed repository updater in this package
  --updater-only      build only a signed continuous updater package
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

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS release packages must be built natively on Darwin." >&2
  exit 1
fi

ARCH="$(uname -m)"
if [[ "$ARCH" != "arm64" && "$ARCH" != "x86_64" ]]; then
  echo "Unsupported architecture: $ARCH. macOS releases support arm64 and x86_64." >&2
  exit 1
fi
if [[ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == "1" ]]; then
  echo "Rosetta-translated builds are not supported; run the build natively." >&2
  exit 1
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required build tool not found: $1" >&2
    exit 1
  }
}

resolve_executable() {
  local explicit="$1" command_name="$2" description="$3" resolved directory
  if [[ -n "$explicit" ]]; then
    directory="$(cd -- "$(dirname -- "$explicit")" && pwd)"
    resolved="$directory/$(basename -- "$explicit")"
  else
    resolved="$(command -v "$command_name" || true)"
  fi
  if [[ -z "$resolved" || ! -f "$resolved" || ! -x "$resolved" ]]; then
    echo "$description was not found or is not executable. Pass its explicit path." >&2
    exit 1
  fi
  printf '%s\n' "$resolved"
}

assert_macho_arch() {
  local executable="$1" description="$2" architectures
  if ! file "$executable" | grep -q 'Mach-O'; then
    echo "$description is not a Mach-O executable: $executable" >&2
    exit 1
  fi
  architectures="$(lipo -archs "$executable")"
  if ! grep -qw "$ARCH" <<<"$architectures"; then
    echo "$description does not contain the native $ARCH architecture: $architectures" >&2
    exit 1
  fi
}

cleanup() {
  if ((KEEP_STAGING == 0)) && [[ -n "$BUILD_ROOT" && -d "$BUILD_ROOT" && "$BUILD_ROOT" == "$OUTPUT_DIR"/consumer-build-* ]]; then
    rm -rf -- "$BUILD_ROOT"
  fi
}
trap cleanup EXIT

for command_name in uv npm cargo codesign file find grep hdiutil install lipo shasum sysctl xattr; do
  require_command "$command_name"
done

FFMPEG_PATH="$(resolve_executable "$FFMPEG_PATH" ffmpeg FFmpeg)"
FFPROBE_PATH="$(resolve_executable "$FFPROBE_PATH" ffprobe FFprobe)"
NODE_PATH="$(resolve_executable "$NODE_PATH" node Node.js)"
assert_macho_arch "$FFMPEG_PATH" FFmpeg
assert_macho_arch "$FFPROBE_PATH" FFprobe
assert_macho_arch "$NODE_PATH" Node.js
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
    [[ "$UPDATER_VERSION" =~ ^${VERSION//./\.}\+build\.[0-9]+\.g${BUILD_COMMIT}$ ]] || {
      echo "Updater build version must be $VERSION+build.<sequence>.g$BUILD_COMMIT." >&2
      exit 1
    }
    TAURI_VERSION="$UPDATER_VERSION"
  fi
  BUILD_COMMIT="$(printf '%s' "$BUILD_COMMIT" | tr '[:upper:]' '[:lower:]')"
  export JANECONVERTER_BUILD_COMMIT="$BUILD_COMMIT"
fi
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

OUTPUT_DIR="$(mkdir -p -- "$OUTPUT_DIR" && cd -- "$OUTPUT_DIR" && pwd)"
if ((UPDATER_ONLY)); then
  BUILD_ROOT="$OUTPUT_DIR/consumer-build-updater-macos-$ARCH"
else
  BUILD_ROOT="$OUTPUT_DIR/consumer-build-$VERSION-macos-$ARCH"
fi
STAGING_ROOT="$BUILD_ROOT/resources"
RUNTIME_ROOT="$STAGING_ROOT/runtime"
RUNTIME_ENGINE="$RUNTIME_ROOT/engine"
RUNTIME_BIN="$RUNTIME_ROOT/bin"
PYINSTALLER_ROOT="$BUILD_ROOT/pyinstaller"
TAURI_TARGET="$BUILD_ROOT/tauri-target"
ARTIFACT="$OUTPUT_DIR/JaneConverter-$VERSION-macos-$ARCH.dmg"
UPDATER_ARTIFACT="$OUTPUT_DIR/JaneConverter-continuous-macos-$ARCH.app.tar.gz"
UPDATER_SIGNATURE="$UPDATER_ARTIFACT.sig"

rm -rf -- "$BUILD_ROOT"
rm -f -- "$ARTIFACT" "$ARTIFACT.sha256"
rm -f -- "$UPDATER_ARTIFACT" "$UPDATER_SIGNATURE"
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
if [[ -d "$RUNTIME_ENGINE/_internal/yt_dlp_ejs" ]]; then
  find "$RUNTIME_ENGINE/_internal/yt_dlp_ejs" -type f -name '*.py' -delete
fi
install -m 0755 -- "$FFMPEG_PATH" "$RUNTIME_BIN/ffmpeg"
install -m 0755 -- "$FFPROBE_PATH" "$RUNTIME_BIN/ffprobe"
install -m 0755 -- "$NODE_PATH" "$RUNTIME_BIN/node"
install -m 0644 -- "$REPO_ROOT/LICENSE" "$STAGING_ROOT/LICENSE"
install -m 0644 -- "$REPO_ROOT/packaging/THIRD-PARTY-NOTICES.md" "$STAGING_ROOT/THIRD-PARTY-NOTICES.md"
cat > "$STAGING_ROOT/FFMPEG-SOURCE-INFO.txt" <<'EOF'
FFmpeg package: eugeneware/ffmpeg-static b6.1.1
FFmpeg package source: https://github.com/eugeneware/ffmpeg-static/tree/b6.1.1
FFmpeg source repository: https://git.ffmpeg.org/ffmpeg.git
EOF
"$FFMPEG_PATH" -version > "$STAGING_ROOT/FFMPEG-BUILD-INFO.txt"
xattr -dr com.apple.quarantine "$STAGING_ROOT" 2>/dev/null || true

if find "$RUNTIME_ROOT" -type f \( \
  -name 'JaneConverterPython*' -o -name 'JaneConverterNative*' -o \
  -name 'Program.cs' -o -name '*.py' -o -name 'pip' -o -name 'npm' -o \
  -name 'cargo' -o -name 'rustc' \) -print -quit | grep -q .; then
  echo "Private runtime contains a forbidden source or build-tool file." >&2
  exit 1
fi

echo "Validating and ad-hoc signing the private runtime..."
while IFS= read -r -d '' candidate; do
  if file "$candidate" | grep -q 'Mach-O'; then
    assert_macho_arch "$candidate" "Staged Mach-O file"
    codesign --force --sign - --timestamp=none "$candidate"
    codesign --verify --strict "$candidate"
  fi
done < <(find "$RUNTIME_ROOT" -type f -print0)

uv run --locked python "$REPO_ROOT/packaging/smoke_test_engine.py" \
  --engine "$RUNTIME_ENGINE/JaneConverterEngine" \
  --runtime-bin "$RUNTIME_BIN" \
  --work-directory "$PYINSTALLER_ROOT/smoke"
"$RUNTIME_BIN/ffmpeg" -version >/dev/null
"$RUNTIME_BIN/ffprobe" -version >/dev/null
"$RUNTIME_BIN/node" --version >/dev/null

TAURI_CONFIG="$BUILD_ROOT/tauri.release.json"
export JANECONVERTER_RELEASE_VERSION="$TAURI_VERSION"
export JANECONVERTER_RUNTIME_ROOT="$RUNTIME_ROOT"
export JANECONVERTER_STAGED_LICENSE="$STAGING_ROOT/LICENSE"
export JANECONVERTER_STAGED_NOTICES="$STAGING_ROOT/THIRD-PARTY-NOTICES.md"
export JANECONVERTER_STAGED_FFMPEG_INFO="$STAGING_ROOT/FFMPEG-BUILD-INFO.txt"
export JANECONVERTER_STAGED_FFMPEG_SOURCE_INFO="$STAGING_ROOT/FFMPEG-SOURCE-INFO.txt"
export JANECONVERTER_TAURI_CONFIG="$TAURI_CONFIG"
export JANECONVERTER_ENABLE_UPDATER="$ENABLE_UPDATER"
export JANECONVERTER_UPDATER_ONLY="$UPDATER_ONLY"
uv run --locked python - <<'PY'
import json
import os
from pathlib import Path

source = Path("desktop-ui/src-tauri/tauri.conf.json")
config = json.loads(source.read_text(encoding="utf-8"))
config["productName"] = "JaneConverter"
config["version"] = os.environ["JANECONVERTER_RELEASE_VERSION"]
config["build"]["beforeBuildCommand"] = ""
config["bundle"]["active"] = True
# Keep the app bundle so it can be verified after Tauri creates the DMG.
config["bundle"]["targets"] = ["app"] if os.environ.get("JANECONVERTER_UPDATER_ONLY") == "1" else ["app", "dmg"]
config["bundle"]["resources"] = {
    os.environ["JANECONVERTER_RUNTIME_ROOT"]: "runtime",
    os.environ["JANECONVERTER_STAGED_LICENSE"]: "LICENSE",
    os.environ["JANECONVERTER_STAGED_NOTICES"]: "THIRD-PARTY-NOTICES.md",
    os.environ["JANECONVERTER_STAGED_FFMPEG_INFO"]: "FFMPEG-BUILD-INFO.txt",
    os.environ["JANECONVERTER_STAGED_FFMPEG_SOURCE_INFO"]: "FFMPEG-SOURCE-INFO.txt",
}
config["bundle"].setdefault("macOS", {})["signingIdentity"] = "-"
if os.environ["JANECONVERTER_ENABLE_UPDATER"] == "1":
    config["bundle"]["createUpdaterArtifacts"] = True
    config.setdefault("plugins", {})["updater"] = {
        "pubkey": os.environ["JANECONVERTER_UPDATER_PUBKEY"],
        "endpoints": ["https://github.com/jeongchaeul/JaneConverter/releases/download/continuous/latest.json"],
    }
Path(os.environ["JANECONVERTER_TAURI_CONFIG"]).write_text(
    json.dumps(config, indent=2) + "\n", encoding="utf-8"
)
PY

echo "Building the production Tauri app and DMG..."
export CARGO_TARGET_DIR="$TAURI_TARGET"
export npm_config_cache="$BUILD_ROOT/npm-cache"
(
  cd -- "$REPO_ROOT/desktop-ui"
  npm ci --no-audit --no-fund --ignore-scripts
  npm run build
  if ((ENABLE_UPDATER)); then
    export TAURI_SIGNING_PRIVATE_KEY="$signing_private_key"
    if [[ -n "$signing_private_key_password" ]]; then
      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$signing_private_key_password"
    fi
  fi
  ./node_modules/.bin/tauri build --config "$TAURI_CONFIG"
)

BUNDLED_APP="$TAURI_TARGET/release/bundle/macos/JaneConverter.app"
[[ -d "$BUNDLED_APP" ]] || {
  echo "Tauri did not produce the expected macOS app bundle." >&2
  exit 1
}
codesign --verify --deep --strict --verbose=2 "$BUNDLED_APP"
BUNDLED_UI="$BUNDLED_APP/Contents/MacOS/janeconverter-desktop"
[[ -x "$BUNDLED_UI" ]] || {
  echo "The app bundle does not contain the expected desktop executable." >&2
  exit 1
}
assert_macho_arch "$BUNDLED_UI" "Bundled desktop executable"
BUNDLED_RUNTIME="$BUNDLED_APP/Contents/Resources/runtime"
[[ -x "$BUNDLED_RUNTIME/engine/JaneConverterEngine" ]] || {
  echo "The app bundle does not contain the staged engine." >&2
  exit 1
}
assert_macho_arch "$BUNDLED_RUNTIME/engine/JaneConverterEngine" "Bundled engine"
"$BUNDLED_RUNTIME/engine/JaneConverterEngine" --version >/dev/null
"$BUNDLED_RUNTIME/bin/ffmpeg" -version >/dev/null
"$BUNDLED_RUNTIME/bin/ffprobe" -version >/dev/null
"$BUNDLED_RUNTIME/bin/node" --version >/dev/null

if ((UPDATER_ONLY)); then
  BUILT_UPDATER="$TAURI_TARGET/release/bundle/macos/JaneConverter.app.tar.gz"
  [[ -f "$BUILT_UPDATER" && -f "$BUILT_UPDATER.sig" ]] || {
    echo "Tauri did not produce the signed macOS updater archive." >&2
    exit 1
  }
  cp -p -- "$BUILT_UPDATER" "$UPDATER_ARTIFACT"
  cp -p -- "$BUILT_UPDATER.sig" "$UPDATER_SIGNATURE"
  echo "Created signed updater package $UPDATER_ARTIFACT"
  exit 0
fi

DMG_DIRECTORY="$TAURI_TARGET/release/bundle/dmg"
DMG_COUNT="$(find "$DMG_DIRECTORY" -type f -name '*.dmg' | wc -l | tr -d ' ')"
if [[ "$DMG_COUNT" != "1" ]]; then
  echo "Expected exactly one Tauri DMG, found $DMG_COUNT." >&2
  exit 1
fi
BUILT_DMG="$(find "$DMG_DIRECTORY" -type f -name '*.dmg' -print -quit)"
cp -p -- "$BUILT_DMG" "$ARTIFACT"
(
  cd -- "$OUTPUT_DIR"
  shasum -a 256 "$(basename -- "$ARTIFACT")" >"$(basename -- "$ARTIFACT").sha256"
)
echo "Created $ARTIFACT"
