"""Build the companion extension from current source, never a stale archive."""
import argparse
import json
from pathlib import Path
import zipfile


def source_bytes(path: Path) -> bytes:
    # Text line endings must match on Windows and Unix checkouts.
    return path.read_bytes().replace(b"\r\n", b"\n")


def build(source: Path, output: Path) -> Path:
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    files = sorted([source / "manifest.json", source / "README.md", *source.glob("*.js"), *source.glob("*.html")])
    output.mkdir(parents=True, exist_ok=True)
    archive_path = output / f"JaneConverter-Browser-Bridge-{manifest['version']}.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            archive.writestr(file.name, source_bytes(file))
    with zipfile.ZipFile(archive_path) as archive:
        for file in files:
            if archive.read(file.name) != source_bytes(file):
                raise RuntimeError(f"Extension archive verification failed: {file.name}")
    return archive_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(build(Path(__file__).resolve().parent.parent / "browser-extension", args.output))
