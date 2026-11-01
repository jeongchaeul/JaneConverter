"""
Metadata inspector for Ableton Live (.als) project files.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional
from .models import AlsProject
from .parser import parse_als_file


def inspect_als(project: AlsProject, file_path: Optional[str] = None) -> Dict[str, Any]:
    """Inspect an AlsProject and return structured project metadata."""
    effective_path = file_path or project.file_path or ""
    file_name = os.path.basename(effective_path) if effective_path else "Untitled Project.als"
    file_size = project.file_size
    if effective_path and os.path.isfile(effective_path):
        file_size = os.path.getsize(effective_path)

    project_title = os.path.splitext(file_name)[0] if file_name else "Untitled Project"

    return {
        "filePath": effective_path,
        "fileName": file_name,
        "fileSize": file_size,
        "creator": project.creator,
        "version": project.minor_version,
        "majorVersion": project.detected_major,
        "schemaChangeCount": project.schema_change_count,
        "revision": project.revision,
        "title": project_title,
        "bpm": project.bpm,
        "tracksCount": project.tracks_count,
        "tracks": project.track_names,
        "pluginsCount": project.plugins_count,
        "plugins": project.plugin_names,
    }


def inspect_als_file(path: str) -> Dict[str, Any]:
    """Parse and inspect an Ableton Live project from disk."""
    project = parse_als_file(path)
    return inspect_als(project, file_path=path)
