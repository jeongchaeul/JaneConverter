"""
Binary resolution utilities for JaneConverter.
Locates FFmpeg, FFprobe, and JavaScript runtimes (Node, Deno, Bun).
"""

from __future__ import annotations

import functools
import os
from pathlib import Path
import shutil
from typing import Optional

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
_source_root = Path(__file__).resolve().parents[2]
PROJECT_ROOT = str(
    _source_root
    if (_source_root / "pyproject.toml").is_file()
    else Path(__file__).resolve().parents[1]
)

@functools.lru_cache(maxsize=1)
def get_ffmpeg_binary() -> str:
    """
    Finds FFmpeg executable in local application root, bin folder, or system PATH.
    """
    exe_name = "ffmpeg" + (".exe" if os.name == "nt" else "")
    candidates = [
        os.path.join(PROJECT_ROOT, exe_name),
        os.path.join(PROJECT_ROOT, "bin", exe_name),
        os.path.join(ENGINE_DIR, exe_name),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return os.path.abspath(c)

    which_path = shutil.which("ffmpeg")
    if which_path:
        return which_path

    return "ffmpeg"

@functools.lru_cache(maxsize=1)
def get_ffprobe_binary() -> str:
    """
    Finds FFprobe next to the selected FFmpeg binary or on system PATH.
    """
    ffmpeg_bin = get_ffmpeg_binary()
    if ffmpeg_bin and os.path.isabs(ffmpeg_bin):
        sibling = os.path.join(
            os.path.dirname(ffmpeg_bin),
            "ffprobe" + (".exe" if os.name == "nt" else "")
        )
        if os.path.isfile(sibling):
            return os.path.abspath(sibling)
    which_path = shutil.which("ffprobe")
    if which_path:
        return which_path
    return "ffprobe"


@functools.lru_cache(maxsize=1)
def get_node_binary() -> Optional[str]:
    """Finds Node.js executable next to FFmpeg, in application root, or system PATH."""
    ffmpeg_bin = get_ffmpeg_binary()
    if ffmpeg_bin and os.path.isfile(ffmpeg_bin):
        sibling = os.path.join(
            os.path.dirname(os.path.abspath(ffmpeg_bin)),
            "node" + (".exe" if os.name == "nt" else ""),
        )
        if os.path.isfile(sibling) and os.access(sibling, os.X_OK):
            return os.path.abspath(sibling)

    candidate = os.path.join(PROJECT_ROOT, "bin", "node" + (".exe" if os.name == "nt" else ""))
    if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
        return os.path.abspath(candidate)

    which_path = shutil.which("node")
    if which_path:
        return which_path

    if os.name == "nt":
        candidates = [
            r"D:\node.js\Node.js\node.exe",
            os.path.expandvars(r"%ProgramFiles%\nodejs\node.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\node.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\node\node.exe"),
            os.path.expandvars(r"%APPDATA%\npm\node.exe"),
            os.path.expandvars(r"%USERPROFILE%\AppData\Local\hermes\node\node.exe"),
            r"C:\nodejs\node.exe",
            r"D:\nodejs\node.exe",
        ]
        for c in candidates:
            if os.path.isfile(c) and os.access(c, os.X_OK):
                return os.path.abspath(c)
    else:
        home = os.path.expanduser("~")
        posix_candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
            "/opt/local/bin/node",
            os.path.join(home, ".nvm/current/bin/node"),
            os.path.join(home, ".volta/bin/node"),
            os.path.join(home, ".fnm/current/bin/node"),
            os.path.join(home, ".asdf/shims/node"),
        ]
        nvm_dir = os.path.join(home, ".nvm", "versions", "node")
        if os.path.isdir(nvm_dir):
            try:
                for ver in sorted(os.listdir(nvm_dir), reverse=True):
                    posix_candidates.append(os.path.join(nvm_dir, ver, "bin", "node"))
            except OSError:
                pass
        for c in posix_candidates:
            if os.path.isfile(c) and os.access(c, os.X_OK):
                return os.path.abspath(c)

    return None


def get_js_runtimes_config() -> dict:
    """Detect an available JavaScript runtime (Node, Deno, Bun) for yt-dlp EJS challenges."""
    node_bin = get_node_binary()
    if node_bin:
        return {"node": {"path": node_bin}}
    home = os.path.expanduser("~")
    for name, extra_paths in (
        ("deno", ["/opt/homebrew/bin/deno", "/usr/local/bin/deno", os.path.join(home, ".deno/bin/deno")]),
        ("bun", ["/opt/homebrew/bin/bun", "/usr/local/bin/bun", os.path.join(home, ".bun/bin/bun")]),
    ):
        w = shutil.which(name)
        if w:
            return {name: {"path": w}}
        for p in extra_paths:
            if os.path.isfile(p) and os.access(p, os.X_OK):
                return {name: {"path": os.path.abspath(p)}}
    return {"node": {"path": None}}

