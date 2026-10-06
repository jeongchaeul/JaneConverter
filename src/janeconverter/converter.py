"""
Media Converter Engine for JaneConverter
Transcodes media to high-fidelity audio (MP3, WAV, FLAC, AAC, OGG) and video (MP4, MKV, WEBM, MOV, GIF).
Supports NVIDIA NVENC acceleration, EBU R128 loudness normalization, sample rate control,
and metadata tagging.
"""

import os
import sys
import time
import shutil
import threading
import subprocess
import json
import re
import tempfile
import math
import unicodedata
from dataclasses import replace
from pathlib import Path
from typing import Optional, Dict, Any, Callable

from .recovery import FailureCategory, FailureEvidence, OutputIntent, RecoveryCoordinator, STRATEGIES, record_local_success

SUPPORTED_AUDIO_FORMATS = {
    "mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "aiff", "aif",
    "alac", "ac3", "mp2", "wma", "caf", "au",
}
SUPPORTED_VIDEO_FORMATS = {
    "mp4", "mkv", "webm", "mov", "gif", "avi", "flv", "m4v", "ts",
    "m2ts", "mpeg", "mpg", "vob", "3gp", "wmv", "asf",
}
SUPPORTED_IMAGE_FORMATS = {
    "jpg", "jpeg", "jfif", "png", "webp", "bmp", "tif", "tiff", "gif",
    "ico", "tga", "ppm", "pgm", "pbm",
}
OUTPUT_FILE_EXTENSIONS = {"alac": "m4a"}

# Static image outputs are normalized through Pillow so output support is not
# tied to which optional image encoders happen to be present in a platform's
# FFmpeg build. Video-to-image exports first decode a PNG frame through FFmpeg.
IMAGE_FFMPEG_ENCODERS = {
    "jpg": "mjpeg", "jpeg": "mjpeg", "jfif": "mjpeg", "png": "png",
    "webp": "libwebp", "bmp": "bmp", "tif": "tiff", "tiff": "tiff",
    "tga": "targa", "ppm": "ppm", "pgm": "pgm", "pbm": "pbm",
}

