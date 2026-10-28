"""
Hardware GPU acceleration discovery and encoder selection subsystem for JaneConverter.
Provides NVENC, AMF, Quick Sync, and VAAPI encoder probing and quality profiles.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
from typing import Any, Dict, Optional

from .binaries import get_ffmpeg_binary
from .constants import VAAPI_ENCODER_ARGS, VIDEO_QUALITY_SETTINGS

_encoder_cache: Dict[Optional[str], Dict[str, Any]] = {}
_encoder_cache_lock = threading.Lock()
_gpu_probe_cache: Dict[str, bool] = {}
_gpu_probe_lock = threading.Lock()

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
                            except OSError:
                                pass
                    except OSError:
                        break
        except OSError:
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
        except (OSError, subprocess.SubprocessError):
            pass

    elif sys.platform == "darwin":
        try:
            no_win = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            res = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=2.0, creationflags=no_win)
            if res.returncode == 0 and "apple" in res.stdout.lower():
                gpus.append(f"{res.stdout.strip()} (GPU)")
        except (OSError, subprocess.SubprocessError):
            pass
        if not gpus:
            gpus.append("Apple Silicon GPU")

    return gpus

_probed_hardware_encoders: Dict[str, bool] = {}
_hw_probe_lock = threading.Lock()

def probe_hardware_encoder(encoder: str) -> bool:
    """
    Probes if a hardware encoder can initialize on local hardware without failing.
    Results are cached in memory for the active session.
    """
    if not encoder or encoder.startswith("lib"):
        return True
    if os.environ.get("JANECONVERTER_SKIP_HW_PROBE"):
        return True
    with _hw_probe_lock:
        if encoder in _probed_hardware_encoders:
            return _probed_hardware_encoders[encoder]
    ffmpeg_bin = get_ffmpeg_binary()
    if not shutil.which(ffmpeg_bin):
        return False
    cmd = [
        ffmpeg_bin, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=s=32x32:d=0.04",
        "-c:v", encoder, "-frames:v", "1", "-f", "null", "-",
    ]
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=1.5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        is_ok = (res.returncode == 0)
    except (subprocess.SubprocessError, OSError):
        is_ok = False
    with _hw_probe_lock:
        _probed_hardware_encoders[encoder] = is_ok
    return is_ok

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
        elif preferred_codec == "av1_nvenc":
            return {
                "has_gpu": True, "vendor": "nvidia", "gpu_name": "NVIDIA GPU", "short_name": "NVIDIA",
                "encoder": "av1_nvenc", "encoder_label": "NVIDIA AV1 NVENC",
                "args": ["-c:v", "av1_nvenc", "-preset", "p4", "-cq", "28", "-b:v", "0", "-pix_fmt", "yuv420p"]
            }
        elif preferred_codec == "h264_amf":
            return {
                "has_gpu": True, "vendor": "amd", "gpu_name": "AMD Radeon GPU", "short_name": "AMD",
                "encoder": "h264_amf", "encoder_label": "AMD AMF",
                "args": ["-c:v", "h264_amf", "-quality", "speed", "-pix_fmt", "yuv420p"]
            }
        elif preferred_codec == "av1_amf":
            return {
                "has_gpu": True, "vendor": "amd", "gpu_name": "AMD Radeon GPU", "short_name": "AMD",
                "encoder": "av1_amf", "encoder_label": "AMD AV1 AMF",
                "args": ["-c:v", "av1_amf", "-quality", "speed", "-pix_fmt", "yuv420p"]
            }
        elif preferred_codec == "h264_qsv":
            return {
                "has_gpu": True, "vendor": "intel", "gpu_name": "Intel GPU", "short_name": "Intel",
                "encoder": "h264_qsv", "encoder_label": "Intel Quick Sync",
                "args": ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "23", "-pix_fmt", "nv12"]
            }
        elif preferred_codec == "av1_qsv":
            return {
                "has_gpu": True, "vendor": "intel", "gpu_name": "Intel GPU", "short_name": "Intel",
                "encoder": "av1_qsv", "encoder_label": "Intel Quick Sync AV1",
                "args": ["-c:v", "av1_qsv", "-preset", "veryfast", "-global_quality", "28", "-pix_fmt", "nv12"]
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
        elif preferred_codec in ("libsvtav1", "libaom-av1"):
            return {
                "has_gpu": False, "vendor": "cpu", "gpu_name": "Multi-Core CPU", "short_name": "CPU Mode",
                "encoder": "libsvtav1", "encoder_label": "CPU SVT-AV1",
                "args": ["-c:v", "libsvtav1", "-preset", "6", "-crf", "28", "-pix_fmt", "yuv420p"]
            }
        elif preferred_codec == "libx264":
            return {
                "has_gpu": False, "vendor": "cpu", "gpu_name": "Multi-Core CPU", "short_name": "CPU Mode",
                "encoder": "libx264", "encoder_label": "CPU Multi-Core",
                "args": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p"]
            }
        elif preferred_codec == "av1":
            gpus = get_host_gpus()
            has_nvidia = any(any(k in g.lower() for k in ["nvidia", "geforce", "quadro", "rtx", "gtx", "tesla"]) for g in gpus)
            has_amd = any(any(k in g.lower() for k in ["amd", "radeon"]) for g in gpus)
            has_intel = any(any(k in g.lower() for k in ["intel", "arc", "iris", "uhd"]) for g in gpus)
            if has_nvidia and probe_hardware_encoder("av1_nvenc"):
                gpu_name = next((g for g in gpus if any(k in g.lower() for k in ["nvidia", "geforce", "quadro", "rtx", "gtx", "tesla"])), "NVIDIA GPU")
                short = gpu_name.replace("NVIDIA ", "").replace("GeForce ", "").strip()
                return {
                    "has_gpu": True, "vendor": "nvidia", "gpu_name": gpu_name, "short_name": short,
                    "encoder": "av1_nvenc", "encoder_label": "NVIDIA AV1 NVENC",
                    "args": ["-c:v", "av1_nvenc", "-preset", "p4", "-cq", "28", "-b:v", "0", "-pix_fmt", "yuv420p"]
                }
            if has_amd and sys.platform == "win32" and probe_hardware_encoder("av1_amf"):
                gpu_name = next((g for g in gpus if any(k in g.lower() for k in ["amd", "radeon"])), "AMD Radeon GPU")
                short = gpu_name.replace("AMD ", "").replace("Radeon(TM) ", "Radeon ").replace("Graphics", "").strip() or "Radeon"
                return {
                    "has_gpu": True, "vendor": "amd", "gpu_name": gpu_name, "short_name": short,
                    "encoder": "av1_amf", "encoder_label": "AMD AV1 AMF",
                    "args": ["-c:v", "av1_amf", "-quality", "speed", "-pix_fmt", "yuv420p"]
                }
            if has_intel and probe_hardware_encoder("av1_qsv"):
                gpu_name = next((g for g in gpus if any(k in g.lower() for k in ["intel", "arc", "iris", "uhd"])), "Intel GPU")
                short = gpu_name.replace("Intel(R) ", "").replace("Graphics", "").strip() or "Intel HD/Arc"
                return {
                    "has_gpu": True, "vendor": "intel", "gpu_name": gpu_name, "short_name": short,
                    "encoder": "av1_qsv", "encoder_label": "Intel Quick Sync AV1",
                    "args": ["-c:v", "av1_qsv", "-preset", "veryfast", "-global_quality", "28", "-pix_fmt", "nv12"]
                }
            return {
                "has_gpu": False, "vendor": "cpu", "gpu_name": "Multi-Core CPU", "short_name": "CPU Mode",
                "encoder": "libsvtav1", "encoder_label": "CPU SVT-AV1",
                "args": ["-c:v", "libsvtav1", "-preset", "6", "-crf", "28", "-pix_fmt", "yuv420p"]
            }

    gpus = get_host_gpus()
    has_nvidia = any(any(k in g.lower() for k in ["nvidia", "geforce", "quadro", "rtx", "gtx", "tesla"]) for g in gpus)
    has_amd = any(any(k in g.lower() for k in ["amd", "radeon"]) for g in gpus)
    has_intel = any(any(k in g.lower() for k in ["intel", "arc", "iris", "uhd"]) for g in gpus)
    has_apple = (sys.platform == "darwin")

    # Priority 1: NVIDIA GPU (NVENC)
    if has_nvidia and probe_hardware_encoder("h264_nvenc"):
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
        if probe_hardware_encoder(encoder):
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
    if has_intel and probe_hardware_encoder("h264_qsv"):
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
    elif encoder == "av1_qsv":
        crf_val = {"best": "20", "high": "24", "balanced": "28", "small": "34"}.get((quality_name or "").lower(), "28")
        replace_value("-global_quality", crf_val)
    elif encoder == "h264_vaapi":
        replace_value("-qp", crf)
    elif encoder == "h264_amf":
        replace_value("-quality", {
            "best": "quality",
            "high": "quality",
            "balanced": "balanced",
            "small": "speed",
        }.get((quality_name or "").lower(), "balanced"))
    elif encoder == "av1_amf":
        replace_value("-quality", {
            "best": "quality",
            "high": "quality",
            "balanced": "balanced",
            "small": "speed",
        }.get((quality_name or "").lower(), "balanced"))
    elif encoder == "av1_nvenc":
        quality_name = (quality_name or "").lower()
        nvenc_preset = {"best": "p7", "high": "p5", "balanced": "p4", "small": "p2"}.get(quality_name, "p4")
        cq_val = {"best": "20", "high": "24", "balanced": "28", "small": "34"}.get(quality_name, "28")
        return [
            "-c:v", "av1_nvenc", "-preset", nvenc_preset,
            "-rc:v", "vbr", "-cq", cq_val, "-b:v", "0",
            "-spatial-aq", "1", "-temporal-aq", "1", "-pix_fmt", "yuv420p"
        ]
    elif encoder == "libsvtav1":
        preset = {"best": "4", "high": "5", "balanced": "6", "small": "8"}.get((quality_name or "").lower(), "6")
        crf_val = {"best": "20", "high": "24", "balanced": "28", "small": "34"}.get((quality_name or "").lower(), "28")
        return ["-c:v", "libsvtav1", "-preset", preset, "-crf", crf_val, "-pix_fmt", "yuv420p"]
    elif encoder == "h264_videotoolbox":
        replace_value("-q:v", {
            "best": "75",
            "high": "65",
            "balanced": "55",
            "small": "40",
        }.get((quality_name or "").lower(), "55"))

    return args


