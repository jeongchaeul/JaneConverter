"""
Data models and version definitions for Ableton Live (.als) project files.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


KNOWN_LIVE_VERSIONS: Dict[int, Dict[str, Any]] = {
    12: {
        "major": 12,
        "minor": "12.0_12049",
        "schema": "3",
        "creator": "Ableton Live 12.0.1",
        "label": "Ableton Live 12",
    },
    11: {
        "major": 11,
        "minor": "11.0_11300",
        "schema": "3",
        "creator": "Ableton Live 11.3.10",
        "label": "Ableton Live 11 (11.3.10)",
    },
    10: {
        "major": 10,
        "minor": "10.0_10000",
        "schema": "2",
        "creator": "Ableton Live 10.1.43",
        "label": "Ableton Live 10 (10.1.43)",
    },
    9: {
        "major": 9,
        "minor": "9.0_9000",
        "schema": "1",
        "creator": "Ableton Live 9.7.7",
        "label": "Ableton Live 9 (9.7.7)",
    },
}

TARGET_PROFILES: Dict[str, Dict[str, Any]] = {
    "11": {
        "major": 11,
        "minor": "11.0_11300",
        "schema": "3",
        "creator": "Ableton Live 11.3.10",
        "label": "Ableton Live 11 (11.3.10)",
    },
    "10": {
        "major": 10,
        "minor": "10.0_10000",
        "schema": "2",
        "creator": "Ableton Live 10.1.43",
        "label": "Ableton Live 10 (10.1.43)",
    },
    "9": {
        "major": 9,
        "minor": "9.0_9000",
        "schema": "1",
        "creator": "Ableton Live 9.7.7",
        "label": "Ableton Live 9 (9.7.7)",
    },
}


def normalize_als_target_key(target: str) -> str:
    """Normalize target string (e.g. '11', 'live 11', 'ableton 11' -> '11')."""
    clean = target.lower().replace("ableton live", "").replace("ableton", "").replace("live", "").strip()
    if clean.startswith("11"):
        return "11"
    if clean.startswith("10"):
        return "10"
    if clean.startswith("9"):
        return "9"
    return clean or "11"


@dataclass
class AlsProject:
    """Represents a parsed Ableton Live (.als) project document."""
    file_path: Optional[str] = None
    file_size: int = 0
    creator: str = "Unknown"
    major_version: str = "5"
    minor_version: str = "Unknown"
    schema_change_count: str = "0"
    revision: str = ""
    detected_major: int = 0
    bpm: float = 120.0
    tracks_count: int = 0
    track_names: List[str] = field(default_factory=list)
    plugins_count: int = 0
    plugin_names: List[str] = field(default_factory=list)
    raw_xml: str = ""
