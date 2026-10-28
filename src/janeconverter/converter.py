"""
Media Converter Engine for JaneConverter
Transcodes media to high-fidelity audio (MP3, WAV, FLAC, AAC, OGG) and video (MP4, MKV, WEBM, MOV, GIF).
Supports NVIDIA NVENC acceleration, EBU R128 loudness normalization, sample rate control,
and metadata tagging.
"""

import os
import time
import shutil
import errno
import threading
import subprocess
import re
import tempfile
from dataclasses import replace
from typing import Optional, Dict, Any, Callable

from .paths import ensure_extended_length_path
from .recovery import (
    FailureCategory,
    FailureEvidence,
    OutputIntent,
    RecoveryCoordinator,
    STRATEGIES,
    record_local_success,
    record_local_failure,
    quarantine_failure,
)


from .constants import (
    SUPPORTED_AUDIO_FORMATS,
    SUPPORTED_VIDEO_FORMATS,
    SUPPORTED_IMAGE_FORMATS,
    OUTPUT_FILE_EXTENSIONS,
    IMAGE_FFMPEG_ENCODERS,
    HARDWARE_VIDEO_FORMATS,
    VIDEO_ENCODER_PROFILES,
    KNOWN_MEDIA_EXTENSIONS,
    WAV_BIT_DEPTH_CODECS,
    FLAC_BIT_DEPTHS,
    FLAC_DEFAULT_DEPTH,
    WAV_DEFAULT_CODEC,
    VAAPI_ENCODER_ARGS,
    LOUDNORM_FILTER,
    VIDEO_QUALITY_SETTINGS,
    sanitize_time_offset,
    parse_time_offset_seconds,
)
from .binaries import (
    ENGINE_DIR,
    PROJECT_ROOT,
    get_ffmpeg_binary,
    get_ffprobe_binary,
    get_node_binary,
    get_js_runtimes_config,
)
from .audio_dsp import (
    build_loudnorm_filter,
    measure_audio_loudness,
    has_soxr_support,
)
from .media_probe import (
    probe_media_duration,
    probe_media_streams,
    format_video_dimensions,
    validate_output_file,
    validate_output_intent,
    validate_image_intent,
    validated_output_properties,
)
from .hardware import (
    get_host_gpus,
    probe_hardware_encoder,
    get_best_hardware_encoder,
    _detect_best_hardware_encoder,
    _apply_video_quality_to_encoder_args,
    _encoder_cache,
    _encoder_cache_lock,
)

