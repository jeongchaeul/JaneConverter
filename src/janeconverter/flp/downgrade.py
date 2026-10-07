"""
Downgrade engine for FL Studio (.flp) projects.
Rewrites version signatures, adjusts version-expanded binary structs, and repacks valid FLP files.
"""

import os
from typing import Any, Dict, Optional
from .models import FLPEvent, FLPProject
from .parser import parse_flp_file
from .inspector import inspect_flp


TARGET_PROFILES: Dict[str, Dict[str, Any]] = {
    "24": {
        "major": 24,
        "version_string": "24.1.2.4398\x00",
        "label": "FL Studio 24 (24.1.2)",
    },
    "21": {
        "major": 21,
        "version_string": "21.2.3.3586\x00",
        "label": "FL Studio 21 (21.2.3)",
    },
    "20": {
        "major": 20,
        "version_string": "20.9.2.2963\x00",
        "label": "FL Studio 20 (20.9.2)",
    },
    "12": {
        "major": 12,
        "version_string": "12.5.1.165\x00",
        "label": "FL Studio 12 (12.5.1)",
    },
}


def normalize_target_key(target: str) -> str:
    """Normalize target string (e.g., '24', 'fl24', '24.1' -> '24')."""
    clean = target.lower().replace("fl", "").replace("studio", "").strip()
    if clean.startswith("24"):
        return "24"
    if clean.startswith("21"):
        return "21"
    if clean.startswith("20"):
        return "20"
    if clean.startswith("12"):
        return "12"
    # Fallback to direct match or default to 21
    return clean if clean in TARGET_PROFILES else "21"


def downgrade_flp(
    project: FLPProject,
    target_version_key: str = "24",
    source_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Downgrade an FLPProject in-memory to target version profile.
    Returns (new_project, summary_dict).
    """
    key = normalize_target_key(target_version_key)
    profile = TARGET_PROFILES.get(key, TARGET_PROFILES["21"])
    target_major = profile["major"]
    target_ver_bytes = profile["version_string"].encode("ascii")

    source_info = inspect_flp(project, file_path=source_path)
    source_version = source_info["version"]
    source_major = source_info["majorVersion"]

    version_event_found = False
    records_adjusted = 0
    new_events = []

    for ev in project.events:
        # Event 199 (0xC7): Version string
        if ev.event_id == 199:
            new_events.append(FLPEvent(event_id=199, data=target_ver_bytes))
            version_event_found = True

        # Event 212 (0xD4): Playlist clip arrangement records
        # FL Studio 25 expanded these records to 80 bytes; FL 21-24 expect 60 bytes.
        elif ev.event_id == 212:
            if source_major >= 25 and target_major <= 24 and len(ev.data) == 80:
                # Truncate the trailing 20-byte modern extension
                new_events.append(FLPEvent(event_id=212, data=ev.data[:60]))
                records_adjusted += 1
            else:
                new_events.append(ev)

        else:
            new_events.append(ev)

    # If version event wasn't present, insert at beginning
    if not version_event_found:
        new_events.insert(0, FLPEvent(event_id=199, data=target_ver_bytes))

    new_project = FLPProject(
        format=project.format,
        channels=project.channels,
        ppq=project.ppq,
        events=new_events,
    )

    summary = {
        "success": True,
        "sourceVersion": source_version,
        "sourceMajor": source_major,
        "targetVersion": profile["version_string"].rstrip("\x00"),
        "targetProfile": key,
        "targetLabel": profile["label"],
        "recordsAdjusted": records_adjusted,
        "eventsCount": len(new_events),
    }

    return {
        "project": new_project,
        "summary": summary,
    }


def downgrade_flp_file(
    input_path: str,
    target_version_key: str = "24",
    output_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Read an FLP file, downgrade it to target version, and write to output file."""
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input FLP file not found: {input_path}")

    project = parse_flp_file(input_path)
    result = downgrade_flp(project, target_version_key=target_version_key, source_path=input_path)

    new_project: FLPProject = result["project"]
    summary: Dict[str, Any] = result["summary"]

    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_downgraded_FL{summary['targetProfile']}{ext}"

    # Ensure output directory exists
    out_dir = os.path.dirname(os.path.abspath(output_path))
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    out_bytes = new_project.to_bytes()
    with open(output_path, "wb") as f:
        f.write(out_bytes)

    summary["sourcePath"] = input_path
    summary["outputPath"] = output_path
    summary["outputSizeBytes"] = len(out_bytes)

    return summary
