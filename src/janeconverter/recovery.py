"""Bounded, policy-aware selection of local conversion recovery methods."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import json
import os
import re
import tempfile
import time


class FailureCategory(str, Enum):
    TRANSIENT_IO = "transient_io"
    CONTAINER = "container"
    HARDWARE = "hardware"
    ARTWORK = "artwork"
    DECODER = "decoder"
    ENCODER = "encoder"
    PERMISSION = "permission"
    RESOURCE = "resource"
    INVALID_INPUT = "invalid_input"
    VALIDATION = "validation"
    UNKNOWN = "unknown"


class IntentMode(str, Enum):
    SOURCE_PRESERVING = "source-preserving"
    LOSSLESS_ENCODING = "lossless-encoding"
    TARGET_FORMAT = "target-format"


@dataclass(frozen=True)
class OutputIntent:
    target_format: str
    quality: str
    sample_rate: int
    resolution: str
    normalize_audio: bool
    fps: int | None
    cover_required: bool
    gpu_allowed: bool
    allow_png_fallback: bool = False
    metadata: tuple[tuple[str, str], ...] = ()

    @property
    def mode(self) -> IntentMode:
        if self.target_format in {"source", "original", ""}:
            return IntentMode.SOURCE_PRESERVING
        if self.target_format in {"wav", "flac", "alac", "aiff", "aif", "caf", "au",
                                  "png", "bmp", "tif", "tiff", "ppm", "pgm", "pbm"}:
            return IntentMode.LOSSLESS_ENCODING
        return IntentMode.TARGET_FORMAT


@dataclass(frozen=True)
class Attempt:
    method: str
    result: FailureCategory | None = None
    started_at: float = field(default_factory=time.monotonic)


@dataclass(frozen=True)
class FailureEvidence:
    stage: str
    category: FailureCategory
    retryable: bool
    diagnostic: str

    @classmethod
    def ffmpeg(cls, stderr: bytes | str | None) -> "FailureEvidence":
        category = classify_ffmpeg_failure(stderr)
        return cls(
            stage="ffmpeg", category=category,
            retryable=category in {
                FailureCategory.CONTAINER,
                FailureCategory.HARDWARE,
                FailureCategory.ARTWORK,
                FailureCategory.ENCODER,
                FailureCategory.UNKNOWN,
            },
            diagnostic=f"ffmpeg:{category.value}",
        )


@dataclass(frozen=True)
class Strategy:
    name: str
    media: str
    output_change: str
    validator: str
    after: tuple[tuple[str, FailureCategory], ...] = ()
    max_seconds: int = 1800


STRATEGIES = {
    "source-preserve": Strategy("source-preserve", "any", "none", "source-probe"),
    "image-pillow": Strategy("image-pillow", "image", "none", "pillow-contract"),
    "image-ffmpeg-frame": Strategy("image-ffmpeg-frame", "image", "none", "pillow-contract",
                                    (("image-pillow", FailureCategory.DECODER),)),
    "image-png": Strategy("image-png", "image", "png", "pillow-contract",
                          (("source-preserve", FailureCategory.VALIDATION),)),
    "stream-copy": Strategy("stream-copy", "audio-video", "none", "ffprobe-contract"),
    "gpu-transcode": Strategy("gpu-transcode", "video", "none", "ffprobe-contract",
                              (("stream-copy", FailureCategory.CONTAINER),)),
    "cpu-transcode": Strategy("cpu-transcode", "audio-video", "none", "ffprobe-contract",
                              (("stream-copy", FailureCategory.CONTAINER),
                               ("gpu-transcode", FailureCategory.HARDWARE),
                               ("gpu-transcode", FailureCategory.ENCODER),
                               ("gpu-transcode", FailureCategory.UNKNOWN))),
    "cover-normalized": Strategy("cover-normalized", "audio", "none", "ffprobe-contract",
                                 (("cpu-transcode", FailureCategory.ARTWORK),
                                  ("gpu-transcode", FailureCategory.ARTWORK))),
}


def classify_ffmpeg_failure(stderr: bytes | str | None) -> FailureCategory:
    """Classify a process failure without retaining paths, URLs, or raw stderr."""
    value = stderr.decode("utf-8", errors="ignore") if isinstance(stderr, bytes) else (stderr or "")
    value = "\n".join(
        line for line in value.lower().splitlines()
        if not line.lstrip().startswith(("configuration:", "built with "))
    )
    if any(word in value for word in ("permission denied", "access is denied", "operation not permitted")):
        return FailureCategory.PERMISSION
    if any(word in value for word in ("no space left", "disk full", "out of memory", "cannot allocate memory")):
        return FailureCategory.RESOURCE
    if any(word in value for word in ("invalid data found", "could not find codec parameters", "moov atom not found")):
        return FailureCategory.INVALID_INPUT
    if any(word in value for word in ("connection reset", "connection timed out", "temporary failure", "i/o error")):
        return FailureCategory.TRANSIENT_IO
    if any(word in value for word in ("attached picture", "cover art", "album art", "attached_pic")):
        return FailureCategory.ARTWORK
    if any(word in value for word in ("nvenc", "vaapi", "videotoolbox", "qsv", "amf", "hardware device", "no capable devices", "cuda", "cuinit", "nvcuda")):
        return FailureCategory.HARDWARE
    if any(word in value for word in ("not supported in container", "could not write header", "tag ", "incorrect codec parameters")) or ("codec" in value and "not supported" in value):
        return FailureCategory.CONTAINER
    if any(word in value for word in ("unknown encoder", "encoder not found", "error while opening encoder", "unrecognized option", "option not found")):
        return FailureCategory.ENCODER
    if any(word in value for word in ("error while decoding", "decoder not found")):
        return FailureCategory.DECODER
    return FailureCategory.UNKNOWN


@dataclass
class RecoveryCoordinator:
    intent: OutputIntent
    attempts: list[Attempt] = field(default_factory=list)
    max_attempts: int = 3
    max_recovery_seconds: int = 1800
    started_at: float = field(default_factory=time.monotonic)

    def start(self, method: str) -> None:
        if self.attempts and time.monotonic() - self.started_at > self.max_recovery_seconds:
            raise RuntimeError("Conversion recovery stopped at its time limit.")
        strategy = STRATEGIES.get(method)
        if strategy is None:
            raise RuntimeError("Conversion recovery method is unsupported.")
        if strategy.output_change == "png" and not self.intent.allow_png_fallback:
            raise RuntimeError("A PNG format change requires the user's recovery choice.")
        if len(self.attempts) >= self.max_attempts or any(item.method == method for item in self.attempts):
            raise RuntimeError("Conversion recovery stopped before repeating a method.")
        self.attempts.append(Attempt(method))

    def next_method(self, failure: FailureEvidence | FailureCategory) -> str | None:
        if not self.attempts:
            return None
        evidence = failure if isinstance(failure, FailureEvidence) else FailureEvidence(
            stage="conversion", category=failure, retryable=True,
            diagnostic=f"conversion:{failure.value}",
        )
        category = evidence.category
        current = self.attempts[-1].method
        self.attempts[-1] = Attempt(current, category, self.attempts[-1].started_at)
        if not evidence.retryable:
            return None
        if len(self.attempts) >= self.max_attempts or time.monotonic() - self.started_at > self.max_recovery_seconds:
            return None
        for candidate, strategy in STRATEGIES.items():
            if (current, category) not in strategy.after:
                continue
            if candidate == "gpu-transcode" and not self.intent.gpu_allowed:
                continue
            if candidate == "image-png" and not self.intent.allow_png_fallback:
                continue
            if candidate == "cover-normalized" and (
                not self.intent.cover_required
                or self.intent.target_format not in {"mp3", "flac", "m4a", "aac"}
            ):
                continue
            if not any(item.method == candidate for item in self.attempts):
                return candidate
        return None


def record_local_success(path: str, coordinator: RecoveryCoordinator) -> None:
    """Keep bounded structural success counts without any source or media data."""
    if len(coordinator.attempts) < 2:
        return
    target = coordinator.intent.target_format
    if not re.fullmatch(r"[a-z0-9]{2,6}", target):
        return
    first = coordinator.attempts[0]
    final = coordinator.attempts[-1]
    if first.result is None or final.method not in {"cpu-transcode", "gpu-transcode", "cover-normalized", "image-ffmpeg-frame", "image-png"}:
        return
    key = f"{target}|{first.result.value}|{final.method}"
    entries = {}
    try:
        if os.path.getsize(path) > 65_536:
            raise ValueError("oversized recovery evidence")
        with open(path, "r", encoding="utf-8") as source:
            previous = json.load(source)
        if previous.get("version") == 1 and isinstance(previous.get("entries"), dict):
            entries = {
                item_key: {
                    "count": min(999, max(0, item_value["count"])),
                    "updated": max(0, item_value["updated"]),
                }
                for item_key, item_value in previous["entries"].items()
                if re.fullmatch(r"[a-z0-9]{2,6}\|[a-z_]+\|(?:cpu-transcode|gpu-transcode|cover-normalized|image-ffmpeg-frame|image-png)", item_key)
                and isinstance(item_value, dict)
                and isinstance(item_value.get("count"), int)
                and isinstance(item_value.get("updated"), int)
            }
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    now = int(time.time())
    entries[key] = {"count": min(999, entries.get(key, {}).get("count", 0) + 1), "updated": now}
    entries = dict(sorted(entries.items(), key=lambda item: item[1]["updated"], reverse=True)[:64])
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=directory, delete=False) as temporary:
        json.dump({"version": 1, "entries": entries}, temporary, separators=(",", ":"))
        temporary_path = temporary.name
    try:
        os.replace(temporary_path, path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
