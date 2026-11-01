"""
Ableton Live (.als) Project parser, inspector, and version migrator.
Enables cross-version interoperability across Live 12, 11, 10, and 9.

DAW UTILITIES STATUS: EXPERIMENTAL & SUBJECT TO MAINTAINER DECISIONS.
These tools are personal creator studio utilities engineered for Jane Cerys's audio workstation.
Their scope, format coverage, and internal heuristics are subject strictly to maintainer discretion.
"""

from .models import (
    AlsProject,
    KNOWN_LIVE_VERSIONS,
    TARGET_PROFILES,
    normalize_als_target_key,
)
from .parser import parse_als, parse_als_file, MAX_ALS_FILE_SIZE, AlsParseError
from .inspector import inspect_als, inspect_als_file
from .migrator import migrate_als_bytes, migrate_als_file

__all__ = [
    "AlsProject",
    "KNOWN_LIVE_VERSIONS",
    "TARGET_PROFILES",
    "normalize_als_target_key",
    "parse_als",
    "parse_als_file",
    "MAX_ALS_FILE_SIZE",
    "AlsParseError",
    "inspect_als",
    "inspect_als_file",
    "migrate_als_bytes",
    "migrate_als_file",
]
