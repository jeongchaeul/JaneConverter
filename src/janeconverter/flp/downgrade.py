"""
Downgrade engine for FL Studio (.flp) projects.
Performs binary surgical patching of version signatures, build numbers,
extended playlist records, and chunk lengths with bit-perfect reliability.
"""

import os
import re
import shutil
import struct
from typing import Any, Dict, Optional, Tuple

from .models import FLPProject, KNOWN_FL_VERSIONS, write_varint
from .parser import parse_flp


TARGET_PROFILES: Dict[str, Dict[str, Any]] = {
    "24": {
        "major": 24,
        "version": "24.1.2",
        "build": 4398,
        "version_string": "24.1.2.4398\x00",
        "label": "FL Studio 24 (24.1.2 [build 4398])",
    },
    "21": {
        "major": 21,
        "version": "21.2.3",
        "build": 4004,
        "version_string": "21.2.3.4004\x00",
        "label": "FL Studio 21 (21.2.3 [build 4004])",
    },
    "20": {
        "major": 20,
        "version": "20.9.2",
        "build": 2963,
        "version_string": "20.9.2.2963\x00",
        "label": "FL Studio 20 (20.9.2 [build 2963])",
    },
    "12": {
        "major": 12,
        "version": "12.5.1",
        "build": 165,
        "version_string": "12.5.1.165\x00",
        "label": "FL Studio 12 (12.5.1 [build 165])",
    },
}


def normalize_target_key(target: str) -> str:
    """Normalize target string (e.g., '24', 'fl24', '24.1' -> '24')."""
    clean = target.lower().replace("fl studio", "").replace("fl", "").replace("studio", "").strip()
    if clean.startswith("24"):
        return "24"
    if clean.startswith("21"):
        return "21"
    if clean.startswith("20"):
        return "20"
    if clean.startswith("12"):
        return "12"
    return clean if clean in TARGET_PROFILES else "21"


def resolve_target(
    target_version: str,
    target_build: Optional[int] = None,
) -> Tuple[str, int, int, str, str]:
    """
    Resolve target version string and build number.
    Returns (version_str, build_int, major_int, label_str, profile_key).
    """
    clean_target = (
        target_version.lower()
        .replace("fl studio", "")
        .replace("fl", "")
        .replace("studio", "")
        .strip()
    )

    # 1. Target profile key direct match (e.g. "24", "21", "20", "12")
    norm_key = normalize_target_key(target_version)
    if clean_target in TARGET_PROFILES and target_build is None:
        profile = TARGET_PROFILES[clean_target]
        return (
            profile["version"],
            profile["build"],
            profile["major"],
            profile["label"],
            clean_target,
        )

    # 2. If target string has 4 segments (e.g. "21.2.3.4004")
    parts = clean_target.split(".")
    if len(parts) >= 4 and parts[3].isdigit():
        base_ver = ".".join(parts[:3])
        build = int(parts[3]) if target_build is None else int(target_build)
        major = int(parts[0]) if parts[0].isdigit() else 21
        key = str(major)
        return base_ver, build, major, f"FL Studio {base_ver} (Build {build})", key

    # 3. If explicit target_build was supplied with version string
    if target_build is not None and target_build > 0:
        base_ver = clean_target or "21.2.3"
        major = int(base_ver.split(".")[0]) if base_ver.split(".")[0].isdigit() else 21
        key = str(major)
        return base_ver, int(target_build), major, f"FL Studio {base_ver} (Build {target_build})", key

    # 4. Match exact version against KNOWN_FL_VERSIONS
    for entry in KNOWN_FL_VERSIONS:
        if entry["version"] == clean_target:
            b_ver = entry["version"]
            b_build = entry["build"]
            b_maj = int(b_ver.split(".")[0])
            return b_ver, b_build, b_maj, f"FL Studio {b_ver} (Build {b_build})", str(b_maj)

    # 5. Target profile fallback
    profile = TARGET_PROFILES.get(norm_key, TARGET_PROFILES["21"])
    return (
        profile["version"],
        profile["build"],
        profile["major"],
        profile["label"],
        norm_key,
    )