HARDWARE_VIDEO_FORMATS = {"mp4", "mkv", "mov", "m4v", "ts", "m2ts"}
VIDEO_ENCODER_PROFILES = {
    "mp4": ("libx264", "aac"),
    "mkv": ("libx264", "aac"),
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

# Industry standard EBU R128 loudness normalization targets
LOUDNORM_FILTER = "loudnorm=I=-14:TP=-1.5:LRA=11"

def build_loudnorm_filter(measured: Optional[Dict[str, str]] = None) -> str:
    """
    Builds the EBU R128 loudnorm filter.
    Pass 1 measurements request linear processing; FFmpeg may use dynamic
    processing when the requested peak or loudness-range target prevents it.
    """
    keys = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
    try:
        valid = bool(measured and all(math.isfinite(float(measured[key])) for key in keys))
    except (KeyError, ValueError, TypeError):
        valid = False
    if valid:
        return (
            f"loudnorm=I=-14:TP=-1.5:LRA=11"
            f":measured_I={measured['input_i']}"
            f":measured_TP={measured['input_tp']}"
            f":measured_LRA={measured['input_lra']}"
            f":measured_thresh={measured['input_thresh']}"
            f":offset={measured['target_offset']}"
            f":linear=true:print_format=json"
        )
    return LOUDNORM_FILTER + ":print_format=json"

def measure_audio_loudness(input_path: str, ffmpeg_bin: Optional[str] = None) -> Optional[Dict[str, str]]:
    """
    Pass 1 measurement for EBU R128 loudness normalization.
    Returns measured integrated loudness, true peak, LRA, threshold, and target offset
    to enable linear, dynamic-compression-free normalization (linear=true).
    """
    if not os.path.isfile(input_path):
        return None
    ffmpeg = ffmpeg_bin or get_ffmpeg_binary()
    if not ffmpeg or (not shutil.which(ffmpeg) and not os.path.isfile(ffmpeg)):
        return None

    cmd = [
        ffmpeg, "-hide_banner", "-nostats",
        "-i", input_path,
        "-vn", "-sn",
        "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
        "-f", "null", "-"
    ]
    no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=no_window,
            timeout=45
        )
        stderr_text = res.stderr.decode("utf-8", errors="ignore")
        json_match = re.search(r"\{\s*\"input_i\"\s*:.*?\n\}", stderr_text, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            return {
                "input_i": str(data.get("input_i", "-14")),
                "input_tp": str(data.get("input_tp", "-1.5")),
                "input_lra": str(data.get("input_lra", "11")),
                "input_thresh": str(data.get("input_thresh", "-24")),
                "target_offset": str(data.get("target_offset", "0")),
            }
    except Exception:
        pass
    return None

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

_encoder_cache: Dict[Optional[str], Dict[str, Any]] = {}
_encoder_cache_lock = threading.Lock()

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
_source_root = Path(__file__).resolve().parents[2]
PROJECT_ROOT = str(
    _source_root
    if (_source_root / "pyproject.toml").is_file()
    else Path(__file__).resolve().parents[1]
)

def get_ffmpeg_binary() -> str:
    """
    Finds FFmpeg executable in local application root, bin folder, or system PATH.
    """
    candidates = [
        os.path.join(PROJECT_ROOT, "ffmpeg.exe"),
        os.path.join(PROJECT_ROOT, "bin", "ffmpeg.exe"),
        os.path.join(ENGINE_DIR, "ffmpeg.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return os.path.abspath(c)

    which_path = shutil.which("ffmpeg")
    if which_path:
        return which_path

    return "ffmpeg"

def get_ffprobe_binary() -> str:
    """
    Finds FFprobe next to the selected FFmpeg binary or on system PATH.
    """
    ffmpeg_bin = get_ffmpeg_binary()
    sibling = os.path.join(os.path.dirname(os.path.abspath(ffmpeg_bin)),
                           "ffprobe" + (".exe" if os.name == "nt" else ""))
    if os.path.isfile(sibling):
        return sibling
    which_path = shutil.which("ffprobe")
    if which_path:
        return which_path
    return "ffprobe"

def probe_media_duration(input_path: str) -> Optional[float]:
    """
    Returns the duration of the media in seconds via ffprobe, or None if it cannot be determined.
    """
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
    except Exception:
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
            return json.loads(res.stdout)
    except Exception:
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

def validate_output_file(
    output_path: str,
    target_format: str,
    min_size_bytes: int = 1
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

    probe = probe_media_streams(output_path)
    if not probe or not probe.get("streams"):
        raise RuntimeError(
            f"ValidationFailed: destination file '{output_path}' has invalid or unreadable media headers."
        )

    streams = probe.get("streams", [])
    if target_format in SUPPORTED_AUDIO_FORMATS:
        has_audio = any(s.get("codec_type") == "audio" for s in streams)
        if not has_audio:
            raise RuntimeError(
                f"ValidationFailed: output file '{output_path}' does not contain an audio stream."
            )
    elif target_format in SUPPORTED_VIDEO_FORMATS:
        has_video = any(s.get("codec_type") == "video" for s in streams)
        if not has_video:
            raise RuntimeError(
                f"ValidationFailed: output file '{output_path}' does not contain a video stream."
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
    source = probe_media_streams(input_path) or {}
    output = probe_media_streams(output_path) or {}
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
        if source_duration > 0 and output_duration > 0:
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
        if source_duration > 0 and output_duration > 0:
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
    probe = probe_media_streams(output_path) or {}
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

_soxr_supported: Optional[bool] = None
_soxr_lock = threading.Lock()

def has_soxr_support() -> bool:
    """Checks if the active FFmpeg binary has libsoxr resampling filter enabled."""
    global _soxr_supported
    with _soxr_lock:
        if _soxr_supported is not None:
            return _soxr_supported
        try:
            no_win = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            res = subprocess.run(
                [get_ffmpeg_binary(), "-f", "lavfi", "-i", "sine=duration=0.05",
                 "-af", "aresample=resampler=soxr:precision=28", "-f", "null", "-"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=5.0, creationflags=no_win
            )
            _soxr_supported = (res.returncode == 0)
        except Exception:
            _soxr_supported = False
        return _soxr_supported

def is_stream_copy_safe(
    input_path: str,
    target_format: str,
    sample_rate: Optional[int] = None,
    normalize_audio: bool = False,
    resolution: str = "original",
    cover_path: Optional[str] = None,
    probed_info: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Determines if stream copy (-c copy) is safe without quality loss or container corruption.

    Guardrails:
    1. normalize_audio must be False (EBU R128 requires decoding and filtering).
    2. cover_path must not be active (embedding new cover art requires transcode/mux pipelines).
    3. resolution must be 'original' (downscaling requires video filter and transcode).
    4. Codec must be natively supported by the target container format.
    5. Sample rate must match the source audio stream (no resampling requested).
    """
    if normalize_audio:
        return False
    if target_format.lower().strip(".") in SUPPORTED_AUDIO_FORMATS and cover_path and os.path.exists(cover_path):
        return False
    if resolution and resolution.lower() != "original":
        return False

    target_format = target_format.lower().strip(".")
    if target_format in SUPPORTED_IMAGE_FORMATS or target_format == "gif":
        return False

    info = probed_info if probed_info is not None else probe_media_streams(input_path)
    if not info or not info.get("streams"):
        return False

    streams = info.get("streams", [])
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    video_streams = [
        s for s in streams
        if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic", 0) != 1
    ]

    if target_format in SUPPORTED_AUDIO_FORMATS:
        if not audio_streams:
            return False
        a_stream = audio_streams[0]
        a_codec = (a_stream.get("codec_name") or "").lower()
        a_sr = a_stream.get("sample_rate")

        if sample_rate and a_sr and str(sample_rate) != str(a_sr):
            return False

        if target_format in ("aac", "m4a") and a_codec == "aac":
            return True
        if target_format == "mp3" and a_codec in ("mp3", "mp3float"):
            return True
        if target_format == "flac" and a_codec == "flac":
            return True
        if target_format == "ogg" and a_codec in ("vorbis", "opus"):
            return True
        return False

    if target_format in SUPPORTED_VIDEO_FORMATS:
        if not video_streams:
            return False
        v_stream = video_streams[0]
        v_codec = (v_stream.get("codec_name") or "").lower()
        a_codec = (audio_streams[0].get("codec_name") or "").lower() if audio_streams else None
        a_sr = audio_streams[0].get("sample_rate") if audio_streams else None

        if target_format == "mp4":
            v_ok = v_codec in ("h264", "hevc", "av1")
            a_ok = a_codec is None or a_codec in ("aac", "mp3", "opus")
            return v_ok and a_ok
        if target_format == "mkv":
            v_ok = v_codec in ("h264", "hevc", "vp8", "vp9", "av1")
            a_ok = a_codec is None or a_codec in ("aac", "mp3", "opus", "flac", "vorbis")
            return v_ok and a_ok
        if target_format == "webm":
            v_ok = v_codec in ("vp8", "vp9", "av1")
            a_ok = a_codec is None or a_codec in ("opus", "vorbis")
            return v_ok and a_ok
        if target_format == "mov":
            v_ok = v_codec in ("h264", "hevc", "prores")
            a_ok = a_codec is None or a_codec in ("aac", "pcm_s16le", "pcm_s24le")
            return v_ok and a_ok

    return False

def get_unique_target_path(directory: str, filename: str) -> str:
    """Appends an incrementing counter if a file already exists to prevent overwriting."""
    base_target = os.path.join(directory, filename)
    if not os.path.exists(base_target):
        return base_target

    stem, ext = os.path.splitext(filename)
    counter = 1
    while True:
        candidate = os.path.join(directory, f"{stem}_{counter}{ext}")
        if not os.path.exists(candidate):
            return candidate
        counter += 1


def _publish_staged_file(staged_path: str, output_dir: str, filename: str) -> str:
    """Atomically publish a staged file without replacing a concurrent output."""
    stem, extension = os.path.splitext(filename)
    candidate = os.path.join(output_dir, filename)
    counter = 0
    while True:
        try:
            if os.name == "nt":
                # Windows rename is same-volume and fails when the destination
                # already exists, including on filesystems without hard links.
                os.rename(staged_path, candidate)
            else:
                # POSIX rename replaces existing files. A same-volume hard link
                # gives atomic no-clobber publication instead.
                os.link(staged_path, candidate)
        except FileExistsError:
            counter += 1
            candidate = os.path.join(output_dir, f"{stem}_{counter}{extension}")
            continue
        return candidate

def get_host_gpus() -> list:
    """
    Discovers all physical and integrated GPUs on the host system.
    Supports Windows (Registry & PowerShell), Linux (lspci / sysfs), and macOS (system_profiler / sysctl).
    """
    gpus = []
    if sys.platform == "win32":
        try:
            import winreg
            key_path = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as k:
                for i in range(20):
                    try:
                        sub_name = winreg.EnumKey(k, i)
                        with winreg.OpenKey(k, sub_name) as sk:
                            try:
                                desc, _ = winreg.QueryValueEx(sk, "DriverDesc")
                                if desc and desc not in gpus:
                                    low = desc.lower()
                                    if not any(v in low for v in ["virtual", "mirage", "remote", "vbox", "parsec", "rdp"]):
                                        gpus.append(desc)
                            except Exception:
                                pass
                    except Exception:
                        break
        except Exception:
            pass

    elif sys.platform.startswith("linux"):
        try:
            no_win = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            res = subprocess.run(["lspci"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=2.0, creationflags=no_win)
            if res.returncode == 0:
                for line in res.stdout.splitlines():
                    if any(k in line.lower() for k in ["vga", "3d", "display"]):
                        parts = line.split(":", 2)
                        model = parts[-1].strip() if len(parts) >= 3 else line.strip()
                        if model and model not in gpus:
                            gpus.append(model)
        except Exception:
            pass

    elif sys.platform == "darwin":
        try:
            no_win = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            res = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=2.0, creationflags=no_win)
            if res.returncode == 0 and "apple" in res.stdout.lower():
                gpus.append(f"{res.stdout.strip()} (GPU)")
        except Exception:
            pass
        if not gpus:
            gpus.append("Apple Silicon GPU")

    return gpus

def get_best_hardware_encoder(preferred_codec: Optional[str] = None) -> Dict[str, Any]:
    """
    Selects the optimal hardware video encoder for the current system (cached per session).
    Supports NVIDIA (NVENC), AMD (AMF/VAAPI), Intel (QSV), Apple (VideoToolbox), and CPU fallback.
    Configured for maximum throughput and parallel hardware saturation.
    """
    cache_key = preferred_codec if preferred_codec else "__auto__"
    with _encoder_cache_lock:
        cached = _encoder_cache.get(cache_key)
    if cached is not None:
        return dict(cached)
    spec = _detect_best_hardware_encoder(preferred_codec)
    with _encoder_cache_lock:
        _encoder_cache[cache_key] = spec
    return dict(spec)

def _detect_best_hardware_encoder(preferred_codec: Optional[str] = None) -> Dict[str, Any]:
    """
    Performs the actual GPU registry walk / platform probe for get_best_hardware_encoder.
    """
    if preferred_codec:
        if preferred_codec == "h264_nvenc":
            return {
                "has_gpu": True, "vendor": "nvidia", "gpu_name": "NVIDIA GPU", "short_name": "NVIDIA",
                "encoder": "h264_nvenc", "encoder_label": "NVIDIA NVENC",
                "args": ["-c:v", "h264_nvenc", "-preset", "p2", "-cq", "23", "-b:v", "0", "-pix_fmt", "yuv420p"]
            }
        elif preferred_codec == "h264_amf":
            return {
                "has_gpu": True, "vendor": "amd", "gpu_name": "AMD Radeon GPU", "short_name": "AMD",
                "encoder": "h264_amf", "encoder_label": "AMD AMF",
                "args": ["-c:v", "h264_amf", "-quality", "speed", "-pix_fmt", "yuv420p"]
            }
        elif preferred_codec == "h264_qsv":
            return {
                "has_gpu": True, "vendor": "intel", "gpu_name": "Intel GPU", "short_name": "Intel",
                "encoder": "h264_qsv", "encoder_label": "Intel Quick Sync",
                "args": ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "23", "-pix_fmt", "nv12"]
            }
        elif preferred_codec == "h264_videotoolbox":
            return {
                "has_gpu": True, "vendor": "apple", "gpu_name": "Apple Silicon", "short_name": "Apple",
                "encoder": "h264_videotoolbox", "encoder_label": "Apple VideoToolbox",
                "args": ["-c:v", "h264_videotoolbox", "-q:v", "65", "-realtime", "0", "-pix_fmt", "yuv420p"]
            }
        elif preferred_codec == "h264_vaapi":
            return {
                "has_gpu": True, "vendor": "linux_vaapi", "gpu_name": "VAAPI Display", "short_name": "VAAPI",
                "encoder": "h264_vaapi", "encoder_label": "Linux VAAPI",
                "args": list(VAAPI_ENCODER_ARGS)
            }
        elif preferred_codec == "libx264":
            return {
                "has_gpu": False, "vendor": "cpu", "gpu_name": "Multi-Core CPU", "short_name": "CPU Mode",
                "encoder": "libx264", "encoder_label": "CPU Multi-Core",
                "args": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p"]
            }

    gpus = get_host_gpus()
    has_nvidia = any(any(k in g.lower() for k in ["nvidia", "geforce", "quadro", "rtx", "gtx", "tesla"]) for g in gpus)
    has_amd = any(any(k in g.lower() for k in ["amd", "radeon"]) for g in gpus)
    has_intel = any(any(k in g.lower() for k in ["intel", "arc", "iris", "uhd"]) for g in gpus)
    has_apple = (sys.platform == "darwin")

    # Priority 1: NVIDIA GPU (NVENC)
    if has_nvidia:
        gpu_name = next((g for g in gpus if any(k in g.lower() for k in ["nvidia", "geforce", "quadro", "rtx", "gtx", "tesla"])), "NVIDIA GPU")
        short = gpu_name.replace("NVIDIA ", "").replace("GeForce ", "").strip()
        return {
            "has_gpu": True,
            "vendor": "nvidia",
            "gpu_name": gpu_name,
            "short_name": short,
            "encoder": "h264_nvenc",
            "encoder_label": "NVIDIA NVENC",
            "args": ["-c:v", "h264_nvenc", "-preset", "p2", "-cq", "23", "-b:v", "0", "-pix_fmt", "yuv420p"]
        }

    # Priority 2: AMD GPU (AMF on Windows, AMF/VAAPI on Linux)
    if has_amd:
        gpu_name = next((g for g in gpus if any(k in g.lower() for k in ["amd", "radeon"])), "AMD Radeon GPU")
        short = gpu_name.replace("AMD ", "").replace("Radeon(TM) ", "Radeon ").replace("Graphics", "").strip() or "Radeon"
        encoder = "h264_amf" if sys.platform == "win32" else "h264_vaapi"
        label = "AMD AMF" if sys.platform == "win32" else "AMD VAAPI"
        args = ["-c:v", encoder, "-quality", "speed", "-pix_fmt", "yuv420p"] if encoder == "h264_amf" else list(VAAPI_ENCODER_ARGS)
        return {
            "has_gpu": True,
            "vendor": "amd",
            "gpu_name": gpu_name,
            "short_name": short,
            "encoder": encoder,
            "encoder_label": label,
            "args": args
        }

    # Priority 3: Intel GPU (QSV)
    if has_intel:
        gpu_name = next((g for g in gpus if any(k in g.lower() for k in ["intel", "arc", "iris", "uhd"])), "Intel GPU")
        short = gpu_name.replace("Intel(R) ", "").replace("Graphics", "").strip() or "Intel HD/Arc"
        return {
            "has_gpu": True,
            "vendor": "intel",
            "gpu_name": gpu_name,
            "short_name": short,
            "encoder": "h264_qsv",
            "encoder_label": "Intel Quick Sync",
            "args": ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "23", "-pix_fmt", "nv12"]
        }

    # Priority 4: Apple Silicon / macOS (VideoToolbox)
    if has_apple:
        gpu_name = gpus[0] if gpus else "Apple Silicon GPU"
        short = "Apple M-Series" if "apple" in gpu_name.lower() else "Apple GPU"
        return {
            "has_gpu": True,
            "vendor": "apple",
            "gpu_name": gpu_name,
            "short_name": short,
            "encoder": "h264_videotoolbox",
            "encoder_label": "Apple VideoToolbox",
            "args": ["-c:v", "h264_videotoolbox", "-q:v", "65", "-realtime", "0", "-pix_fmt", "yuv420p"]
        }

    # Priority 5: Linux generic VAAPI
    if sys.platform.startswith("linux") and gpus:
        return {
            "has_gpu": True,
            "vendor": "linux_vaapi",
            "gpu_name": gpus[0],
            "short_name": "VAAPI GPU",
            "encoder": "h264_vaapi",
            "encoder_label": "Linux VAAPI",
            "args": list(VAAPI_ENCODER_ARGS)
        }

    # CPU Fallback
    return {
        "has_gpu": False,
        "vendor": "cpu",
        "gpu_name": "Multi-Core CPU",
        "short_name": "CPU Mode",
        "encoder": "libx264",
        "encoder_label": "CPU Multi-Core",
        "args": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p"]
    }


def _apply_video_quality_to_encoder_args(
    encoder_args: list,
    encoder: str,
    quality_name: str,
    resolution: str = "original",
) -> list:
    """Apply the selected visual-quality level and optimal VBR rate control to each hardware encoder."""
    quality = VIDEO_QUALITY_SETTINGS.get(
        (quality_name or "").lower(), VIDEO_QUALITY_SETTINGS["balanced"]
    )
    crf = str(quality["crf"])
    args = list(encoder_args)

    def replace_value(option: str, value: str) -> None:
        if option in args:
            args[args.index(option) + 1] = value

    if encoder == "h264_nvenc":
        quality_name = (quality_name or "").lower()
        # NVENC p7 is the slowest preset; use faster presets for balanced and small output.
        nvenc_preset = {
            "best": "p7",
            "high": "p5",
            "balanced": "p4",
            "small": "p2",
        }.get(quality_name, "p4")
        res_lower = (resolution or "original").lower()
        if "4k" in res_lower or "2160" in res_lower:
            maxrate = "60M"
            bufsize = "120M"
        elif "1440" in res_lower:
            maxrate = "35M"
            bufsize = "70M"
        elif "1080" in res_lower:
            maxrate = "20M"
            bufsize = "40M"
        elif "720" in res_lower:
            maxrate = "12M"
            bufsize = "24M"
        else:
            maxrate = "60M"
            bufsize = "120M"

        nvenc_args = ["-c:v", "h264_nvenc", "-preset", nvenc_preset]
        if quality_name in ("best", "high"):
            nvenc_args.extend(["-tune", "hq"])
        nvenc_args.extend([
            "-rc:v", "vbr",
            "-cq", crf,
            "-qmin", crf,
            "-qmax", str(int(crf) + 4),
            "-maxrate", maxrate,
            "-bufsize", bufsize,
            "-profile:v", "high",
            "-spatial-aq", "1",
            "-temporal-aq", "1",
            "-pix_fmt", "yuv420p",
        ])
        return nvenc_args
    elif encoder == "h264_qsv":
        replace_value("-global_quality", crf)
    elif encoder == "h264_vaapi":
        replace_value("-qp", crf)
    elif encoder == "h264_amf":
        replace_value("-quality", {
            "best": "quality",
            "high": "quality",
            "balanced": "balanced",
            "small": "speed",
        }.get((quality_name or "").lower(), "balanced"))
    elif encoder == "h264_videotoolbox":
        replace_value("-q:v", {
            "best": "75",
            "high": "65",
            "balanced": "55",
            "small": "40",
        }.get((quality_name or "").lower(), "55"))

    return args


def build_ffmpeg_args(
    input_path: str,
    output_path: str,
    target_format: str,
    bitrate: str = "320k",
    sample_rate: int = 48000,
    normalize_audio: bool = False,
    resolution: str = "original",
    use_nvenc: bool = True,
    use_gpu: Optional[bool] = None,
    gpu_codec: Optional[str] = None,
    metadata: Optional[Dict[str, str]] = None,
    cover_path: Optional[str] = None,
    fps: Optional[int] = None,
    stream_copy: bool = False,
    input_sample_rate: Optional[int] = None,
    measured_loudness: Optional[Dict[str, str]] = None,
) -> list:
    """Constructs command line argument list for FFmpeg transcode or instant stream remuxing."""
    target_format = target_format.lower().strip(".")
    active_gpu = use_gpu if use_gpu is not None else use_nvenc
    has_valid_cover = bool(cover_path and os.path.exists(cover_path))

    # Current FFmpeg builds scope -thread_queue_size to output muxers. Local
    # file inputs do not need a custom demux queue, so omit it before each -i.

    # Fast-path: Instant zero-loss stream copy when safe and requested
    if stream_copy:
        ffmpeg_bin = get_ffmpeg_binary()
        cmd = [ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "error", "-i", input_path]
        if metadata:
            for k, v in metadata.items():
                if v:
                    cmd.extend(["-metadata", f"{k}={v}"])
        if target_format in SUPPORTED_AUDIO_FORMATS:
            cmd.extend(["-vn", "-c:a", "copy"])
        elif target_format in SUPPORTED_VIDEO_FORMATS:
            cmd.extend(["-c:v", "copy", "-c:a", "copy"])
        cmd.extend(["-threads", "0"])
        cmd.append(output_path)
        return cmd

    # Determine if target container format supports attached picture stream
    can_embed_art = has_valid_cover and target_format in ("mp3", "flac", "m4a", "aac")

    ffmpeg_bin = get_ffmpeg_binary()
    cmd = [ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "info" if normalize_audio else "error"]

    # Resolve the encoder once so decode acceleration and encode args stay consistent
    enc_spec = None
    if active_gpu and target_format in HARDWARE_VIDEO_FORMATS:
        enc_spec = get_best_hardware_encoder(preferred_codec=gpu_codec)

    # Peak GPU Acceleration: offload video decoding to GPU silicon when hardware acceleration is
    # active. VAAPI is excluded: it uses software decode plus an explicit hwupload filter below.
    if enc_spec is not None and enc_spec["encoder"] != "h264_vaapi":
        cmd.extend(["-hwaccel", "auto"])

    if can_embed_art:
        cmd.extend(["-i", input_path])
        cmd.extend(["-i", cover_path])
        cmd.extend(["-map", "0:a", "-map", "1:v"])
    else:
        cmd.extend(["-i", input_path])

    # Metadata tags
    if metadata:
        for k, v in metadata.items():
            if v:
                cmd.extend(["-metadata", f"{k}={v}"])

    # 1. Audio Conversion
    if target_format in SUPPORTED_AUDIO_FORMATS:
        if not can_embed_art:
            cmd.append("-vn")

        # Audio filters
        audio_filters = []
        if normalize_audio:
            # Request linear processing and read FFmpeg's actual mode after encoding.
            audio_filters.append(build_loudnorm_filter(measured_loudness))

        source_rate_matches = (
            input_sample_rate is not None
            and sample_rate
            and int(input_sample_rate) == int(sample_rate)
        )
        # Avoid a high-quality resampler pass when the output rate already matches.
        if sample_rate and (normalize_audio or not source_rate_matches) and has_soxr_support():
            audio_filters.append("aresample=resampler=soxr:precision=28:cutoff=0.99")

        if audio_filters:
            cmd.extend(["-af", ",".join(audio_filters)])

        if sample_rate:
            cmd.extend(["-ar", str(sample_rate)])

        # Codecs and cover art mapping
        if target_format == "mp3":
            cmd.extend(["-c:a", "libmp3lame", "-b:a", bitrate])
            if can_embed_art:
                cmd.extend([
                    "-c:v", "copy",
                    "-id3v2_version", "3",
                    "-metadata:s:v", "title=Album cover",
                    "-metadata:s:v", "comment=Cover (front)",
                    "-disposition:v", "attached_pic"
                ])
        elif target_format == "wav":
            cmd.extend(["-c:a", WAV_BIT_DEPTH_CODECS.get((bitrate or "").lower(), WAV_DEFAULT_CODEC)])
        elif target_format == "flac":
            depth = FLAC_BIT_DEPTHS.get((bitrate or "").lower(), FLAC_DEFAULT_DEPTH)
            cmd.extend(["-c:a", "flac", "-sample_fmt", depth, "-compression_level", "8"])
            if can_embed_art:
                cmd.extend(["-c:v", "copy", "-disposition:v", "attached_pic"])
        elif target_format in ("aac", "m4a"):
            cmd.extend(["-c:a", "aac", "-b:a", bitrate])
            if can_embed_art:
                cmd.extend(["-c:v", "copy", "-disposition:v", "attached_pic"])
        elif target_format == "ogg":
            ogg_quality = {"q10": "10", "q8": "8", "q6": "6", "q4": "4"}.get(
                (bitrate or "").lower(), "7"
            )
            cmd.extend(["-c:a", "libvorbis", "-q:a", ogg_quality])
        elif target_format == "opus":
            cmd.extend(["-c:a", "libopus", "-b:a", bitrate])
        elif target_format == "alac":
            cmd.extend(["-c:a", "alac"])
        elif target_format in ("aiff", "aif"):
            cmd.extend(["-c:a", "pcm_s16be"])
        elif target_format == "ac3":
            cmd.extend(["-c:a", "ac3", "-b:a", bitrate])
        elif target_format == "mp2":
            cmd.extend(["-c:a", "mp2", "-b:a", bitrate])
        elif target_format == "wma":
            cmd.extend(["-c:a", "wmav2", "-b:a", bitrate])
        elif target_format == "caf":
            cmd.extend(["-c:a", "pcm_s16le"])
        elif target_format == "au":
            cmd.extend(["-c:a", "pcm_s16be"])

    # 2. Video Conversion
    elif target_format in SUPPORTED_VIDEO_FORMATS:
        video_quality = VIDEO_QUALITY_SETTINGS.get(
            (bitrate or "").lower(), VIDEO_QUALITY_SETTINGS["balanced"]
        )
        if target_format == "gif":
            cmd.append("-an")
            cmd.extend(["-loop", "0"])

            gif_fps = fps or video_quality["gif_fps"]
            scale_filter = ""
            res_lower = (resolution or "").lower()
            if "1080" in res_lower:
                scale_filter = "scale=1080:-2:flags=lanczos,"
            elif "720" in res_lower:
                scale_filter = "scale=720:-2:flags=lanczos,"
            elif "480" in res_lower:
                scale_filter = "scale=480:-2:flags=lanczos,"
            elif "360" in res_lower:
                scale_filter = "scale=360:-2:flags=lanczos,"
            elif "240" in res_lower:
                scale_filter = "scale=240:-2:flags=lanczos,"
            elif "original" in res_lower:
                scale_filter = ""
            else:
                scale_filter = "scale=480:-2:flags=lanczos,"

            vf = f"fps={gif_fps},{scale_filter}split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3"
            cmd.extend(["-vf", vf])
        else:
            video_filters = []
            if resolution == "4k":
                video_filters.append("scale=-2:2160")
            elif resolution == "1440p":
                video_filters.append("scale=-2:1440")
            elif resolution == "1080p":
                video_filters.append("scale=-2:1080")
            elif resolution == "720p":
                video_filters.append("scale=-2:720")
            elif resolution == "480p":
                video_filters.append("scale=-2:480")

            audio_filters = []
            if normalize_audio:
                audio_filters.append(build_loudnorm_filter(measured_loudness))

            if audio_filters:
                cmd.extend(["-af", ",".join(audio_filters)])

            if target_format == "webm":
                cmd.extend([
                    "-c:v", "libvpx-vp9", "-crf", str(video_quality["crf"]),
                    "-b:v", "0", "-c:a", "libopus", "-b:a", video_quality["audio_bitrate"]
                ])
            else:
                if enc_spec is not None:
                    if enc_spec["encoder"] == "h264_vaapi":
                        # Software decode: upload frames to the VAAPI render device before encoding
                        video_filters.append("format=nv12")
                        video_filters.append("hwupload")
                    encoder_args = _apply_video_quality_to_encoder_args(
                        enc_spec["args"], enc_spec["encoder"], (bitrate or "").lower(), resolution=resolution
                    )
                    cmd.extend(encoder_args)
                else:
                    video_codec, audio_codec = VIDEO_ENCODER_PROFILES.get(
                        target_format, ("libx264", "aac")
                    )
                    if video_codec == "libx264":
                        cpu_preset = {
                            "best": "slow",
                            "high": "medium",
                            "balanced": "veryfast",
                            "small": "veryfast",
                        }.get((bitrate or "").lower(), "veryfast")
                        cmd.extend([
                            "-c:v", video_codec, "-preset", cpu_preset,
                            "-crf", str(video_quality["crf"]), "-pix_fmt", "yuv420p"
                        ])
                    else:
                        quantizer = {"best": "2", "high": "3", "balanced": "5", "small": "8"}.get(
                            (bitrate or "").lower(), "5"
                        )
                        cmd.extend(["-c:v", video_codec, "-q:v", quantizer, "-pix_fmt", "yuv420p"])

                if target_format not in ("webm",):
                    _, audio_codec = VIDEO_ENCODER_PROFILES.get(target_format, ("libx264", "aac"))
                    cmd.extend([
                        "-c:a", audio_codec,
                        "-b:a", video_quality["audio_bitrate"]
                    ])

            if video_filters:
                cmd.extend(["-vf", ",".join(video_filters)])
    # 3. Still-image export (stories and captured image media)
    elif target_format in SUPPORTED_IMAGE_FORMATS:
        cmd.extend(["-an", "-frames:v", "1"])
        image_encoder = IMAGE_FFMPEG_ENCODERS.get(target_format)
        if not image_encoder:
            raise ValueError(
                f"FFmpeg cannot export a video frame as {target_format.upper()}; use a still image input for this format."
            )
        if image_encoder == "mjpeg":
            cmd.extend(["-c:v", image_encoder, "-q:v", "2"])
        elif image_encoder == "png":
            cmd.extend(["-c:v", image_encoder, "-compression_level", "9"])
        elif image_encoder == "libwebp":
            image_quality = {"best": "95", "high": "90", "balanced": "80", "small": "65"}.get(
                (bitrate or "").lower(), "90"
            )
            cmd.extend(["-c:v", image_encoder, "-q:v", image_quality])
        else:
            cmd.extend(["-c:v", image_encoder])
    else:
        raise ValueError(f"Unsupported conversion format: '{target_format}'")

    cmd.extend(["-threads", "0"])
    cmd.append(output_path)
    return cmd


def _extract_png_frame(input_path: str, output_path: str, abort_event: Optional[Any] = None) -> str:
    """Decode the first video frame to a PNG, with cancellation and validation."""
    if abort_event and abort_event.is_set():
        raise KeyboardInterrupt("Conversion aborted by user.")

    cmd = build_ffmpeg_args(
        input_path=input_path,
        output_path=output_path,
        target_format="png",
        bitrate="best",
        normalize_audio=False,
        resolution="original",
        use_nvenc=False,
        use_gpu=False,
        stream_copy=False,
    )
    cmd[1:1] = ["-hide_banner", "-loglevel", "error"]
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    while process.poll() is None:
        if abort_event and abort_event.is_set():
            process.kill()
            _, stderr = process.communicate()
            if os.path.exists(output_path):
                os.remove(output_path)
            raise KeyboardInterrupt("Conversion aborted by user.")
        time.sleep(0.05)

    _, stderr = process.communicate()
    if process.returncode != 0:
        category = FailureEvidence.ffmpeg(stderr).category.value
        raise RuntimeError(f"FFmpegProcessError: image frame extraction failed ({category}).")
    validate_output_file(output_path, "png")
    return output_path


def _convert_media_impl(
    input_path: str,
    output_dir: str,
    output_filename: str,
    target_format: str,
    bitrate: str = "320k",
    sample_rate: int = 48000,
    normalize_audio: bool = False,
    resolution: str = "original",
    use_nvenc: bool = True,
    use_gpu: Optional[bool] = None,
    gpu_codec: Optional[str] = None,
    metadata: Optional[Dict[str, str]] = None,
    cover_path: Optional[str] = None,
    abort_event: Optional[Any] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    fps: Optional[int] = None,
    allow_stream_copy: bool = True,
    allow_lossless_png_recovery: bool = False,
    _method_override: Optional[str] = None,
    _recovery: Optional[RecoveryCoordinator] = None,
) -> str:
    """
    Transcodes or stream-remuxes input_path into the specified target format and writes to output_dir.
    Optionally embeds cover art image and tags metadata.
    Automatically handles instant zero-loss stream-copying when safe, with fallback to transcode,
    hardware GPU fallback to multi-core CPU, and cover embedding fallback if needed.
    Validates output headers via ffprobe before reporting completion.
    """
    os.makedirs(output_dir, exist_ok=True)
    target_format = target_format.lower().strip(".")
    if _recovery is None:
        _recovery = RecoveryCoordinator(OutputIntent(
            target_format=target_format, quality=bitrate, sample_rate=sample_rate,
            resolution=resolution, normalize_audio=normalize_audio, fps=fps,
            cover_required=bool(cover_path),
            gpu_allowed=bool((use_gpu if use_gpu is not None else use_nvenc)
                             and target_format in HARDWARE_VIDEO_FORMATS),
            allow_png_fallback=allow_lossless_png_recovery,
            metadata=tuple((key, value) for key, value in (metadata or {}).items() if value),
        ))

    if target_format in ("source", "original", ""):
        _recovery.start("source-preserve")
        # Preserve Quality Fast-Path: Zero conversion or re-encoding. Keep the pristine raw file!
        def report_raw(frac: float, msg: str):
            if progress_callback:
                progress_callback(frac, msg)

        _, in_ext = os.path.splitext(input_path)
        actual_ext = in_ext.lower().lstrip(".") or "media"
        image_extensions = {
            "JPEG": "jpg", "MPO": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif",
            "AVIF": "avif", "TIFF": "tif", "BMP": "bmp",
        }
        try:
            from PIL import Image
            with Image.open(input_path) as image:
                decoded_format = image.format
                image.verify()
            if decoded_format in image_extensions:
                actual_ext = image_extensions[decoded_format]
        except (OSError, ValueError):
            pass
        raw_stem, _ = os.path.splitext(output_filename)
        dest_filename = f"{raw_stem}.{actual_ext}" if not output_filename.lower().endswith(f".{actual_ext}") else output_filename
        destination_path = get_unique_target_path(output_dir, dest_filename)

        report_raw(0.70, f"Preserving source quality: keeping raw {actual_ext.upper()} stream without re-encoding...")
        if os.path.abspath(input_path) != os.path.abspath(destination_path):
            shutil.copy2(input_path, destination_path)

        validate_output_file(destination_path, actual_ext)
        report_raw(1.0, f"Conversion complete: {os.path.basename(destination_path)}")
        return destination_path

    active_gpu = use_gpu if use_gpu is not None else use_nvenc
    raw_stem, raw_ext = os.path.splitext(output_filename)
    if raw_ext.lower() in KNOWN_MEDIA_EXTENSIONS or raw_ext.lower() == f".{target_format}":
        stem = raw_stem
    else:
        stem = output_filename
    output_extension = OUTPUT_FILE_EXTENSIONS.get(target_format, target_format)
    destination_path = get_unique_target_path(output_dir, f"{stem}.{output_extension}")

    if abort_event and abort_event.is_set():
        raise KeyboardInterrupt("Conversion aborted by user.")

    ffmpeg_bin = get_ffmpeg_binary()

    def require_ffmpeg() -> None:
        if not shutil.which(ffmpeg_bin) and not os.path.isfile(ffmpeg_bin):
            raise FileNotFoundError(
                "FFmpeg executable not found. Please install FFmpeg, add it to PATH, or place ffmpeg.exe in the JaneConverter directory."
            )

    def report(frac: float, msg: str):
        if progress_callback:
            progress_callback(frac, msg)

    if target_format in SUPPORTED_IMAGE_FORMATS and os.path.isfile(input_path):
        from PIL import Image
        from .image_format import convert_image_format

        try:
            with Image.open(input_path) as image:
                image.verify()
            input_is_still_image = True
        except Exception:
            input_is_still_image = False

        # Pillow decodes still and animated images directly. This handles JFIF
        # and the wider family of Pillow-readable inputs without asking FFmpeg
        # to guess from a filename or discard animation.
        if input_is_still_image:
            _recovery.start("image-pillow")
            report(0.70, f"Converting image to {target_format.upper()}...")
            try:
                convert_image_format(
                    input_path,
                    target_format,
                    bitrate,
                    output_path=destination_path,
                    remove_source=False,
                )
                validate_output_file(destination_path, target_format)
            except Exception:
                if os.path.exists(destination_path):
                    try:
                        os.remove(destination_path)
                    except OSError:
                        pass
                raise
            report(1.0, f"Conversion complete: {os.path.basename(destination_path)}")
            return destination_path

        # Extract one PNG frame first and let Pillow write the requested format.
        # GIF remains on the animated video path when its input is a video.
        if target_format != "gif":
            source_extension = os.path.splitext(input_path)[1].lower().lstrip(".")
            is_image_source = source_extension in SUPPORTED_IMAGE_FORMATS | {
                "avif", "heic", "heif", "jxl", "jp2", "j2k", "psd", "qoi"
            }
            if is_image_source:
                source_probe = probe_media_streams(input_path) or {}
                frames = [stream.get("nb_frames") for stream in source_probe.get("streams", [])
                          if stream.get("codec_type") == "video"]
                if not frames or any(not str(value).isdigit() or int(value) != 1 for value in frames):
                    raise RuntimeError("InputInvalid: the image decoder could not confirm a single frame; no frame was discarded.")
                _recovery.start("image-pillow")
                failure = FailureEvidence("image-decode", FailureCategory.DECODER, True, "image:decoder")
                if _recovery.next_method(failure) != "image-ffmpeg-frame":
                    raise RuntimeError("InputInvalid: no image decoder can preserve this source.")
            _recovery.start("image-ffmpeg-frame")
            require_ffmpeg()
            report(0.70, f"Extracting a frame for {target_format.upper()} output...")
            try:
                with tempfile.TemporaryDirectory(prefix=".janeconverter-image-", dir=output_dir) as frame_dir:
                    frame_path = _extract_png_frame(input_path, os.path.join(frame_dir, "frame.png"), abort_event)
                    convert_image_format(
                        frame_path,
                        target_format,
                        bitrate,
                        output_path=destination_path,
                        remove_source=False,
                    )
                validate_output_file(destination_path, target_format)
            except Exception:
                if os.path.exists(destination_path):
                    try:
                        os.remove(destination_path)
                    except OSError:
                        pass
                raise
            report(1.0, f"Conversion complete: {os.path.basename(destination_path)}")
            return destination_path

    require_ffmpeg()

    audio_probe = (
        probe_media_streams(input_path)
        if target_format in SUPPORTED_AUDIO_FORMATS
        else None
    )
    input_sample_rate = None
    if audio_probe:
        input_sample_rate = next(
            (
                int(stream["sample_rate"])
                for stream in audio_probe.get("streams", [])
                if stream.get("codec_type") == "audio"
                and stream.get("sample_rate")
                and str(stream["sample_rate"]).isdigit()
            ),
            None,
        )

    can_copy = allow_stream_copy and is_stream_copy_safe(
        input_path=input_path,
        target_format=target_format,
        sample_rate=sample_rate,
        normalize_audio=normalize_audio,
        resolution=resolution,
        cover_path=cover_path,
        probed_info=audio_probe,
    )
    method = _method_override or ("stream-copy" if can_copy else "gpu-transcode" if active_gpu and target_format in HARDWARE_VIDEO_FORMATS else "cpu-transcode")
    _recovery.start(method)

    if can_copy:
        report(0.70, f"Compatible streams detected: instant stream remuxing to {target_format.upper()}...")
        cmd = build_ffmpeg_args(
            input_path=input_path,
            output_path=destination_path,
            target_format=target_format,
            bitrate=bitrate,
            sample_rate=sample_rate,
            normalize_audio=False,
            resolution=resolution,
            use_nvenc=False,
            use_gpu=False,
            metadata=metadata,
            cover_path=None,
            input_sample_rate=input_sample_rate,
            fps=fps,
            stream_copy=True,
        )
    else:
        measured_loudness = None
        if normalize_audio and os.path.isfile(input_path):
            report(0.68, "Analyzing audio loudness dynamics (linear EBU R128 pass)...")
            measured_loudness = measure_audio_loudness(input_path, ffmpeg_bin=ffmpeg_bin)

        report(0.70, f"Transcoding media to {target_format.upper()}...")
        cmd = build_ffmpeg_args(
            input_path=input_path,
            output_path=destination_path,
            target_format=target_format,
            bitrate=bitrate,
            sample_rate=sample_rate,
            normalize_audio=normalize_audio,
            resolution=resolution,
            use_nvenc=active_gpu,
            use_gpu=active_gpu,
            gpu_codec=gpu_codec,
            metadata=metadata,
            cover_path=cover_path,
            input_sample_rate=input_sample_rate,
            fps=fps,
            stream_copy=False,
            measured_loudness=measured_loudness,
        )
    # Request machine-readable progress on stdout (inserted before the output path)
    cmd = cmd[:-1] + ["-progress", "pipe:1", "-nostats"] + [cmd[-1]]

    no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=no_window
    )

    stderr_chunks = []

    def read_stderr():
        try:
            stderr_chunks.append(proc.stderr.read())
        except Exception:
            pass

    duration = probe_media_duration(input_path)
    transcode_base, transcode_span = 0.70, 0.25
    last_report_time = [0.0]
    cur_speed = [""]

    def read_progress():
        try:
            for raw_line in iter(proc.stdout.readline, b""):
                line = raw_line.decode("ascii", errors="ignore").strip()
                if not line or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                if key == "speed":
                    cur_speed[0] = value.strip()
                if key == "progress" and value == "end":
                    report(transcode_base + transcode_span, "Transcode finishing up...")
                    continue
                if duration and duration > 0 and key in ("out_time_us", "out_time_ms"):
                    try:
                        out_us = float(value)
                    except ValueError:
                        continue
                    frac = max(0.0, min(1.0, out_us / (duration * 1_000_000.0)))
                    now = time.time()
                    if frac > 0 and now - last_report_time[0] >= 0.5:
                        last_report_time[0] = now
                        spd_info = f" (speed {cur_speed[0]})" if cur_speed[0] else ""
                        report(
                            transcode_base + transcode_span * frac,
                            f"Transcoding {target_format.upper()}: {int(frac * 100)}%{spd_info}"
                        )
                elif not duration and key == "out_time":
                    now = time.time()
                    if now - last_report_time[0] >= 1.0:
                        last_report_time[0] = now
                        time_val = value.strip().split(".")[0]
                        spd_info = f" speed {cur_speed[0]}" if cur_speed[0] else ""
                        report(
                            0.75,
                            f"Transcoding {target_format.upper()} (time {time_val}{spd_info})..."
                        )
        except Exception:
            pass

    reader_thread = threading.Thread(target=read_stderr, daemon=True)
    reader_thread.start()
    progress_thread = threading.Thread(target=read_progress, daemon=True)
    progress_thread.start()

    try:
        while proc.poll() is None:
            if abort_event and abort_event.is_set():
                proc.kill()
                proc.wait()
                reader_thread.join(timeout=1.0)
                progress_thread.join(timeout=1.0)
                if os.path.exists(destination_path):
                    try:
                        os.remove(destination_path)
                    except Exception:
                        pass
                raise KeyboardInterrupt("Conversion aborted by user.")
            if len(_recovery.attempts) > 1 and (
                time.monotonic() - _recovery.started_at > _recovery.max_recovery_seconds
                or time.monotonic() - _recovery.attempts[-1].started_at > STRATEGIES[method].max_seconds
            ):
                proc.kill()
                proc.wait()
                reader_thread.join(timeout=1.0)
                progress_thread.join(timeout=1.0)
                if os.path.exists(destination_path):
                    os.remove(destination_path)
                raise RuntimeError("Conversion recovery stopped at its time limit.")
            time.sleep(0.05)

        proc.wait()
        reader_thread.join(timeout=2.0)
        progress_thread.join(timeout=2.0)
        stderr = stderr_chunks[0] if stderr_chunks else b""

        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=b"", stderr=stderr)
        if normalize_audio:
            text = stderr.decode("utf-8", errors="replace") if isinstance(stderr, bytes) else str(stderr)
            modes = re.findall(r'"normalization_type"\s*:\s*"(linear|dynamic)"', text, re.I)
            mode = modes[-1].lower() if modes else "unconfirmed"
            report(0.99, f"Normalization mode: {mode}." + (" FFmpeg used dynamic processing to meet the loudness and peak targets." if mode == "dynamic" else ""))

    except KeyboardInterrupt:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
            reader_thread.join(timeout=1.0)
            progress_thread.join(timeout=1.0)
        if os.path.exists(destination_path):
            try:
                os.remove(destination_path)
            except Exception:
                pass
        raise

    except subprocess.CalledProcessError as e:
        # Clean up the partial output so retries don't leave orphaned truncated files
        if os.path.exists(destination_path):
            try:
                os.remove(destination_path)
            except Exception:
                pass

        failure = FailureEvidence.ffmpeg(e.stderr)
        category = failure.category
        next_method = _recovery.next_method(failure)
        if next_method:
            report(0.75, f"{method} could not finish ({category.value}); trying {next_method}...")
            if next_method == "cover-normalized":
                from PIL import Image, ImageOps
                with tempfile.TemporaryDirectory(prefix=".janeconverter-cover-", dir=output_dir) as cover_dir:
                    normalized_cover = os.path.join(cover_dir, "cover.png")
                    try:
                        with Image.open(cover_path) as cover_image:
                            if getattr(cover_image, "n_frames", 1) != 1:
                                raise ValueError("animated cover")
                            ImageOps.exif_transpose(cover_image.copy()).save(normalized_cover, "PNG")
                    except (OSError, ValueError) as cover_error:
                        raise RuntimeError("InputInvalid: requested cover art could not be normalized without loss.") from cover_error
                    return convert_media(
                        input_path=input_path, output_dir=output_dir,
                        output_filename=output_filename, target_format=target_format,
                        bitrate=bitrate, sample_rate=sample_rate,
                        normalize_audio=normalize_audio, resolution=resolution,
                        use_nvenc=False, use_gpu=False, metadata=metadata,
                        cover_path=normalized_cover, abort_event=abort_event,
                        progress_callback=progress_callback, fps=fps,
                        allow_stream_copy=False,
                        allow_lossless_png_recovery=allow_lossless_png_recovery,
                        _method_override="cover-normalized", _recovery=_recovery,
                    )
            return convert_media(
                input_path=input_path,
                output_dir=output_dir,
                output_filename=output_filename,
                target_format=target_format,
                bitrate=bitrate,
                sample_rate=sample_rate,
                normalize_audio=normalize_audio,
                resolution=resolution,
                use_nvenc=next_method == "gpu-transcode",
                use_gpu=next_method == "gpu-transcode",
                gpu_codec=gpu_codec if next_method == "gpu-transcode" else None,
                metadata=metadata,
                cover_path=cover_path,
                abort_event=abort_event,
                progress_callback=progress_callback,
                fps=fps,
                allow_stream_copy=False,
                allow_lossless_png_recovery=allow_lossless_png_recovery,
                _recovery=_recovery,
            )
        raise RuntimeError(f"FFmpegProcessError: {method} failed ({category.value}); no policy-safe recovery remains.") from e

    try:
        validate_output_file(destination_path, target_format)
    except Exception as val_err:
        if os.path.exists(destination_path):
            try:
                os.remove(destination_path)
            except Exception:
                pass
        raise RuntimeError(f"Output validation error: {val_err}") from val_err

    if len(_recovery.attempts) > 1:
        report(1.0, f"Conversion complete using {method} after bounded recovery: {os.path.basename(destination_path)}")
    else:
        report(1.0, f"Conversion complete: {os.path.basename(destination_path)}")
    return destination_path


def convert_media(
    input_path: str,
    output_dir: str,
    output_filename: str,
    target_format: str,
    bitrate: str = "320k",
    sample_rate: int = 48000,
    normalize_audio: bool = False,
    resolution: str = "original",
    use_nvenc: bool = True,
    use_gpu: Optional[bool] = None,
    gpu_codec: Optional[str] = None,
    metadata: Optional[Dict[str, str]] = None,
    cover_path: Optional[str] = None,
    abort_event: Optional[Any] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    fps: Optional[int] = None,
    allow_stream_copy: bool = True,
    allow_lossless_png_recovery: bool = False,
    _method_override: Optional[str] = None,
    _recovery: Optional[RecoveryCoordinator] = None,
) -> str:
    """Stage and validate every attempt before publishing one completed output."""
    os.makedirs(output_dir, exist_ok=True)
    if _recovery is None:
        _recovery = RecoveryCoordinator(OutputIntent(
            target_format=target_format.lower().strip("."),
            quality=bitrate,
            sample_rate=sample_rate,
            resolution=resolution,
            normalize_audio=normalize_audio,
            fps=fps,
            cover_required=bool(cover_path),
            gpu_allowed=bool((use_gpu if use_gpu is not None else use_nvenc)
                             and target_format.lower().strip(".") in HARDWARE_VIDEO_FORMATS),
            allow_png_fallback=allow_lossless_png_recovery,
            metadata=tuple((key, value) for key, value in (metadata or {}).items() if value),
        ))

    def staged_progress(value: float, message: str) -> None:
        if progress_callback and value < 1.0:
            progress_callback(value, message)

    with tempfile.TemporaryDirectory(prefix=".janeconverter-convert-", dir=output_dir) as staging_dir:
        common = dict(
            input_path=input_path, output_dir=staging_dir, output_filename=output_filename,
            bitrate=bitrate, sample_rate=sample_rate, normalize_audio=normalize_audio,
            resolution=resolution, use_nvenc=use_nvenc, use_gpu=use_gpu,
            gpu_codec=gpu_codec, metadata=metadata, cover_path=cover_path,
            abort_event=abort_event, progress_callback=staged_progress, fps=fps,
        )
        effective_target = target_format.lower().strip(".")
        try:
            staged_path = _convert_media_impl(
                **common, target_format=target_format, allow_stream_copy=allow_stream_copy,
                allow_lossless_png_recovery=allow_lossless_png_recovery,
                _method_override=_method_override, _recovery=_recovery,
            )
        except RuntimeError as error:
            if not (allow_lossless_png_recovery and effective_target in {"source", "original", ""}
                    and str(error).startswith("ValidationFailed:")):
                raise
            from PIL import Image
            try:
                with Image.open(input_path) as image:
                    if getattr(image, "n_frames", 1) != 1:
                        raise ValueError("animated input")
                    image.verify()
            except (OSError, ValueError):
                raise error
            failure = FailureEvidence("source-validation", FailureCategory.VALIDATION, True, "image:source-validation")
            if _recovery.next_method(failure) != "image-png":
                raise error
            _recovery.start("image-png")
            effective_target = "png"
            png_recovery = RecoveryCoordinator(replace(
                _recovery.intent, target_format="png", allow_png_fallback=False,
            ))
            staged_path = _convert_media_impl(
                **common, target_format="png", allow_stream_copy=False,
                allow_lossless_png_recovery=False, _recovery=png_recovery,
            )
        if abort_event and abort_event.is_set():
            raise KeyboardInterrupt("Conversion aborted by user.")
        validate_output_intent(input_path, staged_path, replace(_recovery.intent, target_format=effective_target))
        validate_image_intent(input_path, staged_path, effective_target)
        if abort_event and abort_event.is_set():
            raise KeyboardInterrupt("Conversion aborted by user.")
        for attempt in range(5):
            if abort_event and abort_event.is_set():
                raise KeyboardInterrupt("Conversion aborted by user.")
            try:
                final_path = _publish_staged_file(staged_path, output_dir, os.path.basename(staged_path))
                break
            except PermissionError as error:
                if getattr(error, "winerror", None) not in (32, 33) or attempt == 4:
                    raise
                time.sleep(0.1 * (2 ** attempt))

    if len(_recovery.attempts) > 1:
        try:
            from .paths import APP_DATA_DIR
            record_local_success(os.path.join(APP_DATA_DIR, "recovery-evidence.json"), _recovery)
        except (OSError, ValueError, TypeError):
            pass
    if progress_callback:
        if len(_recovery.attempts) > 1:
            first = _recovery.attempts[0]
            outcome = first.result.value if first.result else "unknown"
            try:
                properties = validated_output_properties(final_path, effective_target)
            except (OSError, ValueError, RuntimeError):
                properties = "validated media"
            progress_callback(1.0, f"Recovered from {outcome} as {effective_target.upper()} using {_recovery.attempts[-1].method} ({properties}): {os.path.basename(final_path)}")
        else:
            progress_callback(1.0, f"Ready: {os.path.basename(final_path)}")
    return final_path
