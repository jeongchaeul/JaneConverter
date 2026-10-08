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


@pytest.mark.parametrize("message,category", [
    ("HTTP 429", ExtractionCategory.RATE_LIMIT), ("Sign in to view", ExtractionCategory.ACCESS),
    ("Video deleted", ExtractionCategory.REMOVED), ("Connection timed out", ExtractionCategory.NETWORK),
    ("Requested format unavailable", ExtractionCategory.FORMAT), ("Unable to extract signature", ExtractionCategory.LAYOUT),
    ("Unexpected response from webpage request", ExtractionCategory.LAYOUT),
    ("Unable to solve JS challenge", ExtractionCategory.LAYOUT),
    ("Unable to extract challenge data", ExtractionCategory.LAYOUT),
    ("This video is unavailable. Error code: 152 - 18 Watch video on YouTube", ExtractionCategory.ACCESS),
    ("Sign in to confirm your age", ExtractionCategory.ACCESS),
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
