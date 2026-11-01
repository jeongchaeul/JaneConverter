"""Unit tests for the thread-safe session pacer and rate-limiting coordinator."""

import threading
import time
import pytest

from janeconverter.session_pacer import (
    SessionPacer,
    PacingRule,
    extract_canonical_domain,
    pace_request,
)


def test_extract_canonical_domain():
    assert extract_canonical_domain("https://www.youtube.com/watch?v=123") == "youtube.com"
    assert extract_canonical_domain("https://youtu.be/123") == "youtube.com"
    assert extract_canonical_domain("https://m.youtube.com/watch?v=123") == "youtube.com"
    assert extract_canonical_domain("https://music.youtube.com/watch?v=123") == "youtube.com"
    assert extract_canonical_domain("ytsearch1:Jane Cerys") == "youtube.com"
    assert extract_canonical_domain("ytsearch5:Artist Title") == "youtube.com"
    assert extract_canonical_domain("scsearch1:Artist Title") == "soundcloud.com"
    assert extract_canonical_domain("https://www.instagram.com/stories/user/123") == "instagram.com"
    assert extract_canonical_domain("https://instagr.am/p/123") == "instagram.com"
    assert extract_canonical_domain("https://m.facebook.com/story.php") == "facebook.com"
    assert extract_canonical_domain("https://fb.watch/123") == "facebook.com"
    assert extract_canonical_domain("https://vm.tiktok.com/ZM...") == "tiktok.com"
    assert extract_canonical_domain("https://x.com/user/status/123") == "twitter.com"
    assert extract_canonical_domain("https://pin.it/abc") == "pinterest.com"
    assert extract_canonical_domain("https://redd.it/xyz") == "reddit.com"
    assert extract_canonical_domain("https://customcdn.example.com/audio.mp3") == "customcdn.example.com"
    assert extract_canonical_domain("") == "default"
    assert extract_canonical_domain(None) == "default"


def test_pacing_disabled_in_pytest_by_default():
    pacer = SessionPacer()
    assert pacer.is_pacing_disabled() is True
    # By default in pytest, pace returns 0.0 without waiting
    assert pacer.pace("https://youtube.com/watch?v=123") == 0.0


def test_pacer_enforces_staggered_delay_when_forced():
    test_rules = {
        "testdomain.com": PacingRule(min_interval=0.08, jitter_min=0.01, jitter_max=0.02),
        "default": PacingRule(min_interval=0.05, jitter_min=0.01, jitter_max=0.01),
    }
    pacer = SessionPacer(rules=test_rules)

    # First request: immediate execution
    t0 = time.monotonic()
    wait1 = pacer.pace("https://testdomain.com/1", force=True)
    assert wait1 == 0.0

    # Second immediate request to same domain must be staggered
    wait2 = pacer.pace("https://testdomain.com/2", force=True)
    t1 = time.monotonic()
    assert wait2 >= 0.08
    assert (t1 - t0) >= 0.08

    # Request to a DIFFERENT domain is not blocked by testdomain.com
    t2 = time.monotonic()
    wait_diff = pacer.pace("https://otherdomain.com/1", force=True)
    t3 = time.monotonic()
    assert wait_diff == 0.0
    assert (t3 - t2) < 0.03


def test_pacer_concurrent_threads_stagger_safely():
    test_rules = {
        "youtube.com": PacingRule(min_interval=0.05, jitter_min=0.005, jitter_max=0.01),
    }
    pacer = SessionPacer(rules=test_rules)
    start_times = []
    lock = threading.Lock()

    def worker():
        pacer.pace("https://youtube.com/watch?v=test", force=True)
        with lock:
            start_times.append(time.monotonic())

    threads = [threading.Thread(target=worker) for _ in range(4)]
    t_start = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(start_times) == 4
    start_times.sort()
    # Confirm each thread was scheduled in monotonically increasing intervals
    for idx in range(1, len(start_times)):
        diff = start_times[idx] - start_times[idx - 1]
        assert diff >= 0.04


def test_pacer_aborts_immediately_when_abort_event_is_set():
    pacer = SessionPacer()
    abort_event = threading.Event()
    abort_event.set()

    with pytest.raises(KeyboardInterrupt, match="aborted by user"):
        pacer.pace("https://youtube.com/watch?v=test", abort_event=abort_event, force=True)


def test_global_pace_request_wrapper():
    # Calling global convenience function
    waited = pace_request("https://youtube.com/watch?v=123")
    assert waited == 0.0
