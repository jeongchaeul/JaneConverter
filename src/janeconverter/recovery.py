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
    reconstruct_frequency_loss: bool = False
    metadata: tuple[tuple[str, str], ...] = ()
    start_time: str | None = None
    end_time: str | None = None
    expected_category: str | None = None

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
    "audio-transcode": Strategy("audio-transcode", "audio", "flac", "ffprobe-contract",
                                (("source-preserve", FailureCategory.VALIDATION),
                                 ("source-preserve", FailureCategory.CONTAINER),
                                 ("source-preserve", FailureCategory.DECODER))),
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
    evidence_path: str | None = None

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
        candidates = []
        for candidate, strategy in STRATEGIES.items():
            if (current, category) not in strategy.after:
                continue
            if candidate == "gpu-transcode" and not self.intent.gpu_allowed:
                continue
            if candidate == "image-png" and (
                (self.intent.expected_category and self.intent.expected_category.lower() in ("audio", "music", "video"))
                or not self.intent.allow_png_fallback
            ):
                continue
            if candidate == "audio-transcode" and (
                self.intent.expected_category and self.intent.expected_category.lower() not in ("audio", "music")
            ):
                continue
            if candidate == "cover-normalized" and (
                not self.intent.cover_required
                or self.intent.target_format not in {"mp3", "flac", "m4a", "aac"}
            ):
                continue
            if not any(item.method == candidate for item in self.attempts):
                candidates.append(candidate)
        if not candidates:
            return None
        if len(candidates) > 1 and self.evidence_path:
            candidates = rank_candidate_strategies(
                self.evidence_path, self.intent.target_format, category, candidates
            )
        return candidates[0]


def rank_candidate_strategies(
    path: str,
    target: str,
    category: FailureCategory | str,
    candidates: list[str],
) -> list[str]:
    """Rank candidate recovery methods by historical confidence, recency, and failure penalties."""
    if not candidates or len(candidates) <= 1 or not path:
        return list(candidates)
    cat_str = category.value if isinstance(category, FailureCategory) else str(category)
    scores: dict[str, float] = {}
    now = time.time()
    try:
        if not os.path.isfile(path) or os.path.getsize(path) > 65_536:
            return list(candidates)
        with open(path, "r", encoding="utf-8") as source:
            data = json.load(source)
        if data.get("version") == 1 and isinstance(data.get("entries"), dict):
            entries = data["entries"]
            for candidate in candidates:
                key = f"{target}|{cat_str}|{candidate}"
                entry = entries.get(key)
                if isinstance(entry, dict):
                    count = int(entry.get("count", 0))
                    failures = int(entry.get("failures", 0))
                    updated = int(entry.get("updated", 0))
                    age_days = max(0.0, (now - updated) / 86400.0)
                    recency = max(0.2, 1.0 - (age_days / 30.0))
                    score = (count * recency) - (failures * 2.0)
                    scores[candidate] = score
                else:
                    scores[candidate] = 0.0
    except (OSError, ValueError, TypeError, AttributeError):
        return list(candidates)

    return sorted(candidates, key=lambda c: scores.get(c, 0.0), reverse=True)


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
        if os.path.isfile(path):
            if os.path.getsize(path) > 65_536:
                raise ValueError("oversized recovery evidence")
            with open(path, "r", encoding="utf-8") as source:
                previous = json.load(source)
            if previous.get("version") == 1 and isinstance(previous.get("entries"), dict):
                entries = {
                    item_key: {
                        "count": min(999, max(0, int(item_value.get("count", 0)))),
                        "failures": min(999, max(0, int(item_value.get("failures", 0)))),
                        "updated": max(0, int(item_value.get("updated", 0))),
                    }
                    for item_key, item_value in previous["entries"].items()
                    if re.fullmatch(r"[a-z0-9]{2,6}\|[a-z_]+\|(?:cpu-transcode|gpu-transcode|cover-normalized|image-ffmpeg-frame|image-png)", item_key)
                    and isinstance(item_value, dict)
                }
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    now = int(time.time())
    prev = entries.get(key, {})
    entries[key] = {
        "count": min(999, prev.get("count", 0) + 1),
        "failures": max(0, prev.get("failures", 0) - 1),
        "updated": now,
    }
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


