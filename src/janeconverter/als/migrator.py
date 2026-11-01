"""
Migration and version retargeting engine for Ableton Live (.als) projects.
Enables cross-version interoperability across Live 12, 11, 10, and 9.
"""

from __future__ import annotations

import gzip
import io
import os
import shutil
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional, Tuple

from .models import TARGET_PROFILES, normalize_als_target_key
from .parser import parse_als


def migrate_als_bytes(data: bytes, target_version: str) -> Tuple[bytes, Dict[str, Any]]:
    """Migrate in-memory ALS project bytes to target Ableton Live version."""
    project = parse_als(data)

    target_key = normalize_als_target_key(target_version)
    profile = TARGET_PROFILES.get(target_key)
    if not profile:
        supported = ", ".join(f"Live {k}" for k in TARGET_PROFILES)
        raise ValueError(f"Unsupported target Ableton Live version '{target_version}'. Supported targets: {supported}.")

    # Parse and modify XML tree
    root = ET.fromstring(project.raw_xml)
    if root.tag != "Ableton":
        raise ValueError("Root element is not <Ableton>.")

    # Retarget root version attributes
    root.attrib["Creator"] = profile["creator"]
    root.attrib["MinorVersion"] = profile["minor"]
    root.attrib["SchemaChangeCount"] = profile["schema"]

    out_io = io.BytesIO()
    # Write standard XML declaration and formatted tree
    tree = ET.ElementTree(root)
    tree.write(out_io, encoding="utf-8", xml_declaration=True)
    xml_payload = out_io.getvalue()

    # Re-compress with gzip
    compressed_bytes = gzip.compress(xml_payload, compresslevel=6)

    summary = {
        "success": True,
        "sourceCreator": project.creator,
        "sourceVersion": project.minor_version,
        "sourceMajor": project.detected_major,
        "targetVersion": profile["minor"],
        "targetMajor": profile["major"],
        "targetProfile": target_key,
        "targetLabel": profile["label"],
        "outputSizeBytes": len(compressed_bytes),
        "tracksCount": project.tracks_count,
        "pluginsCount": project.plugins_count,
    }
    return compressed_bytes, summary


def migrate_als_file(
    source_path: str,
    target_version: str,
    output_path: Optional[str] = None,
    overwrite: bool = False,
) -> Dict[str, Any]:
    """Migrate an on-disk .als project file to target Ableton Live version."""
    if not os.path.isfile(source_path):
        raise FileNotFoundError(f"Source ALS file not found: {source_path}")

    with open(source_path, "rb") as f:
        data = f.read()

    migrated_bytes, summary = migrate_als_bytes(data, target_version)

    # Determine destination path
    target_key = normalize_als_target_key(target_version)
    if not output_path:
        base, ext = os.path.splitext(source_path)
        output_path = f"{base}_Live{target_key}{ext}"

    output_path = os.path.abspath(output_path)
    source_path = os.path.abspath(source_path)

    backup_path = None
    if output_path == source_path:
        if not overwrite:
            backup_path = f"{source_path}.backup"
            shutil.copy2(source_path, backup_path)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    tmp_output = f"{output_path}.tmp"
    with open(tmp_output, "wb") as f:
        f.write(migrated_bytes)

    os.replace(tmp_output, output_path)

    summary.update({
        "sourcePath": source_path,
        "outputPath": output_path,
        "backupPath": backup_path,
    })
    return summary
