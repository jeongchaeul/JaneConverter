"""
Parser for Ableton Live (.als) gzip-compressed XML projects.
"""

from __future__ import annotations

import gzip
import io
import os
import re
import xml.etree.ElementTree as ET
from typing import Optional

from .models import AlsProject

MAX_ALS_FILE_SIZE = 256 * 1024 * 1024  # 256 MB safety ceiling


class AlsParseError(ValueError):
    """Raised when an ALS file cannot be decompressed or parsed."""
    pass


def _reject_unsafe_xml(xml_bytes: bytes) -> None:
    """Reject XML DTDs and entity declarations across UTF-8 and UTF-16 encodings."""
    normalized = xml_bytes.replace(b"\x00", b"").lower()
    if b"<!doctype" in normalized or b"<!entity" in normalized:
        raise AlsParseError("Unsafe XML DOCTYPE or ENTITY declarations are not permitted in ALS files.")


def parse_als(data: bytes, file_path: Optional[str] = None) -> AlsProject:
    """Parse raw bytes of an Ableton Live (.als) project into an AlsProject."""
    if not data:
        raise AlsParseError("ALS file is empty.")
    if len(data) > MAX_ALS_FILE_SIZE:
        raise AlsParseError(f"ALS data size ({len(data)} bytes) exceeds maximum ceiling ({MAX_ALS_FILE_SIZE} bytes).")

    # Decompress gzip stream with bounded ceiling to prevent decompression bombs
    try:
        if data[:2] == b"\x1f\x8b":
            with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as gz_file:
                xml_bytes = gz_file.read(MAX_ALS_FILE_SIZE + 1)
        elif b"<Ableton" in data[:200] or b"<\x00A\x00b\x00l\x00e\x00t\x00o\x00n\x00" in data[:400]:
            # Plain uncompressed XML (rare, but supported by Ableton in some dev/test builds)
            xml_bytes = data
        else:
            raise AlsParseError("File is not a valid gzip-compressed Ableton Live project.")
    except AlsParseError:
        raise
    except Exception as exc:
        raise AlsParseError(f"Could not decompress ALS project: {exc}") from exc

    if len(xml_bytes) > MAX_ALS_FILE_SIZE:
        raise AlsParseError(
            f"Decompressed ALS XML size ({len(xml_bytes)} bytes) exceeds maximum ceiling ({MAX_ALS_FILE_SIZE} bytes)."
        )
    _reject_unsafe_xml(xml_bytes)

    try:
        if xml_bytes.startswith((b"\xff\xfe", b"\xfe\xff")) or b"\x00" in xml_bytes[:100]:
            xml_text = xml_bytes.decode("utf-16", errors="replace")
        else:
            xml_text = xml_bytes.decode("utf-8")
    except UnicodeDecodeError:
        xml_text = xml_bytes.decode("latin-1", errors="replace")

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise AlsParseError(f"Corrupted XML structure in ALS project: {exc}") from exc

    if root.tag != "Ableton":
        raise AlsParseError(f"Expected root tag <Ableton>, got <{root.tag}>.")

    creator = root.attrib.get("Creator", "Unknown")
    major_ver = root.attrib.get("MajorVersion", "5")
    minor_ver = root.attrib.get("MinorVersion", "Unknown")
    schema_count = root.attrib.get("SchemaChangeCount", "0")
    revision = root.attrib.get("Revision", "")

    # Infer detected major from creator or minor_version
    detected_major = 0
    m_creator = re.search(r"Live\s+(\d+)", creator, re.I)
    if m_creator:
        detected_major = int(m_creator.group(1))
    elif minor_ver:
        m_minor = re.match(r"^(\d+)\.", minor_ver)
        if m_minor:
            detected_major = int(m_minor.group(1))

    # BPM extraction
    bpm = 120.0
    tempo_elem = root.find(".//Tempo//Manual")
    if tempo_elem is not None and "Value" in tempo_elem.attrib:
        try:
            bpm = round(float(tempo_elem.attrib["Value"]), 2)
        except (ValueError, TypeError):
            pass

    # Tracks extraction
    track_names = []
    tracks_elem = root.find(".//Tracks")
    if tracks_elem is not None:
        for track in tracks_elem:
            tag = track.tag.lower()
            if "track" in tag:
                eff_name = track.find(".//Name/EffectiveName")
                user_name = track.find(".//Name/UserName")
                name_val = ""
                if eff_name is not None and eff_name.attrib.get("Value"):
                    name_val = eff_name.attrib["Value"]
                elif user_name is not None and user_name.attrib.get("Value"):
                    name_val = user_name.attrib["Value"]
                if name_val:
                    track_names.append(name_val)
                else:
                    track_names.append(track.tag)

    # Plugins extraction
    plugin_names = set()
    for plug in root.findall(".//PlugName"):
        val = plug.attrib.get("Value")
        if val:
            plugin_names.add(val)
    for plug in root.findall(".//PresetName"):
        val = plug.attrib.get("Value")
        if val and val not in plugin_names:
            plugin_names.add(val)

    sorted_plugins = sorted(list(plugin_names))

    return AlsProject(
        file_path=file_path,
        file_size=len(data),
        creator=creator,
        major_version=major_ver,
        minor_version=minor_ver,
        schema_change_count=schema_count,
        revision=revision,
        detected_major=detected_major,
        bpm=bpm,
        tracks_count=len(track_names),
        track_names=track_names,
        plugins_count=len(sorted_plugins),
        plugin_names=sorted_plugins,
        raw_xml=xml_text,
    )


def parse_als_file(path: str) -> AlsProject:
    """Read and parse an Ableton Live (.als) project from disk."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"ALS file not found: {path}")

    size = os.path.getsize(path)
    if size > MAX_ALS_FILE_SIZE:
        raise AlsParseError(f"ALS file size ({size} bytes) exceeds maximum ceiling ({MAX_ALS_FILE_SIZE} bytes).")

    with open(path, "rb") as f:
        data = f.read()

    return parse_als(data, file_path=os.path.abspath(path))
