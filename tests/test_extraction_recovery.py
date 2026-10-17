import threading
from unittest.mock import Mock

import pytest

from janeconverter.catalog_match import choose_catalog_match, match_score
from janeconverter.extraction_recovery import ExtractionCategory, classify_extraction, extract_with_recovery


def test_catalog_rejects_wrong_artist_version_duration_and_ambiguity():
    wanted = {"title": "My Song", "artist": "Jane Cerys", "duration": 200}
    correct = {"id": "one", "title": "Jane Cerys - My Song (Official Audio)", "uploader": "Jane Cerys", "duration": 200}
    assert choose_catalog_match(wanted, [{**correct, "title": "My Song (live)"}, correct]) == correct
    assert match_score(wanted, {**correct, "title": "Someone Else - My Song", "uploader": "Someone Else"}) is None
    assert match_score(wanted, {**correct, "duration": 250}) is None
    with pytest.raises(ValueError, match="uncertain"):
        choose_catalog_match(wanted, [correct, {**correct, "id": "two"}])


def test_catalog_matches_multi_artist_and_featured_tracks():
    wanted = {"title": "throw it up", "artist": "ericdoa, glaive", "duration": 157}
    # Official video on primary artist's channel without featured artist in title
    primary_official = {"id": "one", "title": "throw it up", "uploader": "ericdoa", "channel": "ericdoa", "duration": 158}
    score = match_score(wanted, primary_official)
    assert score is not None and score >= 0.9

    # Both artists present in title
    both_artists = {"id": "two", "title": "throw it up (feat. glaive)", "uploader": "ericdoa", "channel": "ericdoa", "duration": 157}
    score_both = match_score(wanted, both_artists)
    assert score_both is not None and score_both >= score


def test_catalog_disambiguates_same_channel_releases():
    wanted = {"title": "song for when the bar closes", "artist": "ericdoa", "duration": 104}
    c0 = {
        "id": "one", "title": "song for when the bar closes",
        "uploader": "ericdoa", "channel": "ericdoa", "channel_id": "UC_channel_123",
        "duration": 105
    }
    c1 = {
        "id": "two", "title": "song for when the bar closes",
        "uploader": "ericdoa", "channel": "ericdoa", "channel_id": "UC_channel_123",
        "duration": 105
    }
    # Should not raise "uncertain" because both are from the exact same channel
    chosen = choose_catalog_match(wanted, [c0, c1])
    assert chosen["id"] == "one"



@pytest.mark.parametrize("message,category", [
    ("HTTP 429", ExtractionCategory.RATE_LIMIT), ("Sign in to view", ExtractionCategory.ACCESS),
    ("Video deleted", ExtractionCategory.REMOVED), ("Connection timed out", ExtractionCategory.NETWORK),
    ("Requested format unavailable", ExtractionCategory.FORMAT), ("Unable to extract signature", ExtractionCategory.LAYOUT),
    ("Unexpected response from webpage request", ExtractionCategory.LAYOUT),
    ("Unable to solve JS challenge", ExtractionCategory.LAYOUT),
    ("Unable to extract challenge data", ExtractionCategory.LAYOUT),
    ("This video is unavailable. Error code: 152 - 18 Watch video on YouTube", ExtractionCategory.ACCESS),
    ("Sign in to confirm your age", ExtractionCategory.ACCESS),
    ("Sign in to confirm you're not a bot", ExtractionCategory.LAYOUT),
    ("Sign in to confirm you’re not a bot", ExtractionCategory.LAYOUT),
])
def test_extraction_failures_have_distinct_recovery_categories(message, category):
    assert classify_extraction(message) == category


def test_changed_provider_clients_are_reextracted_with_defaults():
    ydl = Mock(params={"extractor_args": {"youtube": {"player_client": ["old"]}}})
    calls = []
    def extract(query, download):
        calls.append(dict(ydl.params))
        if len(calls) == 1:
            raise RuntimeError("Unable to extract signature")
        return {"id": "valid"}
    ydl.extract_info.side_effect = extract
    assert extract_with_recovery(ydl, "url", False)["id"] == "valid"
    assert "extractor_args" not in calls[1]
    assert "extractor_args" in ydl.params


def test_access_failure_is_terminal_and_retry_wait_is_cancellable():
    ydl = Mock(params={})
    ydl.extract_info.side_effect = RuntimeError("Sign in to view")
    with pytest.raises(RuntimeError):
        extract_with_recovery(ydl, "url", False)
    assert ydl.extract_info.call_count == 1
    cancel = threading.Event()
    def cancelled(*args, **kwargs):
        cancel.set()
        raise RuntimeError("HTTP 503")
    ydl.extract_info.side_effect = cancelled
    with pytest.raises(KeyboardInterrupt):
        extract_with_recovery(ydl, "url", False, cancel)


