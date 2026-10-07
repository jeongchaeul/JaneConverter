"""
Metadata inspector for FL Studio (.flp) projects.
Extracts project version, BPM, PPQ, title, channel count, and registration status.
"""

import os
import struct
from typing import Any, Dict, Optional
from .models import FLPProject
from .parser import parse_flp_file


def _clean_string(raw: bytes) -> str:
    """Decode raw bytes into a clean string, attempting UTF-16 LE, UTF-8, and Latin-1."""
    if not raw:
        return ""
    # Try UTF-16 LE first (FL Studio 12+ standard for unicode text)
    try:
        decoded = raw.decode("utf-16le").strip("\x00 \t\r\n")
        # Ensure it looks like readable text rather than misaligned ASCII
        if decoded and all(ord(c) >= 32 or c in "\n\r\t" for c in decoded):
            return decoded
    except UnicodeDecodeError:
        pass

    # Try UTF-8
    try:
        decoded = raw.decode("utf-8").strip("\x00 \t\r\n")
        if decoded:
            return decoded
    except UnicodeDecodeError:
        pass

    # Fallback to Latin-1
    return raw.decode("latin-1", errors="replace").strip("\x00 \t\r\n")


def inspect_flp(project: FLPProject, file_path: Optional[str] = None) -> Dict[str, Any]:
    """Inspect an FLPProject and return structured project metadata."""
    version_str = "Unknown"
    title_str = ""
    registration_name = ""
    registered = True
    bpm = 140.0

    build_num: Optional[int] = None

    # Search events
    for ev in project.events:
        # Event 199 (0xC7): Version string (ASCII)
        if ev.event_id == 199 and ev.data:
            try:
                raw_ver = ev.data.decode("ascii", errors="ignore").strip("\x00 \t\r\n")
                if raw_ver:
                    version_str = raw_ver
            except Exception:
                pass

        # Event 159 (0x9F): Build number (DWORD)
        elif ev.event_id == 159 and len(ev.data) >= 4:
            try:
                b_val = struct.unpack("<I", ev.data[:4])[0]
                if 0 < b_val < 100000:
                    build_num = b_val
            except Exception:
                pass

        # Event 194 (0xC2): Project title
        elif ev.event_id == 194 and ev.data and not title_str:
            clean = _clean_string(ev.data)
            if clean:
                title_str = clean

        # Event 68 (0x44): Main Tempo
        elif ev.event_id == 68 and len(ev.data) >= 2:
            raw_tempo = struct.unpack("<H", ev.data[:2])[0]
            if raw_tempo > 0:
                if raw_tempo >= 1000:
                    bpm = round(raw_tempo / 10.0, 2)
                else:
                    bpm = float(raw_tempo)

        # Event 28 (0x1C): Registered flag (1 byte)
        elif ev.event_id == 28 and len(ev.data) >= 1:
            registered = ev.data[0] != 0

        # Event 200 (0xC8): Registered user name
        elif ev.event_id == 200 and ev.data:
            clean = _clean_string(ev.data)
            if clean:
                registration_name = clean

    # Determine major version integer and fallback build
    major_version = 0
    if version_str != "Unknown":
        parts = version_str.split(".")
        if parts and parts[0].isdigit():
            major_version = int(parts[0])
        if build_num is None and len(parts) >= 4 and parts[3].isdigit():
            build_num = int(parts[3])

    file_size = 0
    file_name = ""
    if file_path:
        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
        file_name = os.path.basename(file_path)

    return {
        "filePath": file_path or "",
        "fileName": file_name,
        "fileSize": file_size,
        "version": version_str,
        "majorVersion": major_version,
        "build": build_num or 0,
        "title": title_str or (os.path.splitext(file_name)[0] if file_name else "Untitled Project"),
        "bpm": bpm,
        "ppq": project.ppq,
        "channels": project.channels,
        "registered": registered,
        "registrationName": registration_name,
        "eventsCount": len(project.events),
    }


def inspect_flp_file(path: str) -> Dict[str, Any]:
    """Parse and inspect an FLP project from file path."""
    project = parse_flp_file(path)
    return inspect_flp(project, file_path=path)