__all__ = [
    "SUPPORTED_AUDIO_FORMATS",
    "SUPPORTED_VIDEO_FORMATS",
    "SUPPORTED_IMAGE_FORMATS",
    "OUTPUT_FILE_EXTENSIONS",
    "IMAGE_FFMPEG_ENCODERS",
    "HARDWARE_VIDEO_FORMATS",
    "VIDEO_ENCODER_PROFILES",
    "KNOWN_MEDIA_EXTENSIONS",
    "WAV_BIT_DEPTH_CODECS",
    "FLAC_BIT_DEPTHS",
    "FLAC_DEFAULT_DEPTH",
    "WAV_DEFAULT_CODEC",
    "VAAPI_ENCODER_ARGS",
    "LOUDNORM_FILTER",
    "VIDEO_QUALITY_SETTINGS",
    "sanitize_time_offset",
    "parse_time_offset_seconds",
    "ENGINE_DIR",
    "PROJECT_ROOT",
    "get_ffmpeg_binary",
    "get_ffprobe_binary",
    "get_node_binary",
    "get_js_runtimes_config",
    "build_loudnorm_filter",
    "measure_audio_loudness",
    "has_soxr_support",
    "probe_media_duration",
    "probe_media_streams",
    "format_video_dimensions",
    "validate_output_file",
    "validate_output_intent",
    "validate_image_intent",
    "validated_output_properties",
    "get_host_gpus",
    "probe_hardware_encoder",
    "get_best_hardware_encoder",
    "_detect_best_hardware_encoder",
    "_apply_video_quality_to_encoder_args",
    "_encoder_cache",
    "_encoder_cache_lock",
]
def is_stream_copy_safe(
    input_path: str,
    target_format: str,
    sample_rate: Optional[int] = None,
    normalize_audio: bool = False,
    resolution: str = "original",
    cover_path: Optional[str] = None,
    probed_info: Optional[Dict[str, Any]] = None,
    reconstruct_frequency_loss: bool = False,
) -> bool:
    """
    Determines if stream copy (-c copy) is safe without quality loss or container corruption.

    Guardrails:
    1. normalize_audio must be False (EBU R128 requires decoding and filtering).
    2. cover_path must not be active (embedding new cover art requires transcode/mux pipelines).
    3. resolution must be 'original' (downscaling requires video filter and transcode).
    4. Codec must be natively supported by the target container format.
    5. Sample rate must match the source audio stream (no resampling requested).
    6. reconstruct_frequency_loss must be False (requires harmonic exciter filter).
    """
    if normalize_audio or reconstruct_frequency_loss:
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
    if not os.path.exists(ensure_extended_length_path(base_target)):
        return base_target

    stem, ext = os.path.splitext(filename)
    counter = 1
    while True:
        candidate = os.path.join(directory, f"{stem}_{counter}{ext}")
        if not os.path.exists(ensure_extended_length_path(candidate)):
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
                src = ensure_extended_length_path(staged_path)
                dst = ensure_extended_length_path(candidate)
                os.rename(src, dst)
            else:
                # POSIX rename replaces existing files. A same-volume hard link
                # gives atomic no-clobber publication when supported.
                try:
                    os.link(staged_path, candidate)
                    try:
                        os.unlink(staged_path)
                    except OSError:
                        pass
                except OSError as err:
                    # Fallback for filesystems lacking hardlink support (e.g. FAT32/exFAT/NFS)
                    unsupported_codes = {errno.EPERM, errno.ENOSYS, errno.EXDEV}
                    if hasattr(errno, "EOPNOTSUPP"):
                        unsupported_codes.add(errno.EOPNOTSUPP)
                    if hasattr(errno, "ENOTSUP"):
                        unsupported_codes.add(errno.ENOTSUP)
                    if err.errno in unsupported_codes:
                        if os.path.exists(candidate):
                            raise FileExistsError(f"Candidate {candidate} exists.")
                        shutil.move(staged_path, candidate)
                    else:
                        raise
        except FileExistsError:
            counter += 1
            candidate = os.path.join(output_dir, f"{stem}_{counter}{extension}")
            continue
        return candidate

