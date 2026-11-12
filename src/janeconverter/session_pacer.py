"""
Thread-safe session pacing and human-like rate limiting for media extraction.

Protects user browser sessions and cookies against bot-detection heuristics,
concurrency collisions, and account rate limits across sensitive domains.
"""

from __future__ import annotations

import os
import random
import threading
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class PacingRule:
    """Domain pacing thresholds in seconds."""

    min_interval: float
    jitter_min: float
    jitter_max: float


DEFAULT_PACING_RULES: Dict[str, PacingRule] = {
    # Instagram aggressively flags rapid repeated requests or simultaneous worker spikes
    "instagram.com": PacingRule(min_interval=1.2, jitter_min=0.2, jitter_max=0.5),
    # Facebook rate limits Graph/guest queries when called concurrently
    "facebook.com": PacingRule(min_interval=1.0, jitter_min=0.15, jitter_max=0.35),
    # TikTok uses bot detection / slide puzzle challenges on bursts
    "tiktok.com": PacingRule(min_interval=0.4, jitter_min=0.05, jitter_max=0.2),
    # YouTube monitors player API request frequency per session ID (Error 152 / CAPTCHA)
    "youtube.com": PacingRule(min_interval=0.25, jitter_min=0.05, jitter_max=0.15),
    # Twitter / X enforces strict API burst limits
    "twitter.com": PacingRule(min_interval=0.4, jitter_min=0.05, jitter_max=0.2),
    # Reddit enforces 60-100 req/min limits
    "reddit.com": PacingRule(min_interval=0.5, jitter_min=0.1, jitter_max=0.3),
    # Soundcloud and Pinterest
    "soundcloud.com": PacingRule(min_interval=0.2, jitter_min=0.05, jitter_max=0.15),
    "pinterest.com": PacingRule(min_interval=0.3, jitter_min=0.05, jitter_max=0.2),
    # Generic baseline for other platforms
    "default": PacingRule(min_interval=0.15, jitter_min=0.02, jitter_max=0.08),
}

DOMAIN_CANONICAL_MAP = {
    "youtu.be": "youtube.com",
    "music.youtube.com": "youtube.com",
    "m.youtube.com": "youtube.com",
    "instagr.am": "instagram.com",
    "fb.watch": "facebook.com",
    "fb.com": "facebook.com",
    "m.facebook.com": "facebook.com",
    "x.com": "twitter.com",
    "t.co": "twitter.com",
    "mobile.twitter.com": "twitter.com",
    "m.tiktok.com": "tiktok.com",
    "vm.tiktok.com": "tiktok.com",
    "vt.tiktok.com": "tiktok.com",
    "redd.it": "reddit.com",
    "pin.it": "pinterest.com",
}


def extract_canonical_domain(url_or_query: str) -> str:
    """Resolve a query or media URL to its canonical domain for rate-limiting."""
    if not url_or_query or not isinstance(url_or_query, str):
        return "default"

    query_strip = url_or_query.strip()
    if query_strip.startswith("ytsearch"):
        return "youtube.com"
    if query_strip.startswith("scsearch"):
        return "soundcloud.com"

    try:
        parsed = urllib.parse.urlsplit(query_strip)
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return "default"
        if hostname.startswith("www."):
            hostname = hostname[4:]
        if hostname in DOMAIN_CANONICAL_MAP:
            return DOMAIN_CANONICAL_MAP[hostname]
        for key, canonical in DOMAIN_CANONICAL_MAP.items():
            if hostname.endswith("." + key):
                return canonical
        for root in DEFAULT_PACING_RULES:
            if hostname == root or hostname.endswith("." + root):
                return root
        return hostname
    except Exception:
        return "default"


class SessionPacer:
    """Thread-safe rate-limiter and pacing coordinator with randomized human jitter."""

    def __init__(self, rules: Optional[Dict[str, PacingRule]] = None):
        self._rules = dict(DEFAULT_PACING_RULES)
        if rules:
            self._rules.update(rules)
        self._lock = threading.Lock()
        self._last_scheduled: Dict[str, float] = {}

    def is_pacing_disabled(self) -> bool:
        """Pacing is bypassed in automated pytest suites unless explicitly forced."""
        return bool(
            os.environ.get("PYTEST_CURRENT_TEST")
            or os.environ.get("JANECONVERTER_DISABLE_PACING")
        )

    def pace(
        self,
        url_or_query: str,
        abort_event: Optional[Any] = None,
        force: bool = False,
    ) -> float:
        """Ensure a safe time interval with organic human jitter before calling a host API.

        Returns the seconds waited.
        """
        if self.is_pacing_disabled() and not force:
            return 0.0

        if abort_event and abort_event.is_set():
            raise KeyboardInterrupt("Extraction pacing aborted by user.")

        domain = extract_canonical_domain(url_or_query)
        rule = self._rules.get(domain) or self._rules.get("default", DEFAULT_PACING_RULES["default"])

        with self._lock:
            now = time.monotonic()
            last_scheduled = self._last_scheduled.get(domain, 0.0)
            jitter = random.uniform(rule.jitter_min, rule.jitter_max)
            target_interval = rule.min_interval + jitter

            if last_scheduled <= 0.0 or (now - last_scheduled) >= target_interval:
                next_slot = now
                wait_time = 0.0
            else:
                next_slot = max(now, last_scheduled + target_interval)
                wait_time = max(0.0, next_slot - now)

            self._last_scheduled[domain] = next_slot

        if wait_time > 0.0:
            if abort_event:
                interrupted = abort_event.wait(wait_time)
                if interrupted:
                    raise KeyboardInterrupt("Extraction pacing aborted by user.")
            else:
                time.sleep(wait_time)

        return wait_time


SESSION_PACER = SessionPacer()


def pace_request(
    url_or_query: str,
    abort_event: Optional[Any] = None,
    force: bool = False,
) -> float:
    """Global entrypoint to pace a request against session rate limits."""
    return SESSION_PACER.pace(url_or_query, abort_event=abort_event, force=force)
