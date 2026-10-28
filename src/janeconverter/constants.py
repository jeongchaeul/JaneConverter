"""
Constants, supported format definitions, and time-offset utilities for JaneConverter.
"""

from __future__ import annotations

import math
import re
from typing import Optional

# Industry standard EBU R128 loudness normalization targets
LOUDNORM_FILTER = "loudnorm=I=-14:TP=-1.5:LRA=11"

SUPPORTED_AUDIO_FORMATS = {
    "mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "aiff", "aif",
    "alac", "ac3", "mp2", "wma", "caf", "au",
}
SUPPORTED_VIDEO_FORMATS = {
    "mp4", "mkv", "webm", "av1", "mov", "gif", "avi", "flv", "m4v", "ts",
    "m2ts", "mpeg", "mpg", "vob", "3gp", "wmv", "asf",
}
SUPPORTED_IMAGE_FORMATS = {
    "jpg", "jpeg", "jfif", "png", "webp", "bmp", "tif", "tiff", "gif",
    "ico", "tga", "ppm", "pgm", "pbm",
}
OUTPUT_FILE_EXTENSIONS = {"alac": "m4a", "av1": "mkv"}

# Static image outputs are normalized through Pillow so output support is not
# tied to which optional image encoders happen to be present in a platform's
# FFmpeg build. Video-to-image exports first decode a PNG frame through FFmpeg.
IMAGE_FFMPEG_ENCODERS = {
    "jpg": "mjpeg", "jpeg": "mjpeg", "jfif": "mjpeg", "png": "png",
    "webp": "libwebp", "bmp": "bmp", "tif": "tiff", "tiff": "tiff",
    "tga": "targa", "ppm": "ppm", "pgm": "pgm", "pbm": "pbm",
}

HARDWARE_VIDEO_FORMATS = {"mp4", "mkv", "av1", "mov", "m4v", "ts", "m2ts"}
VIDEO_ENCODER_PROFILES = {
    "mp4": ("libx264", "aac"),
    "mkv": ("libx264", "aac"),
    "av1": ("libsvtav1", "aac"),
    "mov": ("libx264", "aac"),
    "m4v": ("libx264", "aac"),
    "ts": ("libx264", "aac"),
    "m2ts": ("libx264", "aac"),
    "avi": ("mpeg4", "libmp3lame"),
    "flv": ("flv", "libmp3lame"),
    "mpeg": ("mpeg2video", "mp2"),
    "mpg": ("mpeg2video", "mp2"),
    "vob": ("mpeg2video", "mp2"),
    "3gp": ("mpeg4", "aac"),
    "wmv": ("wmv2", "wmav2"),
    "asf": ("wmv2", "wmav2"),
}
KNOWN_MEDIA_EXTENSIONS = {
    f".{format_name}"
    for format_name in SUPPORTED_AUDIO_FORMATS | SUPPORTED_VIDEO_FORMATS | SUPPORTED_IMAGE_FORMATS
} | {
    ".oga", ".m4b", ".m4p", ".ape", ".aifc", ".amr", ".dts", ".mka", ".mpc",
    ".ra", ".ram", ".tta", ".voc", ".wv", ".wvc", ".3ga", ".3g2", ".asx",
    ".avchd", ".divx", ".dv", ".f4v", ".m2v", ".mjpg", ".mjpeg", ".mts",
    ".mxf", ".ogv", ".qt", ".rm", ".rmvb", ".yuv", ".apng", ".avif", ".cur",
    ".dib", ".emf", ".eps", ".exr", ".heic", ".heif", ".icns", ".j2k", ".jp2",
    ".jpe", ".jfi", ".jif", ".jxl", ".pcx", ".pfm", ".pic", ".psd", ".ras",
    ".sgi", ".svg", ".xbm", ".xpm", ".qoi",
}
VIDEO_QUALITY_SETTINGS = {
    "best": {"crf": 16, "audio_bitrate": "192k", "gif_fps": 30},
    "high": {"crf": 18, "audio_bitrate": "160k", "gif_fps": 24},
    "balanced": {"crf": 23, "audio_bitrate": "128k", "gif_fps": 15},
    "small": {"crf": 28, "audio_bitrate": "96k", "gif_fps": 10},
}

# Explicit bit-depth selection for lossless containers (no substring sniffing)
WAV_BIT_DEPTH_CODECS = {
    "16": "pcm_s16le", "16-bit": "pcm_s16le", "16bit": "pcm_s16le",
    "32": "pcm_f32le", "32-bit": "pcm_f32le", "32bit": "pcm_f32le",
    "32-bit float": "pcm_f32le", "float": "pcm_f32le",
}
FLAC_BIT_DEPTHS = {
    "16": "s16", "16-bit": "s16", "16bit": "s16",
}
FLAC_DEFAULT_DEPTH = "s32"
WAV_DEFAULT_CODEC = "pcm_s24le"

VAAPI_ENCODER_ARGS = ["-vaapi_device", "/dev/dri/renderD128", "-c:v", "h264_vaapi", "-qp", "23"]

def sanitize_time_offset(value: Optional[str]) -> Optional[str]:
    """
    Validates and normalizes time offsets for FFmpeg / yt-dlp.
    Accepts seconds (e.g. '90', '45.5') or timestamp formats (e.g. '01:30', '00:01:30', '01:15:20.5').
    Rejects malformed input.
    """
    if value is None:
        return None
    val = str(value).strip()
    if not val:
        return None
    if re.match(r"^(?:\d+)(?::\d{2}){0,2}(?:\.\d+)?$", val):
        return val
    try:
        f = float(val)
        if f >= 0 and math.isfinite(f):
            return str(val)
    except (ValueError, TypeError):
        pass
    raise ValueError(f"Invalid time offset: '{val}'. Expected seconds (e.g. 90) or timestamp (e.g. 01:30, 00:01:30).")


def parse_time_offset_seconds(val: Optional[str]) -> Optional[float]:
    """Parse a sanitized time string ('90', '01:30', '00:01:30.5') into seconds."""
    if not val:
        return None
    val_str = str(val).strip()
    if not val_str:
        return None
    parts = val_str.split(":")
    try:
        if len(parts) == 1:
            return float(parts[0])
        elif len(parts) == 2:
            return float(parts[0]) * 60.0 + float(parts[1])
        elif len(parts) == 3:
            return float(parts[0]) * 3600.0 + float(parts[1]) * 60.0 + float(parts[2])
    except (ValueError, TypeError):
        return None
    return None

VIDEO_QUALITY_SETTINGS = {
    "best": {"crf": 16, "audio_bitrate": "192k", "gif_fps": 30},
    "high": {"crf": 18, "audio_bitrate": "160k", "gif_fps": 24},
    "balanced": {"crf": 23, "audio_bitrate": "128k", "gif_fps": 15},
    "small": {"crf": 28, "audio_bitrate": "96k", "gif_fps": 10},
}