def adapt_ffmpeg_command(cmd: list[str], stderr: bytes | str | None) -> Optional[list[str]]:
    """
    Adaptive JIT Command Transformation:
    Inspects process stderr for mutable argument errors and synthesizes an adapted command.
    Returns None if no adaptation applies.
    """
    if not cmd or not stderr:
        return None
    text = (stderr.decode("utf-8", errors="ignore") if isinstance(stderr, bytes) else str(stderr)).lower()
    mutated = list(cmd)
    changed = False

    # 1. Hardware acceleration device creation failure
    hwaccel_errors = (
        "device creation failed", "cannot load nvcuda", "failed to create direct3d",
        "hwaccel initialization failed", "failed to initialise vaapi",
        "error creating a mfx session", "no capable devices", "device setup failed",
    )
    if any(err in text for err in hwaccel_errors) and "-hwaccel" in mutated:
        idx = mutated.index("-hwaccel")
        if idx + 1 < len(mutated) and not mutated[idx + 1].startswith("-"):
            del mutated[idx:idx + 2]
        else:
            del mutated[idx:idx + 1]
        changed = True

    # 2. Incompatible or unsupported pixel format
    pix_fmt_errors = (
        "incompatible pixel format", "specified pixel format",
        "pixel format is not supported", "unsupported pixel format",
    )
    if any(err in text for err in pix_fmt_errors) and "-pix_fmt" in mutated:
        idx = mutated.index("-pix_fmt")
        if idx + 1 < len(mutated) and mutated[idx + 1] != "yuv420p":
            mutated[idx + 1] = "yuv420p"
            changed = True

    # 3. Experimental codec gate requiring -strict -2
    if ("is experimental" in text or "requires -strict" in text) and "-strict" not in mutated:
        mutated.insert(-1, "-strict")
        mutated.insert(-1, "-2")
        changed = True

    # 4. Audio channel layout unsupported
    chan_errors = (
        "channel layout not supported", "channels not supported", "audio channel layout",
    )
    if any(err in text for err in chan_errors) and "-ac" not in mutated:
        mutated.insert(-1, "-ac")
        mutated.insert(-1, "2")
        changed = True

    # 5. Presentation timestamp (PTS/DTS) corruption & A/V desync auto-healing
    sync_errors = (
        "non-monotonous dts", "timestamp discontinuity", "pts < dts", "invalid pts",
        "dts < pcr", "corrupt decoded frame in stream",
    )
    if any(err in text for err in sync_errors) and "-fps_mode" not in mutated:
        mutated.insert(-1, "-fps_mode")
        mutated.insert(-1, "cfr")
        changed = True

    return mutated if changed else None


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
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    reconstruct_frequency_loss: bool = False,
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
        cmd = [ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "error"]
        if start_time:
            cmd.extend(["-ss", start_time])
        if end_time:
            cmd.extend(["-to", end_time])
        cmd.extend(["-i", input_path])
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
        if start_time:
            cmd.extend(["-ss", start_time])
        if end_time:
            cmd.extend(["-to", end_time])
        cmd.extend(["-i", input_path])
        cmd.extend(["-i", cover_path])
        cmd.extend(["-map", "0:a", "-map", "1:v"])
    else:
        if start_time:
            cmd.extend(["-ss", start_time])
        if end_time:
            cmd.extend(["-to", end_time])
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

        # Audio filters: Resampling must precede loudnorm so that:
        # 1. Loudnorm normalizes the resampled stream directly.
        # 2. Resampling sinc reconstruction overshoot cannot breach the True Peak ceiling.
        audio_filters = []
        source_rate_matches = (
            input_sample_rate is not None
            and sample_rate
            and int(input_sample_rate) == int(sample_rate)
        )
        # Avoid a resampler pass when the output rate already matches the source stream.
        if sample_rate and not source_rate_matches and has_soxr_support():
            audio_filters.append("aresample=resampler=soxr:precision=28:cutoff=0.99:dither_method=triangular")

        if reconstruct_frequency_loss:
            audio_filters.append("aexciter=freq=7500:ceil=20000:amount=2.5:drive=8.5:blend=0")

        if normalize_audio:
            # Request linear processing and read FFmpeg's actual mode after encoding.
            audio_filters.append(build_loudnorm_filter(measured_loudness))

        if audio_filters:
            cmd.extend(["-af", ",".join(audio_filters)])

        if sample_rate:
            cmd.extend(["-ar", str(sample_rate)])

        # Codecs and cover art mapping
        if target_format == "mp3":
            cmd.extend(["-c:a", "libmp3lame", "-b:a", bitrate, "-cutoff", "20000"])
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
            cmd.extend(["-c:a", "aac", "-b:a", bitrate, "-cutoff", "20000"])
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
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    start_extract = time.monotonic()
    max_frame_wait = 30.0
    while True:
        if abort_event and abort_event.is_set():
            process.kill()
            try:
                _, stderr = process.communicate(timeout=1.0)
            except Exception:
                stderr = b""
            if os.path.exists(output_path):
                try:
                    os.remove(output_path)
                except OSError:
                    pass
            raise KeyboardInterrupt("Conversion aborted by user.")
        if time.monotonic() - start_extract > max_frame_wait:
            process.kill()
            try:
                _, stderr = process.communicate(timeout=1.0)
            except Exception:
                stderr = b""
            raise TimeoutError("FFmpeg frame extraction timed out.")
        try:
            _, stderr = process.communicate(timeout=0.1)
            break
        except subprocess.TimeoutExpired:
            continue
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
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    reconstruct_frequency_loss: bool = False,
    _method_override: Optional[str] = None,
    _recovery: Optional[RecoveryCoordinator] = None,
    expected_category: Optional[str] = None,
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
        try:
            from .paths import APP_DATA_DIR
            ev_path = os.path.join(APP_DATA_DIR, "recovery-evidence.json")
        except Exception:
            ev_path = None
        _recovery = RecoveryCoordinator(OutputIntent(
            target_format=target_format, quality=bitrate, sample_rate=sample_rate,
            resolution=resolution, normalize_audio=normalize_audio, fps=fps,
            cover_required=bool(cover_path),
            gpu_allowed=bool((use_gpu if use_gpu is not None else use_nvenc)
                             and target_format in HARDWARE_VIDEO_FORMATS),
            allow_png_fallback=allow_lossless_png_recovery,
            metadata=tuple((key, value) for key, value in (metadata or {}).items() if value),
            start_time=start_time,
            end_time=end_time,
            reconstruct_frequency_loss=reconstruct_frequency_loss,
            expected_category=expected_category,
        ), evidence_path=ev_path)

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

        # Probe input to understand stream topology and preserve audio streams natively
        probe = probe_media_streams(input_path) or {}
        streams = probe.get("streams", [])
        has_video = any(s.get("codec_type") == "video" for s in streams)
        has_audio = any(s.get("codec_type") == "audio" for s in streams)
        audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
        is_audio_context = bool(
            (expected_category and str(expected_category).lower() in ("audio", "music"))
            or (has_audio and not has_video and actual_ext not in SUPPORTED_IMAGE_FORMATS)
        )

        preferred_ext = actual_ext
        if is_audio_context and has_audio and audio_stream:
            codec_name = (audio_stream.get("codec_name") or "").lower()
            codec_to_ext = {
                "opus": "opus",
                "vorbis": "ogg",
                "flac": "flac",
                "aac": "m4a",
                "alac": "m4a",
                "mp3": "mp3",
                "pcm_s16le": "wav",
                "pcm_s24le": "wav",
                "pcm_f32le": "wav",
            }
            if actual_ext in {"webm", "mkv", "matroska", "weba", "mka", "mp4", "m4v", "ts"}:
                preferred_ext = codec_to_ext.get(codec_name, actual_ext)

        raw_stem, raw_ext = os.path.splitext(output_filename)
        if raw_ext.lower() in KNOWN_MEDIA_EXTENSIONS or raw_ext.lower() in {f".{actual_ext}", f".{preferred_ext}"}:
            stem = raw_stem
        else:
            stem = output_filename
        dest_filename = f"{stem}.{preferred_ext}" if not output_filename.lower().endswith(f".{preferred_ext}") else output_filename
        destination_path = get_unique_target_path(output_dir, dest_filename)

        remux_succeeded = False
        if preferred_ext != actual_ext or start_time or end_time:
            report_raw(0.70, f"Preserving source quality: exporting raw {preferred_ext.upper()} stream without re-encoding...")
            cmd = [get_ffmpeg_binary(), "-y", "-hide_banner", "-loglevel", "error"]
            if start_time:
                cmd.extend(["-ss", start_time])
            if end_time:
                cmd.extend(["-to", end_time])
            cmd.extend(["-i", input_path])
            if is_audio_context:
                cmd.extend(["-vn", "-c:a", "copy"])
            else:
                cmd.extend(["-c", "copy"])
            cmd.extend(["-threads", "0", destination_path])
            res = subprocess.run(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                timeout=300,
            )
            if res.returncode == 0 and os.path.isfile(destination_path) and os.path.getsize(destination_path) > 0:
                actual_ext = preferred_ext
                remux_succeeded = True
            elif start_time or end_time:
                raise RuntimeError(f"FFmpegProcessError: lossless stream trim failed: {res.stderr.decode('utf-8', errors='replace')}")

        if not remux_succeeded and actual_ext != preferred_ext:
            # Fallback to pristine copy with original extension
            dest_filename = f"{stem}.{actual_ext}" if not output_filename.lower().endswith(f".{actual_ext}") else output_filename
            destination_path = get_unique_target_path(output_dir, dest_filename)

        if not remux_succeeded:
            report_raw(0.70, f"Preserving source quality: keeping raw {actual_ext.upper()} stream without re-encoding...")
            if os.path.abspath(input_path) != os.path.abspath(destination_path):
                shutil.copy2(input_path, destination_path)

        validate_output_file(
            destination_path,
            actual_ext,
            require_video=False if is_audio_context else (True if has_video else None),
        )
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
        reconstruct_frequency_loss=reconstruct_frequency_loss,
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
            start_time=start_time,
            end_time=end_time,
        )
    else:
        measured_loudness = None
        if normalize_audio and os.path.isfile(input_path):
            report(0.68, "Analyzing audio loudness dynamics (linear EBU R128 pass)...")
            measured_loudness = measure_audio_loudness(
                input_path,
                ffmpeg_bin=ffmpeg_bin,
                sample_rate=sample_rate,
                input_sample_rate=input_sample_rate,
                start_time=start_time,
                end_time=end_time,
                reconstruct_frequency_loss=reconstruct_frequency_loss,
                abort_event=abort_event,
            )

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
            start_time=start_time,
            end_time=end_time,
            reconstruct_frequency_loss=reconstruct_frequency_loss,
        )
    # Request machine-readable progress on stdout (inserted before the output path)
    cmd = cmd[:-1] + ["-progress", "pipe:1", "-nostats"] + [cmd[-1]]
    active_cmd = list(cmd)
    command_adapted = False

    no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    try:
        while True:
            proc = subprocess.Popen(
                active_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=no_window
            )

            stderr_chunks = []

            def read_stderr():
                try:
                    stderr_chunks.append(proc.stderr.read())
                except (OSError, ValueError):
                    pass

            duration = probe_media_duration(input_path)
            if duration and duration > 0:
                s_sec = parse_time_offset_seconds(start_time) if start_time else None
                e_sec = parse_time_offset_seconds(end_time) if end_time else None
                effective_start = max(0.0, s_sec) if s_sec is not None else 0.0
                effective_end = min(duration, e_sec) if e_sec is not None else duration
                if effective_end > effective_start:
                    duration = effective_end - effective_start
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
                except (OSError, ValueError):
                    pass

            reader_thread = threading.Thread(target=read_stderr, daemon=True)
            reader_thread.start()
            progress_thread = threading.Thread(target=read_progress, daemon=True)
            progress_thread.start()

            while proc.poll() is None:
                if abort_event and abort_event.is_set():
                    proc.kill()
                    proc.wait()
                    reader_thread.join(timeout=1.0)
                    progress_thread.join(timeout=1.0)
                    if os.path.exists(destination_path):
                        try:
                            os.remove(destination_path)
                        except OSError:
                            pass
                    raise KeyboardInterrupt("Conversion aborted by user.")
                attempt_elapsed = time.monotonic() - _recovery.attempts[-1].started_at if _recovery.attempts else 0.0
                total_elapsed = time.monotonic() - _recovery.started_at
                is_stalled = (
                    attempt_elapsed > STRATEGIES[method].max_seconds
                    or (len(_recovery.attempts) > 1 and total_elapsed > _recovery.max_recovery_seconds)
                )
                if is_stalled:
                    proc.kill()
                    proc.wait()
                    reader_thread.join(timeout=1.0)
                    progress_thread.join(timeout=1.0)
                    if os.path.exists(destination_path):
                        try:
                            os.remove(destination_path)
                        except OSError:
                            pass
                    raise RuntimeError("Conversion recovery stopped at its time limit.")
                time.sleep(0.05)

            proc.wait()
            reader_thread.join(timeout=2.0)
            progress_thread.join(timeout=2.0)
            stderr = stderr_chunks[0] if stderr_chunks else b""

            if proc.returncode == 0:
                if normalize_audio:
                    text = stderr.decode("utf-8", errors="replace") if isinstance(stderr, bytes) else str(stderr)
                    modes = re.findall(r'"normalization_type"\s*:\s*"(linear|dynamic)"', text, re.I)
                    mode = modes[-1].lower() if modes else "unconfirmed"
                    report(0.99, f"Normalization mode: {mode}." + (" FFmpeg used dynamic processing to meet the loudness and peak targets." if mode == "dynamic" else ""))
                break

            if not command_adapted:
                adapted = adapt_ffmpeg_command(active_cmd, stderr)
                if adapted is not None and adapted != active_cmd:
                    if os.path.exists(destination_path):
                        try:
                            os.remove(destination_path)
                        except OSError:
                            pass
                    report(0.72, "Adaptive JIT Recovery: Rewriting command parameters to resolve runtime flag incompatibility...")
                    active_cmd = adapted
                    command_adapted = True
                    continue

            raise subprocess.CalledProcessError(proc.returncode, active_cmd, output=b"", stderr=stderr)

    except KeyboardInterrupt:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
            reader_thread.join(timeout=1.0)
            progress_thread.join(timeout=1.0)
        if os.path.exists(destination_path):
            try:
                os.remove(destination_path)
            except OSError:
                pass
        raise

    except subprocess.CalledProcessError as e:
        # Clean up the partial output so retries don't leave orphaned truncated files
        if os.path.exists(destination_path):
            try:
                os.remove(destination_path)
            except OSError:
                pass

        failure = FailureEvidence.ffmpeg(e.stderr)
        category = failure.category

        try:
            from .paths import APP_DATA_DIR
            triggering_cat = (
                _recovery.attempts[0].result
                if _recovery and len(_recovery.attempts) > 1 and _recovery.attempts[0].result is not None
                else category
            )
            record_local_failure(
                os.path.join(APP_DATA_DIR, "recovery-evidence.json"),
                target=target_format,
                failed_method=method,
                category=triggering_cat,
            )
        except OSError:
            pass

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
                        start_time=start_time, end_time=end_time,
                        reconstruct_frequency_loss=reconstruct_frequency_loss,
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
                start_time=start_time,
                end_time=end_time,
                reconstruct_frequency_loss=reconstruct_frequency_loss,
                _recovery=_recovery,
            )
        try:
            from .paths import APP_DATA_DIR
            quarantine_failure(
                os.path.join(APP_DATA_DIR, "quarantine"),
                _recovery,
                diagnostic=f"{method} failed ({category.value})"
            )
        except OSError:
            pass
        raise RuntimeError(f"FFmpegProcessError: {method} failed ({category.value}); no policy-safe recovery remains.") from e

    try:
        validate_output_file(destination_path, target_format)
    except Exception as val_err:
        if os.path.exists(destination_path):
            try:
                os.remove(destination_path)
            except OSError:
                pass
        raise RuntimeError(f"Output validation error: {val_err}") from val_err

    if len(_recovery.attempts) > 1:
        report(1.0, f"Conversion complete using {method} after bounded recovery: {os.path.basename(destination_path)}")
    else:
        report(1.0, f"Conversion complete: {os.path.basename(destination_path)}")
    return destination_path


