"""Validate untrusted browser bytes before they enter the local library."""

import json
import math
import os
import subprocess

from PIL import Image

from .converter import get_ffmpeg_binary, get_ffprobe_binary


def validate_capture(path: str, kind: str) -> dict:
    if kind not in ("image", "audio", "video") or not os.path.isfile(path) or not os.path.getsize(path):
        raise ValueError("The capture is empty or has an unsupported media kind.")
    if kind == "image":
        with Image.open(path) as image:
            mime = Image.MIME.get(image.format, "")
            image.verify()
        with Image.open(path) as image:
            image.load()
            width, height = image.size
            if width < 1 or height < 1 or not mime.startswith("image/"):
                raise ValueError("The capture does not contain a readable image.")
        return {"mimeType": mime, "width": width, "height": height}
    options = {"capture_output": True, "timeout": 15, "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    probe = subprocess.run([
        get_ffprobe_binary(), "-v", "error", "-protocol_whitelist", "file,pipe",
        "-show_streams", "-show_format", "-of", "json", path,
    ], **options)
    if probe.returncode:
        raise ValueError("The capture does not contain readable media.")
    report = json.loads(probe.stdout)
    streams = [stream for stream in report.get("streams", []) if stream.get("codec_type") == kind
               and not stream.get("disposition", {}).get("attached_pic")]
    raw_duration = report.get("format", {}).get("duration")
    duration = None if raw_duration in (None, "", "N/A") else float(raw_duration)
    if not streams or (duration is not None and (not math.isfinite(duration) or duration <= 0)):
        raise ValueError("The capture has no playable stream or valid duration.")
    stream = streams[0]
    if kind == "video" and (stream.get("width", 0) <= 0 or stream.get("height", 0) <= 0):
        raise ValueError("The video has no readable dimensions.")
    decoded = subprocess.run([
        get_ffmpeg_binary(), "-v", "error", "-xerror", "-protocol_whitelist", "file,pipe",
        "-i", path, "-map", f"0:{'v' if kind == 'video' else 'a'}:0", "-t", "1",
        "-progress", "pipe:1", "-nostats", "-f", "null", "-",
    ], **options)
    if decoded.returncode:
        raise ValueError("The captured stream could not be decoded.")
    # MediaRecorder WebM commonly omits duration; decoded progress proves actual playback.
    progress = decoded.stdout.decode("utf-8", errors="replace")
    decoded_times = [int(line.split("=", 1)[1]) for line in progress.splitlines()
                     if line.startswith("out_time_us=") and line.split("=", 1)[1].isdigit()]
    if not decoded_times or max(decoded_times) <= 0:
        raise ValueError("The captured stream contains no playable frames or samples.")
    formats = report.get("format", {}).get("format_name", "").split(",")
    extension = "webm" if "webm" in formats else "mp4" if "mp4" in formats else formats[0]
    mime = {"mov": "mp4", "matroska": "x-matroska", "mp3": "mpeg"}.get(extension, extension)
    return {"mimeType": f"{kind}/{mime}", "duration": duration}