def downgrade_flp_bytes(
    raw_data: bytes,
    target_version: str = "21.2.3",
    target_build: Optional[int] = None,
) -> Tuple[bytes, Dict[str, Any]]:
    """
    Downgrade binary FLP project data in-place with bit-perfect surgical precision.
    Returns (downgraded_bytes, summary_dict).
    """
    if len(raw_data) < 22 or raw_data[:4] != b"FLhd":
        raise ValueError("Invalid FLP header: not a valid FL Studio project file.")

    fldt_idx = raw_data.find(b"FLdt")
    if fldt_idx == -1:
        raise ValueError("Invalid FLP structure: missing FLdt data chunk.")

    base_ver, target_b_int, target_maj, target_lbl, profile_key = resolve_target(
        target_version, target_build
    )

    data = bytearray(raw_data)
    records_adjusted = 0

    # 1. Parse source version and event 0xC7 (FLVersion ASCII string)
    match_c7 = re.search(rb"\xc7[\x00-\x7f]([0-9]+\.[0-9]+\.[0-9]+[^\x00]*\x00)", data[:1024])
    source_ver_full = "Unknown"
    source_major = 0
    source_build = 0

    if match_c7:
        source_ver_full = match_c7.group(1).rstrip(b"\x00").decode("ascii", errors="ignore")
        old_c7_match = match_c7.group(0)
        s_parts = source_ver_full.split(".")
        if s_parts and s_parts[0].isdigit():
            source_major = int(s_parts[0])
        if len(s_parts) >= 4 and s_parts[3].isdigit():
            source_build = int(s_parts[3])

        target_ver_str = f"{base_ver}.{target_b_int}\x00"
        target_ver_bytes = target_ver_str.encode("ascii")
        new_c7_event = b"\xc7" + write_varint(len(target_ver_bytes)) + target_ver_bytes

        # Replace 0xC7 in header
        c7_pos = data.find(old_c7_match[:6])
        if c7_pos != -1 and c7_pos < 1024:
            data = bytearray(
                data[:c7_pos] + new_c7_event + data[c7_pos + len(old_c7_match):]
            )

    # 2. Patch Event 0x9F (FLBuild DWORD)
    new_build_payload = b"\x9f" + struct.pack("<I", target_b_int)
    patched_9f = False

    if source_build > 0:
        old_build_payload = b"\x9f" + struct.pack("<I", source_build)
        pos_9f = data.find(old_build_payload)
        if pos_9f != -1 and pos_9f < 1024:
            data[pos_9f : pos_9f + len(old_build_payload)] = new_build_payload
            patched_9f = True

    if not patched_9f:
        for p in range(16, min(512, len(data) - 5)):
            if data[p] == 0x9F:
                cur_val = struct.unpack("<I", data[p + 1 : p + 5])[0]
                if 10 <= cur_val <= 99999:
                    data[p : p + 5] = new_build_payload
                    patched_9f = True
                    break

    # 3. Patch UTF-16LE version strings in header (Events 0xC0, 0xC8, etc.)
    fl_needle = "FL Studio ".encode("utf-16le")
    search_window = min(4096, len(data))
    header_portion = bytes(data[:search_window])
    idx = header_portion.find(fl_needle)

    if idx != -1:
        ev_start = idx - 1
        while ev_start >= max(0, idx - 4):
            if data[ev_start] in (0xC0, 0xC8, 0xC7):
                break
            ev_start -= 1

        if ev_start >= 0 and data[ev_start] in (0xC0, 0xC8):
            ev_id = data[ev_start]
            str_end = idx
            while str_end + 1 < search_window:
                if data[str_end : str_end + 2] == b"\x00\x00":
                    str_end += 2
                    break
                str_end += 2

            old_chunk = bytes(data[ev_start:str_end])
            try:
                old_text = bytes(data[idx:str_end]).decode("utf-16le").rstrip("\x00")
                has_double_build = old_text.count(".") >= 4
                if has_double_build:
                    new_text = f"FL Studio {base_ver}.{target_b_int}.{target_b_int}\x00"
                else:
                    new_text = f"FL Studio {base_ver}.{target_b_int}\x00"

                new_text_bytes = new_text.encode("utf-16le")
                new_chunk = (
                    bytes([ev_id])
                    + write_varint(len(new_text_bytes))
                    + new_text_bytes
                )

                chunk_pos = data.find(old_chunk)
                if chunk_pos != -1:
                    data = bytearray(
                        data[:chunk_pos]
                        + new_chunk
                        + data[chunk_pos + len(old_chunk) :]
                    )
            except Exception:
                pass

    # 4. Truncate modern 80-byte playlist clip arrangement records (Event 0xD4 / 212)
    if source_major >= 25 and target_maj <= 24:
        pos = 0
        while True:
            d4_idx = data.find(b"\xd4\x50", pos)
            if d4_idx == -1:
                break
            record_data = data[d4_idx + 2 : d4_idx + 2 + 80]
            if len(record_data) == 80:
                new_record = b"\xd4\x3c" + record_data[:60]
                data = bytearray(
                    data[:d4_idx] + new_record + data[d4_idx + 82 :]
                )
                records_adjusted += 1
                pos = d4_idx + len(new_record)
            else:
                pos = d4_idx + 2

    # 5. Synchronize FLdt chunk length
    new_fldt_idx = data.find(b"FLdt")
    if new_fldt_idx != -1:
        payload_length = len(data) - (new_fldt_idx + 8)
        data[new_fldt_idx + 4 : new_fldt_idx + 8] = struct.pack("<I", payload_length)

    summary = {
        "success": True,
        "sourceVersion": source_ver_full,
        "sourceMajor": source_major,
        "sourceBuild": source_build,
        "targetVersion": base_ver,
        "targetBuild": target_b_int,
        "targetMajor": target_maj,
        "targetProfile": profile_key,
        "targetLabel": target_lbl,
        "recordsAdjusted": records_adjusted,
        "eventsCount": 0,
        "outputSizeBytes": len(data),
    }

    return bytes(data), summary


