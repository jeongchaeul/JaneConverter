"""
Audio DSP, EBU R128 loudness normalization, and resampling subsystem for JaneConverter.
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
from typing import Any, Dict, Optional

from .binaries import get_ffmpeg_binary
from .constants import LOUDNORM_FILTER, sanitize_time_offset

def build_loudnorm_filter(measured: Optional[Dict[str, str]] = None) -> str:
    """
    Builds the EBU R128 loudnorm filter.
    Pass 1 measurements configure linear normalization (linear=true).
    Dynamically adapts target LRA and target I when necessary to guarantee
    that FFmpeg operates in transparent linear gain mode without falling back
    to dynamic AGC compression or clipping past the True Peak ceiling.
    """
    keys = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
    try:
        valid = bool(measured and all(math.isfinite(float(measured[key])) for key in keys))
    except (KeyError, ValueError, TypeError):
        valid = False
    if valid:
        measured_i = float(measured["input_i"])
        measured_tp = float(measured["input_tp"])
        measured_lra = float(measured["input_lra"])

        target_i = -14.0
        target_tp = -1.5

        # FFmpeg loudnorm requires measured_lra <= target_lra to stay in linear mode.
        # If input LRA exceeds 11, expand target LRA so high-dynamic-range tracks
        # are not forced into dynamic AGC compression.
        target_lra = max(11.0, round(measured_lra + 0.1, 2))

        # FFmpeg loudnorm requires measured_tp + (target_i - measured_i) <= target_tp
        # to stay in linear mode. If applying full gain would breach the True Peak ceiling,
        # cap the target integrated loudness so maximum safe linear gain is applied
        # without triggering dynamic compression pumping or clipping.
        gain = target_i - measured_i
        if measured_tp + gain > target_tp:
            max_safe_gain = (target_tp - 0.05) - measured_tp
            target_i = round(measured_i + max_safe_gain, 2)

        target_i_str = f"{target_i:.2f}" if target_i != -14.0 else "-14"
        target_lra_str = f"{target_lra:.2f}" if target_lra != 11.0 else "11"

        # Edge case: af_loudnorm.c requires measured_lra != 0 to enter linear mode
        measured_lra_str = f"{max(0.1, measured_lra):.2f}" if measured_lra <= 0.0 else measured["input_lra"]

        return (
            f"loudnorm=I={target_i_str}:TP={target_tp:.1f}:LRA={target_lra_str}"
            f":measured_I={measured['input_i']}"
            f":measured_TP={measured['input_tp']}"
            f":measured_LRA={measured_lra_str}"
            f":measured_thresh={measured['input_thresh']}"
            f":offset={measured['target_offset']}"
            f":linear=true:print_format=json"
        )
    return LOUDNORM_FILTER + ":print_format=json"


def measure_audio_loudness(
    input_path: str,
    ffmpeg_bin: Optional[str] = None,
    sample_rate: Optional[int] = None,
    input_sample_rate: Optional[int] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    reconstruct_frequency_loss: bool = False,
    abort_event: Optional[Any] = None,
) -> Optional[Dict[str, str]]:
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

    filters = []
    source_rate_matches = (
        input_sample_rate is not None
        and sample_rate
        and int(input_sample_rate) == int(sample_rate)
    )
    if sample_rate and not source_rate_matches and has_soxr_support():
        filters.append("aresample=resampler=soxr:precision=28:cutoff=0.99:dither_method=triangular")
    if reconstruct_frequency_loss:
        filters.append("aexciter=freq=7500:ceil=20000:amount=2.5:drive=8.5:blend=0")
    filters.append("loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json")

    cmd = [ffmpeg, "-hide_banner", "-nostats"]
    safe_start = sanitize_time_offset(start_time) if start_time else None
    safe_end = sanitize_time_offset(end_time) if end_time else None
    if safe_start:
        cmd.extend(["-ss", safe_start])
    if safe_end:
        cmd.extend(["-to", safe_end])
    cmd.extend([
        "-i", input_path,
        "-vn", "-sn",
        "-af", ",".join(filters),
    ])
    if sample_rate:
        cmd.extend(["-ar", str(sample_rate)])
    cmd.extend(["-f", "null", "-"])
    no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        if abort_event is not None:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=no_window,
            )
            start_t = time.time()
            while True:
                if abort_event.is_set():
                    proc.kill()
                    proc.wait()
                    return None
                ret = proc.poll()
                if ret is not None:
                    break
                if time.time() - start_t > 300:
                    proc.kill()
                    proc.wait()
                    return None
                time.sleep(0.05)
            _, stderr_bytes = proc.communicate()
            stderr_text = stderr_bytes.decode("utf-8", errors="ignore")
        else:
            res = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=no_window,
                timeout=300,
            )
            stderr_text = res.stderr.decode("utf-8", errors="ignore")
        json_match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', stderr_text, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            return {
                "input_i": str(data.get("input_i", "-14")),
                "input_tp": str(data.get("input_tp", "-1.5")),
                "input_lra": str(data.get("input_lra", "11")),
                "input_thresh": str(data.get("input_thresh", "-24")),
                "target_offset": str(data.get("target_offset", "0")),
            }
    except (subprocess.SubprocessError, json.JSONDecodeError, ValueError, OSError):
        pass
    return None


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

