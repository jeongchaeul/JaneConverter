"""Create the signed, multi-platform Tauri updater feed for a repository commit."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path


COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
VERSION_PATTERN = re.compile(r"^(\d+\.\d+\.\d+)\+build\.(\d+)\.g([0-9a-f]{40})$")


def read_signature(path: Path) -> str:
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"Required updater signature is missing or empty: {path.name}")
    signature = path.read_text(encoding="utf-8").strip()
    if not signature:
        raise ValueError(f"Required updater signature is empty: {path.name}")
    return signature


def platform_asset(
    artifacts: Path,
    repository: str,
    filename: str,
) -> dict[str, str]:
    artifact = artifacts / filename
    if not artifact.is_file() or artifact.stat().st_size == 0:
        raise ValueError(f"Required updater package is missing or empty: {filename}")
    signature = read_signature(artifacts / f"{filename}.sig")
    return {
        "signature": signature,
        "url": f"https://github.com/{repository}/releases/download/continuous/{filename}",
    }


def create_manifest(
    *, version: str, commit: str, repository: str, artifacts: Path
) -> dict[str, object]:
    if not COMMIT_PATTERN.fullmatch(commit):
        raise ValueError("The source commit must be a full 40-character lowercase SHA.")
    version_match = VERSION_PATTERN.fullmatch(version)
    if not version_match or version_match.group(3) != commit:
        raise ValueError("The updater version must encode its sequence and matching source commit.")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Repository must be written as owner/name.")

    platform_files = {
        "windows-x86_64": "JaneConverter-continuous-windows-x64-setup.exe",
        "linux-x86_64": "JaneConverter-continuous-linux-x86_64.AppImage",
        "darwin-aarch64": "JaneConverter-continuous-macos-arm64.app.tar.gz",
        "darwin-x86_64": "JaneConverter-continuous-macos-x86_64.app.tar.gz",
    }
    platforms = {
        target: platform_asset(artifacts, repository, filename)
        for target, filename in platform_files.items()
    }
    return {
        "version": version,
        "notes": f"JaneConverter repository build {commit[:7]}.",
        "pub_date": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "build_commit": commit,
        "bridge_protocol": 2,
        "catalog_schema": 1,
        "compatibility_notes": "Reload the Browser Bridge extension bundled with this application after updating.",
        "platforms": platforms,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = create_manifest(
        version=args.version,
        commit=args.commit,
        repository=args.repository,
        artifacts=args.artifacts_dir,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        raise SystemExit(f"Could not create signed updater manifest: {error}") from error
