"""Validate untrusted browser bytes before they enter the local library."""

import json
import math
import os
import subprocess

from .binaries import get_ffmpeg_binary, get_ffprobe_binary


def validate_capture(path: str, kind: str) -> dict:
    if kind not in ("image", "audio", "video", "stream", "model") or not os.path.isfile(path) or not os.path.getsize(path):
        raise ValueError("The capture is empty or has an unsupported media kind.")
    if kind == "image":
        from PIL import Image
        with Image.open(path) as image:
            mime = Image.MIME.get(image.format, "")
            image.verify()
        with Image.open(path) as image:
            image.load()
            width, height = image.size
            if width < 1 or height < 1 or not mime.startswith("image/"):
                raise ValueError("The capture does not contain a readable image.")
        return {"mimeType": mime, "width": width, "height": height}
    if kind == "stream":
        with open(path, "rb") as f:
            head = f.read(4096)
        text_head = head.decode("utf-8", errors="ignore").strip()
        if text_head.startswith("#EXTM3U") or "#EXT-X-STREAM-INF" in text_head or "#EXT-X-TARGETDURATION" in text_head:
            return {"mimeType": "application/vnd.apple.mpegurl"}
        if "<MPD" in text_head or "urn:mpeg:dash:schema:mpd" in text_head:
            return {"mimeType": "application/dash+xml"}
        if "#EXT" in text_head:
            return {"mimeType": "application/x-mpegurl"}
        raise ValueError("The capture does not contain a valid stream manifest.")
    if kind == "model":
        with open(path, "rb") as f:
            magic = f.read(4096)
        size = os.path.getsize(path)
        if magic.startswith(b"glTF") and len(magic) >= 12:
            return {"mimeType": "model/gltf-binary"}
        if magic.startswith(b"ply\n") or magic.startswith(b"ply\r\n"):
            return {"mimeType": "application/x-ply"}
        if b"Kaydara FBX" in magic:
            return {"mimeType": "application/octet-stream"}
        head_lower = magic.lstrip()[:64].lower()
        if head_lower.startswith((b"<!doctype", b"<html", b"<head", b"<script")):
            raise ValueError("The capture is HTML rather than a 3D model.")
        text_sample = magic.decode("utf-8", errors="ignore")
        if text_sample.lstrip().startswith("{") and '"asset"' in text_sample:
            return {"mimeType": "model/gltf+json"}
        if any(line.strip().startswith(("v ", "vn ", "vt ", "f ", "o ", "g ")) for line in text_sample.splitlines()[:16]):
            return {"mimeType": "model/obj"}
        if size >= 32 and size % 32 == 0:
            return {"mimeType": "application/x-gaussian-splat"}
        raise ValueError("The capture does not contain a recognized 3D model.")
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
    if kind == "video" and ((stream.get("width") or 0) <= 0 or (stream.get("height") or 0) <= 0):
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