def cleanup_stale_staging_directories(directory: str, max_age_seconds: float = 86400.0) -> int:
    """Remove orphaned .janeconverter-convert-* temporary staging folders older than max_age_seconds."""
    if not os.path.isdir(directory):
        return 0
    cleaned = 0
    now = time.time()
    try:
        for entry in os.scandir(directory):
            if entry.is_dir() and entry.name.startswith(".janeconverter-convert-"):
                try:
                    mtime = entry.stat().st_mtime
                    if (now - mtime) >= max_age_seconds:
                        shutil.rmtree(entry.path, ignore_errors=True)
                        cleaned += 1
                except OSError:
                    pass
    except OSError:
        pass
    return cleaned


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
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    reconstruct_frequency_loss: bool = False,
    _method_override: Optional[str] = None,
    _recovery: Optional[RecoveryCoordinator] = None,
    expected_category: Optional[str] = None,
) -> str:
    """Stage and validate every attempt before publishing one completed output."""
    os.makedirs(output_dir, exist_ok=True)
    start_time = sanitize_time_offset(start_time)
    end_time = sanitize_time_offset(end_time)
    if _recovery is None:
        try:
            from .paths import APP_DATA_DIR
            ev_path = os.path.join(APP_DATA_DIR, "recovery-evidence.json")
        except Exception:
            ev_path = None
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
            start_time=start_time,
            end_time=end_time,
            reconstruct_frequency_loss=reconstruct_frequency_loss,
            expected_category=expected_category,
        ), evidence_path=ev_path)

    cleanup_stale_staging_directories(output_dir)

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
            start_time=start_time, end_time=end_time,
            reconstruct_frequency_loss=reconstruct_frequency_loss,
            expected_category=expected_category,
        )
        effective_target = target_format.lower().strip(".")
        try:
            staged_path = _convert_media_impl(
                **common, target_format=target_format, allow_stream_copy=allow_stream_copy,
                allow_lossless_png_recovery=allow_lossless_png_recovery,
                _method_override=_method_override, _recovery=_recovery,
            )
        except RuntimeError as error:
            staged_path = None
            if (
                allow_lossless_png_recovery
                and effective_target in {"source", "original", ""}
                and str(error).startswith("ValidationFailed:")
            ):
                from PIL import Image
                try:
                    with Image.open(input_path) as image:
                        if getattr(image, "n_frames", 1) != 1:
                            raise ValueError("animated input")
                        image.verify()
                    failure = FailureEvidence("source-validation", FailureCategory.VALIDATION, True, "image:source-validation")
                    if _recovery.next_method(failure) == "image-png":
                        _recovery.start("image-png")
                        effective_target = "png"
                        png_recovery = RecoveryCoordinator(replace(
                            _recovery.intent, target_format="png", allow_png_fallback=False,
                        ), evidence_path=_recovery.evidence_path)
                        staged_path = _convert_media_impl(
                            **common, target_format="png", allow_stream_copy=False,
                            allow_lossless_png_recovery=False, _recovery=png_recovery,
                        )
                except (OSError, ValueError):
                    pass

            if staged_path is None:
                probe = probe_media_streams(input_path) or {}
                streams = probe.get("streams", [])
                has_audio = any(s.get("codec_type") == "audio" for s in streams)
                has_video = any(s.get("codec_type") == "video" for s in streams)
                is_audio_context = bool(
                    (expected_category and str(expected_category).lower() in ("audio", "music"))
                    or (has_audio and not has_video)
                )
                if effective_target in {"source", "original", ""} and is_audio_context and has_audio:
                    audio_target = "flac"
                    staged_progress(0.72, f"Preserve Quality fallback: raw stream preservation failed ({error}). Transcoding to lossless {audio_target.upper()}...")
                    failure = FailureEvidence("source-validation", FailureCategory.VALIDATION, True, "audio:source-validation")
                    _recovery.start("audio-transcode")
                    audio_recovery = RecoveryCoordinator(replace(
                        _recovery.intent, target_format=audio_target, allow_png_fallback=False,
                    ), evidence_path=_recovery.evidence_path)
                    staged_path = _convert_media_impl(
                        **common, target_format=audio_target, allow_stream_copy=False,
                        allow_lossless_png_recovery=False, _recovery=audio_recovery,
                    )
                    effective_target = audio_target
                else:
                    raise error
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