def test_server_requested_wait_is_not_shortened():
    ydl = Mock(params={})
    ydl.extract_info.side_effect = RuntimeError("HTTP 429 Retry-After: 120")
    with pytest.raises(RuntimeError, match="longer wait"):
        extract_with_recovery(ydl, "url", False)
    assert ydl.extract_info.call_count == 1


@pytest.mark.parametrize("ambiguous", [False, True])
def test_catalog_downloads_only_the_confident_preview_candidate(tmp_path, monkeypatch, ambiguous):
    from janeconverter import extractor
    requested = {"title": "My Song", "artist": "Jane Cerys", "album": "Album", "duration": 200,
                 "search_candidates": ["ytsearch1:Jane Cerys My Song"]}
    candidate = {"id": "one", "title": "Jane Cerys - My Song (Official Audio)", "uploader": "Jane Cerys",
                 "duration": 200, "webpage_url": "https://www.youtube.com/watch?v=one"}
    calls = []
    output = tmp_path / "recording.mp3"
    class Provider:
        def __init__(self, options):
            self.params = options
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def prepare_filename(self, info):
            return str(output)
        def extract_info(self, query, download):
            calls.append((query, download))
            if not download:
                return {"entries": [candidate, {**candidate, "id": "two"}] if ambiguous else [candidate]}
            output.write_bytes(b"recording")
            return candidate
    monkeypatch.setattr(extractor, "resolve_spotify_metadata", lambda _: requested)
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", Provider)
    if ambiguous:
        with pytest.raises(RuntimeError, match="uncertain"):
            extractor.fetch_media_stream("https://open.spotify.com/track/example", str(tmp_path), audio_only=True)
        assert calls == [("ytsearch5:Jane Cerys My Song", False)]
        assert not output.exists()
    else:
        result = extractor.fetch_media_stream("https://open.spotify.com/track/example", str(tmp_path), audio_only=True)
        assert calls == [("ytsearch5:Jane Cerys My Song", False), (candidate["webpage_url"], True)]
        assert result["webpage_url"] == candidate["webpage_url"]
        assert result["requested_catalog_url"] == "https://open.spotify.com/track/example"
        assert result["matched_source_title"] == candidate["title"]


def test_mahoraga_adaptive_catalog_match_relaxes_duration_and_video_noise():
    wanted = {"title": "Drama", "artist": "aespa", "duration": 215}
    # Candidate with 10s video intro difference (strict check rejects because 10s > max(5, 215*0.05=10.75) wait, let's make it 12s difference where strict threshold is 10.75s)
    # 215s + 12s = 227s
    strict_rejected_candidate = {
        "id": "vid1",
        "title": "aespa 에스파 'Drama' MV (Color Coded Lyrics)",
        "uploader": "SMTOWN",
        "channel": "SMTOWN",
        "duration": 227,
    }
    # Strict match fails due to duration difference (12s > 10.75s)
    assert match_score(wanted, strict_rejected_candidate, relaxed=False) is None
    # Mahoraga adaptive match succeeds under relaxed tier
    relaxed_score = match_score(wanted, strict_rejected_candidate, relaxed=True)
    assert relaxed_score is not None and relaxed_score >= 0.65
    chosen = choose_catalog_match(wanted, [strict_rejected_candidate])
    assert chosen["id"] == "vid1"

def test_mahoraga_client_identity_rotation_on_layout_challenge():
    ydl = Mock(params={"extractor_args": {"youtube": {"player_client": ["web"]}}})
    calls = []

    def extract(query, download):
        calls.append(dict(ydl.params.get("extractor_args", {})))
        if len(calls) == 1:
            raise RuntimeError("Unable to solve JS challenge")
        elif len(calls) == 2:
            raise RuntimeError("Unable to extract challenge data")
        return {"id": "success_via_client_rotation"}

    ydl.extract_info.side_effect = extract
    result = extract_with_recovery(ydl, "https://youtube.com/watch?v=abc", False)
    assert result["id"] == "success_via_client_rotation"
    # Call 1 had original 'web'
    assert calls[0] == {"youtube": {"player_client": ["web"]}}
    # Call 2 popped extractor_args to defaults
    assert calls[1] == {}
    # Call 3 rotated to web_embedded / android client
    assert calls[2] == {"youtube": {"player_client": ["web_embedded", "android"]}}