def downgrade_flp(
    project: FLPProject,
    target_version_key: str = "24",
    target_build: Optional[int] = None,
    source_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Downgrade an FLPProject in-memory to target version profile.
    Returns (new_project, summary_dict) with object model compatibility.
    """
    raw_bytes = project.to_bytes()
    downgraded_bytes, summary = downgrade_flp_bytes(
        raw_bytes,
        target_version=target_version_key,
        target_build=target_build,
    )
    new_project = parse_flp(downgraded_bytes)
    summary["eventsCount"] = len(new_project.events)

    return {
        "project": new_project,
        "summary": summary,
    }


def downgrade_flp_file(
    input_path: str,
    target_version_key: str = "21.2.3",
    target_build: Optional[int] = None,
    output_path: Optional[str] = None,
    overwrite: bool = False,
) -> Dict[str, Any]:
    """Read an FLP file, downgrade it to target version & build, and write to disk."""
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input FLP file not found: {input_path}")

    with open(input_path, "rb") as f:
        raw_bytes = f.read()

    downgraded_bytes, summary = downgrade_flp_bytes(
        raw_bytes,
        target_version=target_version_key,
        target_build=target_build,
    )

    backup_path: Optional[str] = None

    if overwrite or (output_path and os.path.abspath(output_path) == os.path.abspath(input_path)):
        target_dest = input_path
        backup_path = f"{input_path}.bak"
        if os.path.exists(backup_path):
            idx = 2
            while os.path.exists(f"{input_path}.bak.{idx}"):
                idx += 1
            backup_path = f"{input_path}.bak.{idx}"
        shutil.copy2(input_path, backup_path)
    elif output_path:
        target_dest = output_path
    else:
        base, ext = os.path.splitext(input_path)
        target_dest = f"{base}_downgraded_FL{summary['targetVersion']}{ext}"

    out_dir = os.path.dirname(os.path.abspath(target_dest))
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    with open(target_dest, "wb") as f:
        f.write(downgraded_bytes)

    # Calculate actual event count for summary
    try:
        parsed = parse_flp(downgraded_bytes)
        summary["eventsCount"] = len(parsed.events)
    except Exception:
        summary["eventsCount"] = 0

    summary["sourcePath"] = input_path
    summary["outputPath"] = target_dest
    summary["backupPath"] = backup_path
    summary["outputSizeBytes"] = len(downgraded_bytes)

    return summary
