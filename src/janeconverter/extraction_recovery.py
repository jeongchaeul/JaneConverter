"""Bounded recovery decisions for platform extraction, without changing access."""
from enum import Enum
import re
import time


class ExtractionCategory(str, Enum):
    ACCESS = "access-required"
    REMOVED = "removed"
    RATE_LIMIT = "rate-limited"
    NETWORK = "network"
    FORMAT = "format-changed"
    LAYOUT = "extractor-changed"
    UNKNOWN = "unknown"


def classify_extraction(error):
    message = str(error).casefold()
    if any(word in message for word in ("drm", "private video", "sign in", "login", "log in", "401", "403", "age-restricted", "geo restricted", "captcha", "not a bot")):
        return ExtractionCategory.ACCESS
    if any(word in message for word in ("404", "410", "removed", "deleted", "unavailable video")):
        return ExtractionCategory.REMOVED
    if "429" in message or "rate limit" in message:
        return ExtractionCategory.RATE_LIMIT
    if any(word in message for word in ("timeout", "timed out", "connection", "network", "502", "503", "504", "temporarily")):
        return ExtractionCategory.NETWORK
    if any(word in message for word in ("requested format", "no video formats", "no formats")):
        return ExtractionCategory.FORMAT
    if any(word in message for word in (
        "unable to extract", "signature", "nsig", "extractor", "could not locate",
        "unexpected response from webpage request", "unable to solve js challenge",
        "unable to extract challenge data",
    )):
        return ExtractionCategory.LAYOUT
    return ExtractionCategory.UNKNOWN


def extract_with_recovery(ydl, query, download, abort_event=None, report=None, deadline=None):
    deadline = deadline or time.monotonic() + 45
    original = ydl.params.get("extractor_args") if hasattr(ydl, "params") else None
    try:
        for attempt in range(3):
            if abort_event and abort_event.is_set():
                raise KeyboardInterrupt("Stream extraction aborted by user.")
            if time.monotonic() >= deadline:
                raise TimeoutError("Extraction recovery deadline reached. Retry the source when it is available.")
            try:
                return ydl.extract_info(query, download=download)
            except KeyboardInterrupt:
                raise
            except Exception as error:
                category = classify_extraction(error)
                if attempt == 2 or category in (ExtractionCategory.ACCESS, ExtractionCategory.REMOVED, ExtractionCategory.UNKNOWN):
                    raise
                if report:
                    report(0.15, f"Extraction recovery: {category.value}; attempt {attempt + 2}/3.", force=True)
                if category in (ExtractionCategory.FORMAT, ExtractionCategory.LAYOUT):
                    if not hasattr(ydl, "params") or attempt > 0:
                        raise
                    # Re-extract fresh metadata using the provider's maintained defaults.
                    ydl.params.pop("extractor_args", None)
                    continue
                retry_after = re.search(r"retry[- ]after\s*[:=]?\s*(\d+)", str(error), re.I)
                delay = max(1, int(retry_after[1])) if retry_after else 2 ** attempt
                if delay > 8 or time.monotonic() + delay >= deadline:
                    raise RuntimeError("The platform requests a longer wait; retry later.") from error
                if abort_event:
                    if abort_event.wait(delay):
                        raise KeyboardInterrupt("Stream extraction aborted by user.")
                else:
                    time.sleep(delay)
        raise RuntimeError("Extraction recovery exhausted.")
    finally:
        if hasattr(ydl, "params"):
            if original is None:
                ydl.params.pop("extractor_args", None)
            else:
                ydl.params["extractor_args"] = original
