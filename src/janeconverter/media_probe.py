"""
Media probing and validation subsystem for JaneConverter.
Provides stream analysis, duration extraction, and format integrity verification.
"""

from __future__ import annotations

import json
import os
import subprocess
import unicodedata
from typing import Any, Dict, Optional

from .binaries import get_ffprobe_binary
from .constants import (
    SUPPORTED_AUDIO_FORMATS,
    SUPPORTED_IMAGE_FORMATS,
    SUPPORTED_VIDEO_FORMATS,
    parse_time_offset_seconds,
)
from .recovery import OutputIntent

import threading

_PROBE_CACHE_LOCK = threading.Lock()
_PROBE_CACHE: Dict[tuple, Dict[str, Any]] = {}
_MAX_PROBE_CACHE_ENTRIES = 64

def probe_media_duration(input_path: str) -> Optional[float]:
    """
    Returns the duration of the media in seconds via ffprobe, or None if it cannot be determined.
    """
    if not input_path or not os.path.exists(input_path):
        return None
    try:
        st = os.stat(input_path)
        cache_key = (os.path.abspath(input_path), st.st_mtime_ns, st.st_size)
    except OSError:
        cache_key = None

    if cache_key is not None:
        with _PROBE_CACHE_LOCK:
            cached = _PROBE_CACHE.get(cache_key)
            if cached:
                dur_str = cached.get("format", {}).get("duration")
                if dur_str:
                    try:
                        return float(dur_str)
                    except (ValueError, TypeError):
                        pass
    try:
        no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        res = subprocess.run(
            [get_ffprobe_binary(), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", input_path],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", errors="replace", timeout=15.0, creationflags=no_window
        )
        if res.returncode == 0 and res.stdout.strip():
            return float(res.stdout.strip())
    except (subprocess.SubprocessError, ValueError, OSError):
        pass
    return None

def probe_media_streams(input_path: str) -> Optional[Dict[str, Any]]:
    """
    Returns media information (format and streams) via ffprobe as a parsed dict,
    or None if probing fails or the input is invalid.
    """
    if not input_path or not os.path.exists(input_path):
        return None
    try:
        st = os.stat(input_path)
        cache_key = (os.path.abspath(input_path), st.st_mtime_ns, st.st_size)
    except OSError:
        cache_key = None

    if cache_key is not None:
        with _PROBE_CACHE_LOCK:
            if cache_key in _PROBE_CACHE:
                return _PROBE_CACHE[cache_key]

    try:
        no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        res = subprocess.run(
            [
                get_ffprobe_binary(),
                "-v", "error",
                "-show_format",
                "-show_streams",
                "-of", "json",
                input_path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15.0,
            creationflags=no_window,
        )
        if res.returncode == 0 and res.stdout.strip():
            parsed = json.loads(res.stdout)
            if cache_key is not None:
                with _PROBE_CACHE_LOCK:
                    if len(_PROBE_CACHE) >= _MAX_PROBE_CACHE_ENTRIES:
                        _PROBE_CACHE.pop(next(iter(_PROBE_CACHE)))
                    _PROBE_CACHE[cache_key] = parsed
            return parsed
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError):
        pass
    return None

def format_video_dimensions(probe: Optional[Dict[str, Any]]) -> str:
    """Format the primary video stream resolution in consumer-facing text."""
    if not probe or not probe.get("streams"):
        return "unknown size"
    for stream in probe.get("streams", []):
        if stream.get("codec_type") != "video":
            continue
        width = stream.get("width")
        height = stream.get("height")
        if not width or not height:
            continue
        try:
            width_int, height_int = int(width), int(height)
        except (TypeError, ValueError):
            continue
        if width_int >= 3840 and height_int >= 2160:
            return f"{width_int}×{height_int} (4K Ultra HD)"
        if width_int >= 2560 and height_int >= 1440:
            return f"{width_int}×{height_int} (1440p)"
        if width_int >= 1920 and height_int >= 1080:
            return f"{width_int}×{height_int} (Full HD)"
        if width_int >= 1280 and height_int >= 720:
            return f"{width_int}×{height_int} (HD)"
        return f"{width_int}×{height_int}"
    return "unknown size"


def _active_probe_media_streams(input_path: str) -> Optional[Dict[str, Any]]:
    import sys
    conv = sys.modules.get("janeconverter.converter")
    if conv and "probe_media_streams" in conv.__dict__:
        fn = conv.__dict__["probe_media_streams"]
        if fn is not _active_probe_media_streams and fn is not probe_media_streams:
            return fn(input_path)
    return probe_media_streams(input_path)

def validate_output_file(
    output_path: str,
    target_format: str,
    min_size_bytes: int = 1,
    require_video: Optional[bool] = None,
) -> None:
    """
    Validates that a converted file exists, is non-empty, and passes ffprobe structure checks.
    Raises RuntimeError with 'ValidationFailed:' prefix if validation fails.
    """
    if not os.path.isfile(output_path):
        raise RuntimeError(
            f"ValidationFailed: destination file '{output_path}' was not created."
        )

    size = os.path.getsize(output_path)
    if size < min_size_bytes:
        raise RuntimeError(
            f"ValidationFailed: destination file '{output_path}' is corrupted or empty ({size} bytes)."
        )

    target_format = target_format.lower().strip(".")
    if target_format in SUPPORTED_IMAGE_FORMATS:
        try:
            from PIL import Image

            with Image.open(output_path) as image:
                image.verify()
        except Exception as exc:
            raise RuntimeError(
                f"ValidationFailed: output file '{output_path}' is not a readable {target_format.upper()} image."
            ) from exc
        return

    probe = _active_probe_media_streams(output_path)
    if not probe or not probe.get("streams"):
        raise RuntimeError(
            f"ValidationFailed: destination file '{output_path}' has invalid or unreadable media headers."
        )

    streams = probe.get("streams", [])
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    has_video = any(s.get("codec_type") == "video" for s in streams)

    if require_video is True:
        if not has_video:
            raise RuntimeError(
                f"ValidationFailed: output file '{output_path}' does not contain a video stream."
            )
    elif require_video is False:
        if not has_audio:
            raise RuntimeError(
                f"ValidationFailed: output file '{output_path}' does not contain an audio stream."
            )
    elif target_format in SUPPORTED_AUDIO_FORMATS:
        if not has_audio:
            raise RuntimeError(
                f"ValidationFailed: output file '{output_path}' does not contain an audio stream."
            )
    elif target_format in SUPPORTED_VIDEO_FORMATS:
        # Flexible multi-track container formats like WebM and MKV can legitimately contain audio-only streams
        if target_format in {"webm", "mkv", "weba", "mka"} and has_audio and not has_video:
            return
        if not has_video:
            raise RuntimeError(
                f"ValidationFailed: output file '{output_path}' does not contain a video stream."
            )
    elif target_format in {"source", "original", ""}:
        if not has_audio and not has_video:
            raise RuntimeError(
                f"ValidationFailed: output file '{output_path}' does not contain any audio or video streams."
            )


def validate_output_intent(
    input_path: str,
    output_path: str,
    intent: OutputIntent,
) -> None:
    """Check requested media properties and required streams before publication."""
    target = intent.target_format
    if target not in SUPPORTED_AUDIO_FORMATS | SUPPORTED_VIDEO_FORMATS:
        return
    source = _active_probe_media_streams(input_path) or {}
    output = _active_probe_media_streams(output_path) or {}
    source_streams = source.get("streams", [])
    output_streams = output.get("streams", [])
    if intent.metadata:
        non_cover_streams = [
            stream for stream in output_streams
            if not stream.get("disposition", {}).get("attached_pic")
        ]
        output_tags = {
            str(key).lower(): str(value)
            for tags in [
                *(stream.get("tags", {}) for stream in non_cover_streams),
                output.get("format", {}).get("tags", {}),
            ]
            if isinstance(tags, dict)
            for key, value in tags.items()
        }
        for key, value in intent.metadata:
            actual = unicodedata.normalize("NFC", output_tags.get(key.lower(), "")).strip()
            expected = unicodedata.normalize("NFC", str(value)).strip()
            if actual != expected:
                raise RuntimeError("ValidationFailed: requested media metadata was not retained.")
    audio = next((stream for stream in output_streams if stream.get("codec_type") == "audio"), None)
    video = next((stream for stream in output_streams if stream.get("codec_type") == "video"
                  and not stream.get("disposition", {}).get("attached_pic")), None)
    if target in SUPPORTED_AUDIO_FORMATS:
        if not audio:
            raise RuntimeError("ValidationFailed: the requested audio stream is missing.")
        source_audio = next((stream for stream in source_streams if stream.get("codec_type") == "audio"), None)
        if source_audio and source_audio.get("channels") and audio.get("channels") != source_audio.get("channels"):
            raise RuntimeError("ValidationFailed: the output audio channel count changed.")
        try:
            source_duration = float(source.get("format", {}).get("duration") or 0)
            output_duration = float(output.get("format", {}).get("duration") or 0)
        except (TypeError, ValueError):
            source_duration = output_duration = 0
        is_trimmed = bool(intent.start_time or intent.end_time)
        if is_trimmed:
            if output_duration <= 0:
                raise RuntimeError("ValidationFailed: the trimmed output has zero or invalid duration.")
            s_sec = parse_time_offset_seconds(intent.start_time) or 0.0
            e_sec = parse_time_offset_seconds(intent.end_time)
            if e_sec is not None and e_sec > s_sec:
                expected_trim_duration = e_sec - s_sec
            elif source_duration > s_sec:
                expected_trim_duration = source_duration - s_sec
            else:
                expected_trim_duration = None
            if expected_trim_duration is not None and expected_trim_duration > 0:
                max_diff = max(2.5, expected_trim_duration * 0.15)
                if abs(expected_trim_duration - output_duration) > max_diff:
                    raise RuntimeError("ValidationFailed: the output audio duration changed unexpectedly.")
        elif source_duration > 0 and output_duration > 0:
            if abs(source_duration - output_duration) > max(0.5, source_duration * 0.02):
                raise RuntimeError("ValidationFailed: the output audio duration changed unexpectedly.")
        if intent.sample_rate and str(audio.get("sample_rate")) != str(intent.sample_rate):
            raise RuntimeError("ValidationFailed: the output audio sample rate changed.")
        quality = intent.quality.lower().strip()
        if target == "wav":
            expected_codec = {
                "16-bit": "pcm_s16le", "16": "pcm_s16le",
                "24-bit": "pcm_s24le", "24": "pcm_s24le",
                "32-bit": "pcm_f32le", "32": "pcm_f32le",
                "32-bit float": "pcm_f32le", "float": "pcm_f32le",
            }.get(quality)
            if expected_codec and audio.get("codec_name") != expected_codec:
                raise RuntimeError("ValidationFailed: the requested WAV bit depth was not produced.")
        if target == "flac" and quality in {"16-bit", "16", "24-bit", "24"}:
            expected_depth = 24 if quality.startswith("24") else 16
            actual_depth = audio.get("bits_per_raw_sample") or audio.get("bits_per_sample")
            if str(actual_depth) != str(expected_depth):
                raise RuntimeError("ValidationFailed: the requested FLAC bit depth was not produced.")
        if intent.cover_required and target in {"mp3", "flac", "m4a", "aac"}:
            if not any(stream.get("disposition", {}).get("attached_pic") for stream in output_streams):
                raise RuntimeError("ValidationFailed: requested cover art was not embedded.")
    elif target != "gif":
        if not video:
            raise RuntimeError("ValidationFailed: the requested video stream is missing.")
        if any(stream.get("codec_type") == "audio" for stream in source_streams) and not audio:
            raise RuntimeError("ValidationFailed: the source audio stream was lost.")
        source_video = next((stream for stream in source_streams if stream.get("codec_type") == "video"), None)
        if source_video:
            from fractions import Fraction
            try:
                source_rate = float(Fraction(source_video.get("avg_frame_rate") or "0"))
                output_rate = float(Fraction(video.get("avg_frame_rate") or "0"))
            except (ValueError, ZeroDivisionError, TypeError):
                source_rate = output_rate = 0
            if source_rate > 0 and output_rate > 0 and abs(source_rate - output_rate) > max(0.5, source_rate * 0.02):
                raise RuntimeError("ValidationFailed: the output video frame rate changed.")
        if intent.resolution == "original" and source_video:
            for dimension in ("width", "height"):
                if source_video.get(dimension) and source_video.get(dimension) != video.get(dimension):
                    raise RuntimeError("ValidationFailed: the output video dimensions changed.")
        elif intent.resolution in {"4k", "1440p", "1080p", "720p", "480p"}:
            expected_height = {"4k": 2160, "1440p": 1440, "1080p": 1080,
                               "720p": 720, "480p": 480}[intent.resolution]
            if video.get("height") != expected_height:
                raise RuntimeError("ValidationFailed: the requested video height was not produced.")
        try:
            source_duration = float(source.get("format", {}).get("duration") or 0)
            output_duration = float(output.get("format", {}).get("duration") or 0)
        except (TypeError, ValueError):
            source_duration = output_duration = 0
        is_trimmed = bool(intent.start_time or intent.end_time)
        if is_trimmed:
            if output_duration <= 0:
                raise RuntimeError("ValidationFailed: the trimmed output video has zero or invalid duration.")
            s_sec = parse_time_offset_seconds(intent.start_time) or 0.0
            e_sec = parse_time_offset_seconds(intent.end_time)
            if e_sec is not None and e_sec > s_sec:
                expected_trim_duration = e_sec - s_sec
            elif source_duration > s_sec:
                expected_trim_duration = source_duration - s_sec
            else:
                expected_trim_duration = None
            if expected_trim_duration is not None and expected_trim_duration > 0:
                max_diff = max(2.5, expected_trim_duration * 0.15)
                if abs(expected_trim_duration - output_duration) > max_diff:
                    raise RuntimeError("ValidationFailed: the output video duration changed unexpectedly.")
        elif source_duration > 0 and output_duration > 0:
            if abs(source_duration - output_duration) > max(0.5, source_duration * 0.02):
                raise RuntimeError("ValidationFailed: the output video duration changed unexpectedly.")
    elif intent.fps:
        if not video:
            raise RuntimeError("ValidationFailed: the requested GIF frames are missing.")
        rate = video.get("avg_frame_rate") or video.get("r_frame_rate") or "0"
        try:
            from fractions import Fraction
            actual_fps = float(Fraction(rate))
        except (ValueError, ZeroDivisionError, TypeError):
            actual_fps = 0
        if abs(actual_fps - intent.fps) > max(0.5, intent.fps * 0.02):
            raise RuntimeError("ValidationFailed: the requested GIF frame rate changed.")


def validate_image_intent(input_path: str, output_path: str, target_format: str) -> None:
    """Reject a staged image that loses frames, dimensions, or supported alpha."""
    if target_format not in SUPPORTED_IMAGE_FORMATS:
        return
    from PIL import Image, ImageOps

    try:
        source = Image.open(input_path)
    except (OSError, ValueError):
        return  # A video-to-image export has an explicitly selected first frame.
    with source, Image.open(output_path) as output:
        source_frames = getattr(source, "n_frames", 1)
        output_frames = getattr(output, "n_frames", 1)
        if source_frames > 1 and output_frames != source_frames:
            raise RuntimeError("ValidationFailed: the requested image format would discard animation frames.")
        if target_format != "ico" and ImageOps.exif_transpose(source.copy()).size != output.size:
            raise RuntimeError("ValidationFailed: the output image dimensions changed.")
        has_source_alpha = "A" in source.getbands() or "transparency" in source.info
        target_supports_alpha = target_format in {"png", "webp", "tif", "tiff", "gif", "ico"}
        has_output_alpha = "A" in output.getbands() or "transparency" in output.info
        if has_source_alpha and target_supports_alpha and not has_output_alpha:
            raise RuntimeError("ValidationFailed: the output image lost transparency.")
        if source.info.get("icc_profile") and target_format in {"jpg", "jpeg", "jfif", "png", "webp", "tif", "tiff"}:
            if output.info.get("icc_profile") != source.info["icc_profile"]:
                raise RuntimeError("ValidationFailed: the output image lost its color profile.")


def validated_output_properties(output_path: str, target_format: str) -> str:
    """Return a short media summary without source paths or metadata values."""
    if target_format in SUPPORTED_IMAGE_FORMATS:
        from PIL import Image
        with Image.open(output_path) as image:
            return f"{image.width}×{image.height}, {getattr(image, 'n_frames', 1)} frame(s)"
    probe = _active_probe_media_streams(output_path) or {}
    streams = probe.get("streams", [])
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    video = next((stream for stream in streams if stream.get("codec_type") == "video"
                  and not stream.get("disposition", {}).get("attached_pic")), None)
    if video:
        dimensions = f"{video.get('width', '?')}×{video.get('height', '?')}"
        return f"{dimensions}, {'with' if audio else 'without'} audio"
    if audio:
        return f"{audio.get('sample_rate', '?')} Hz, {audio.get('channels', '?')} channel(s)"
    return "validated media"

