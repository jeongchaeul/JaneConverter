"""Runtime yt-dlp wheel override loader and verified installer."""

from __future__ import annotations

import ast
import hashlib
import importlib
import importlib.abc
import importlib.machinery
import importlib.metadata
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlparse

OVERRIDES_ENV_VAR = "JANECONVERTER_ENGINE_OVERRIDES_DIR"
ACTIVE_DIR_NAME = "yt_dlp_active"
MANIFEST_NAME = "manifest.json"
TRUSTED_WHEEL_HOSTS = {"files.pythonhosted.org"}
MAX_WHEEL_BYTES = 25 * 1024 * 1024
MAX_EXTRACTED_BYTES = 100 * 1024 * 1024

_CALVER_RE = re.compile(r"^(\d{4})(?:\.\d+)+$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def get_engine_overrides_dir() -> Path:
    """Return local per-user directory for verified yt-dlp runtime overrides."""
    configured = os.environ.get(OVERRIDES_ENV_VAR, "").strip()
    if configured:
        return Path(os.path.abspath(configured))

    if os.name == "nt":
        base = (
            os.environ.get("LOCALAPPDATA", "").strip()
            or os.environ.get("APPDATA", "").strip()
            or tempfile.gettempdir()
        )
        return Path(base) / "JaneConverter" / "engine_overrides"

    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "JaneConverter" / "engine_overrides"

    xdg_data = os.environ.get("XDG_DATA_HOME", "").strip()
    base_dir = Path(xdg_data) if xdg_data else (Path.home() / ".local" / "share")
    return base_dir / "JaneConverter" / "engine_overrides"


def is_valid_calver(ver: str) -> bool:
    """Validate yt-dlp CalVer string within the supported year bounds."""
    if not isinstance(ver, str):
        return False
    match = _CALVER_RE.match(ver.strip())
    if not match:
        return False
    year = int(match.group(1))
    return 2024 <= year <= 2029


def is_newer_version(candidate: str, current: str) -> bool:
    """Return True if candidate version is strictly newer than current."""
    if not candidate or not current:
        return False
    try:
        from packaging.version import Version

        return Version(str(candidate).strip()) > Version(str(current).strip())
    except Exception:
        def _parts(value: str) -> tuple:
            match = re.match(r"^v?(\d+(?:\.\d+){0,3})", str(value).strip())
            if not match:
                return tuple()
            return tuple(int(part) for part in match.group(1).split("."))

        return _parts(candidate) > _parts(current)


class _YtDlpOverrideFinder(importlib.abc.MetaPathFinder):
    """MetaPathFinder scoped exclusively to the yt_dlp package tree."""

    def __init__(self, search_root: str) -> None:
        self.search_root = search_root

    def find_spec(
        self,
        fullname: str,
        path: Any = None,
        target: Any = None,
    ) -> Optional[importlib.machinery.ModuleSpec]:
        if fullname != "yt_dlp" and not fullname.startswith("yt_dlp."):
            return None
        search_paths = [self.search_root] if fullname == "yt_dlp" or path is None else list(path)
        return importlib.machinery.PathFinder.find_spec(fullname, search_paths, target)


def get_bundled_yt_dlp_version() -> Optional[str]:
    """Read the bundled/environment yt-dlp version without importing yt_dlp."""
    if getattr(sys, "frozen", False):
        for finder in sys.meta_path:
            if isinstance(finder, _YtDlpOverrideFinder):
                continue
            get_code = getattr(finder, "get_code", None)
            if callable(get_code):
                try:
                    code = get_code("yt_dlp.version")
                except Exception:
                    code = None
                if code is not None:
                    ns: Dict[str, Any] = {}
                    try:
                        exec(code, ns)
                    except Exception:
                        ns = {}
                    ver = ns.get("__version__")
                    if isinstance(ver, str) and ver.strip():
                        return ver.strip()

    try:
        ver = importlib.metadata.version("yt-dlp")
        if isinstance(ver, str) and ver.strip():
            return ver.strip()
    except Exception:
        pass
    return None


def activate_yt_dlp_override(overrides_dir: Optional[Path] = None) -> Optional[str]:
    """Prepend a verified yt-dlp override finder if it is newer than the bundled build."""
    try:
        if "yt_dlp" in sys.modules:
            return None

        root = overrides_dir if overrides_dir is not None else get_engine_overrides_dir()
        active_dir = root / ACTIVE_DIR_NAME
        manifest_path = active_dir / MANIFEST_NAME
        if not manifest_path.is_file():
            return None

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            return None
        override_ver = str(manifest.get("version", "")).strip()
        if not is_valid_calver(override_ver):
            return None

        if not (active_dir / "yt_dlp" / "__init__.py").is_file():
            return None
        if not (active_dir / "yt_dlp" / "version.py").is_file():
            return None

        bundled_ver = get_bundled_yt_dlp_version()
        if bundled_ver and not is_newer_version(override_ver, bundled_ver):
            return None

        sys.meta_path[:] = [f for f in sys.meta_path if not isinstance(f, _YtDlpOverrideFinder)]
        sys.meta_path.insert(0, _YtDlpOverrideFinder(str(active_dir)))
        importlib.invalidate_caches()
        return override_ver
    except Exception:
        return None


def _extract_version_from_file(version_file: Path) -> Optional[str]:
    """Parse __version__ from yt_dlp/version.py safely using AST inspection."""
    try:
        tree = ast.parse(version_file.read_text(encoding="utf-8"))
    except (OSError, SyntaxError, UnicodeDecodeError):
        return None
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "__version__":
                    try:
                        value = ast.literal_eval(node.value)
                    except Exception:
                        return None
                    if isinstance(value, str):
                        return value.strip()
    return None


def _select_wheel_entry(urls: Any) -> Optional[Dict[str, Any]]:
    """Select the preferred universal bdist_wheel release entry from PyPI JSON."""
    if not isinstance(urls, list):
        return None
    wheels = [u for u in urls if isinstance(u, dict) and u.get("packagetype") == "bdist_wheel"]
    for entry in wheels:
        if str(entry.get("filename", "")).endswith("-py3-none-any.whl"):
            return entry
    return wheels[0] if wheels else None


def _validate_wheel_member(info: zipfile.ZipInfo) -> Optional[PurePosixPath]:
    """Validate a zip entry path and reject symlinks or traversal outside yt_dlp/."""
    mode = (info.external_attr >> 16) & 0o170000
    if mode == 0o120000:
        raise ValueError(f"Refusing symlink in wheel archive: {info.filename}")

    raw_name = info.filename
    if raw_name.startswith("/") or raw_name.startswith("\\") or "\\" in raw_name or ":" in raw_name:
        raise ValueError(f"Refusing unsafe path in wheel archive: {raw_name}")

    posix_path = PurePosixPath(raw_name)
    if posix_path.is_absolute() or ".." in posix_path.parts:
        raise ValueError(f"Refusing path traversal in wheel archive: {raw_name}")

    if not posix_path.parts or posix_path.parts[0] != "yt_dlp":
        return None
    return posix_path


def install_yt_dlp_override(
    target_version: Optional[str] = None,
    status_callback: Optional[Callable[[str], None]] = None,
    timeout_seconds: float = 30.0,
    overrides_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Download, verify, and atomically activate a yt-dlp wheel override from PyPI."""
    import requests

    def log(msg: str) -> None:
        if status_callback:
            status_callback(msg)

    clean_target: Optional[str] = None
    if target_version is not None:
        clean_target = str(target_version).strip()
        if not is_valid_calver(clean_target):
            return {
                "success": False,
                "updated": False,
                "error": f"Unsupported yt-dlp version '{clean_target}'.",
            }

    metadata_url = (
        f"https://pypi.org/pypi/yt-dlp/{clean_target}/json"
        if clean_target
        else "https://pypi.org/pypi/yt-dlp/json"
    )

    try:
        resp = requests.get(metadata_url, timeout=max(3.0, float(timeout_seconds)))
        if resp.status_code != 200:
            return {
                "success": False,
                "updated": False,
                "error": f"PyPI returned HTTP {resp.status_code} while querying yt-dlp.",
            }
        payload = resp.json()
    except Exception as error:
        return {
            "success": False,
            "updated": False,
            "error": f"Could not reach PyPI for yt-dlp metadata: {error}",
        }

    latest_version = str(payload.get("info", {}).get("version", "")).strip()
    if not is_valid_calver(latest_version):
        return {
            "success": False,
            "updated": False,
            "error": f"PyPI returned an unsupported yt-dlp version '{latest_version}'.",
        }
    if clean_target and latest_version != clean_target:
        return {
            "success": False,
            "updated": False,
            "error": f"PyPI metadata version mismatch ({latest_version} != {clean_target}).",
        }

    wheel_entry = _select_wheel_entry(payload.get("urls"))
    if not wheel_entry:
        return {
            "success": False,
            "updated": False,
            "error": f"No wheel distribution found on PyPI for yt-dlp v{latest_version}.",
        }

    wheel_url = str(wheel_entry.get("url", "")).strip()
    wheel_filename = str(wheel_entry.get("filename", "")).strip() or f"yt_dlp-{latest_version}-py3-none-any.whl"
    parsed_url = urlparse(wheel_url)
    if parsed_url.scheme != "https" or parsed_url.netloc.lower() not in TRUSTED_WHEEL_HOSTS:
        return {
            "success": False,
            "updated": False,
            "error": f"Refusing untrusted wheel host: {parsed_url.netloc or wheel_url}",
        }

    expected_sha256 = str(wheel_entry.get("digests", {}).get("sha256", "")).strip().lower()
    if not _SHA256_RE.fullmatch(expected_sha256):
        return {
            "success": False,
            "updated": False,
            "error": "PyPI wheel metadata is missing a valid SHA-256 digest.",
        }

    root = overrides_dir if overrides_dir is not None else get_engine_overrides_dir()
    root.mkdir(parents=True, exist_ok=True)

    tmp_wheel_path: Optional[Path] = None
    staging_dir: Optional[Path] = None
    backup_dir: Optional[Path] = None

    try:
        log(f"Downloading yt-dlp v{latest_version} wheel...")
        with tempfile.NamedTemporaryFile(
            dir=root, prefix=".ytdlp-wheel-", suffix=".whl", delete=False
        ) as tmp_file:
            tmp_wheel_path = Path(tmp_file.name)
            hasher = hashlib.sha256()
            downloaded = 0
            with requests.get(
                wheel_url, stream=True, timeout=max(5.0, float(timeout_seconds))
            ) as dl_resp:
                if dl_resp.status_code != 200:
                    return {
                        "success": False,
                        "updated": False,
                        "error": f"Wheel download failed with HTTP {dl_resp.status_code}.",
                    }
                for chunk in dl_resp.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    downloaded += len(chunk)
                    if downloaded > MAX_WHEEL_BYTES:
                        return {
                            "success": False,
                            "updated": False,
                            "error": "yt-dlp wheel exceeded maximum allowed download size.",
                        }
                    hasher.update(chunk)
                    tmp_file.write(chunk)

        actual_sha256 = hasher.hexdigest().lower()
        if actual_sha256 != expected_sha256:
            return {
                "success": False,
                "updated": False,
                "error": "Downloaded yt-dlp wheel failed SHA-256 integrity verification.",
            }

        staging_dir = Path(tempfile.mkdtemp(dir=root, prefix=".ytdlp-stage-"))
        staging_pkg_root = (staging_dir / "yt_dlp").resolve()
        total_extracted = 0

        with zipfile.ZipFile(tmp_wheel_path, "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                rel_path = _validate_wheel_member(info)
                if rel_path is None:
                    continue
                if info.file_size < 0 or total_extracted + info.file_size > MAX_EXTRACTED_BYTES:
                    raise ValueError("Extracted yt-dlp package exceeded maximum allowed size.")

                dest_path = (staging_dir / Path(*rel_path.parts)).resolve()
                if dest_path != staging_pkg_root and staging_pkg_root not in dest_path.parents:
                    raise ValueError(f"Refusing path outside staging root: {info.filename}")

                dest_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as src, open(dest_path, "wb") as dst:
                    while True:
                        buf = src.read(65536)
                        if not buf:
                            break
                        total_extracted += len(buf)
                        if total_extracted > MAX_EXTRACTED_BYTES:
                            raise ValueError("Extracted yt-dlp package exceeded maximum allowed size.")
                        dst.write(buf)

        init_file = staging_dir / "yt_dlp" / "__init__.py"
        version_file = staging_dir / "yt_dlp" / "version.py"
        if not init_file.is_file() or not version_file.is_file():
            return {
                "success": False,
                "updated": False,
                "error": "Extracted yt-dlp wheel is missing core package files.",
            }

        extracted_version = _extract_version_from_file(version_file)
        if extracted_version != latest_version:
            return {
                "success": False,
                "updated": False,
                "error": (
                    f"Extracted yt-dlp version '{extracted_version}' did not match "
                    f"expected v{latest_version}."
                ),
            }

        manifest_data = {
            "version": latest_version,
            "sha256": expected_sha256,
            "filename": wheel_filename,
        }
        (staging_dir / MANIFEST_NAME).write_text(
            json.dumps(manifest_data, indent=2) + "\n", encoding="utf-8"
        )

        active_dir = root / ACTIVE_DIR_NAME
        backup_dir = root / f".ytdlp-backup-{os.getpid()}"
        if backup_dir.exists():
            shutil.rmtree(backup_dir, ignore_errors=True)

        if active_dir.exists():
            os.replace(active_dir, backup_dir)
        try:
            os.replace(staging_dir, active_dir)
            staging_dir = None
        except Exception:
            if backup_dir.exists() and not active_dir.exists():
                try:
                    os.replace(backup_dir, active_dir)
                except OSError:
                    pass
            raise

        log(f"yt-dlp Extractor updated to v{latest_version}.")
        return {
            "success": True,
            "updated": True,
            "latest_version": latest_version,
            "override_path": str(active_dir),
            "message": f"yt-dlp Extractor updated to v{latest_version}.",
        }
    except Exception as error:
        return {
            "success": False,
            "updated": False,
            "error": f"Could not install yt-dlp update: {error}",
        }
    finally:
        if tmp_wheel_path and tmp_wheel_path.exists():
            try:
                tmp_wheel_path.unlink()
            except OSError:
                pass
        if staging_dir and staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)
        if backup_dir and backup_dir.exists():
            shutil.rmtree(backup_dir, ignore_errors=True)