def record_local_failure(
    path: str,
    target: str,
    failed_method: str,
    category: FailureCategory | str,
) -> None:
    """Record a strategy failure in adaptation memory to penalize its ranking."""
    if not re.fullmatch(r"[a-z0-9]{2,6}", target):
        return
    cat_str = category.value if isinstance(category, FailureCategory) else str(category)
    if failed_method not in {"cpu-transcode", "gpu-transcode", "cover-normalized", "image-ffmpeg-frame", "image-png"}:
        return
    key = f"{target}|{cat_str}|{failed_method}"
    entries = {}
    try:
        if os.path.isfile(path) and os.path.getsize(path) <= 65_536:
            with open(path, "r", encoding="utf-8") as source:
                previous = json.load(source)
            if previous.get("version") == 1 and isinstance(previous.get("entries"), dict):
                entries = {
                    item_key: {
                        "count": min(999, max(0, int(item_value.get("count", 0)))),
                        "failures": min(999, max(0, int(item_value.get("failures", 0)))),
                        "updated": max(0, int(item_value.get("updated", 0))),
                    }
                    for item_key, item_value in previous["entries"].items()
                    if isinstance(item_value, dict)
                }
    except (OSError, ValueError, TypeError, AttributeError):
        pass

    now = int(time.time())
    prev = entries.get(key, {"count": 0, "failures": 0, "updated": now})
    entries[key] = {
        "count": max(0, prev["count"] - 1),
        "failures": min(999, prev.get("failures", 0) + 1),
        "updated": now,
    }
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


def quarantine_failure(
    quarantine_dir: str,
    coordinator: RecoveryCoordinator,
    diagnostic: str | None = None,
) -> str | None:
    """Store a sanitized failure record for offline analysis and test fixture generation."""
    try:
        os.makedirs(quarantine_dir, exist_ok=True)
        existing = [
            os.path.join(quarantine_dir, f)
            for f in os.listdir(quarantine_dir)
            if f.startswith("failure_") and f.endswith(".json")
        ]
        if len(existing) >= 20:
            existing.sort(key=lambda p: os.path.getmtime(p) if os.path.exists(p) else 0)
            for old_file in existing[:len(existing) - 19]:
                try:
                    os.remove(old_file)
                except OSError:
                    pass

        sanitized_diag = str(diagnostic or "")
        sanitized_diag = re.sub(r"https?://[^\s\"']+", "<url>", sanitized_diag)
        sanitized_diag = re.sub(r"[A-Za-z]:\\[^\s\"']+", "<path>", sanitized_diag)
        sanitized_diag = re.sub(r"/(?:[a-zA-Z0-9._-]+/)+[a-zA-Z0-9._-]+", "<path>", sanitized_diag)
        sanitized_diag = sanitized_diag[:500]

        now = int(time.time())
        token = hex(int(time.monotonic() * 1000) & 0xFFFFFF)[2:]
        filename = f"failure_{now}_{token}.json"
        target_path = os.path.join(quarantine_dir, filename)

        payload = {
            "version": 1,
            "timestamp": now,
            "target_format": coordinator.intent.target_format,
            "intent_mode": coordinator.intent.mode.value,
            "attempts": [
                {"method": a.method, "result": a.result.value if a.result else None}
                for a in coordinator.attempts
            ],
            "diagnostic": sanitized_diag,
        }

        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=quarantine_dir, delete=False) as temp_f:
            json.dump(payload, temp_f, indent=2)
            temp_path = temp_f.name
        try:
            os.replace(temp_path, target_path)
            return target_path
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    except Exception:
        return None

