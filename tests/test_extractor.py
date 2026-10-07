"""
Unit tests for the extractor module.
"""

import pytest
from janeconverter.extractor import (
    is_url,
    identify_source_type,
    sanitize_filename,
    resolve_spotify_metadata,
    resolve_apple_music_metadata,
    build_search_candidates,
    build_tiktok_candidates,
)

def test_is_url():
    assert is_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is True
    assert is_url("http://open.spotify.com/track/123") is True
    assert is_url("https://soundcloud.com/artist/track") is True
    assert is_url("C:\\Videos\\my_video.mp4") is False
    assert is_url("random text") is False
    assert is_url("") is False
    assert is_url(None) is False

def test_identify_source_type():
    assert identify_source_type("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT") == "spotify"
    assert identify_source_type("https://www.youtube.com/watch?v=123") == "youtube"
    assert identify_source_type("https://youtu.be/123") == "youtube"
    assert identify_source_type("https://soundcloud.com/user/track") == "soundcloud"
    assert identify_source_type("https://www.tiktok.com/@user/video/123") == "tiktok"
    assert identify_source_type("https://x.com/user/status/123") == "twitter"
    assert identify_source_type("https://twitter.com/user/status/123") == "twitter"
    assert identify_source_type("https://facebook.com/watch/?v=123") == "facebook"
    assert identify_source_type("https://reddit.com/r/videos/comments/123") == "reddit"
    assert identify_source_type("https://twitch.tv/videos/123") == "twitch"
    assert identify_source_type("https://example.com/stream.mp4") == "generic_url"
    assert identify_source_type("D:\\JaneConverter\\sample.wav") == "local_file"

def test_sanitize_filename():
    unsafe = 'Video: "Best / Worst" * 2026? <test> | name'
    clean = sanitize_filename(unsafe)
    for bad in ['\\', '/', '*', '?', ':', '"', '<', '>', '|']:
        assert bad not in clean
    assert len(clean) > 0

@pytest.mark.online
def test_resolve_spotify_metadata_online():
    # Public Spotify track (Rick Astley - Never Gonna Give You Up)
    url = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"
    data = resolve_spotify_metadata(url)
    assert isinstance(data, dict)
    assert "title" in data
    assert "artist" in data
    assert "search_query" in data
    assert len(data["search_query"]) > 0

@pytest.mark.online
def test_resolve_apple_music_metadata_online():
    # Public Apple Music catalog entry. This verifies the real lookup path only
    # when the opt-in online suite is requested.
    url = "https://music.apple.com/us/album/heart-on-my-sleeve/1616728060?i=1616728075"
    data = resolve_apple_music_metadata(url)
    assert data["title"]
    assert data["artist"]
    assert data["search_candidates"]

def test_build_search_candidates():
    candidates = build_search_candidates("project:aspyr, kvnokishi", "permafall?")
    assert len(candidates) > 0
    assert any("project aspyr kvnokishi permafall" in c for c in candidates)
    for c in candidates:
        clean_part = c.replace("ytsearch1:", "").replace("scsearch1:", "")
        assert ":" not in clean_part
        assert "?" not in clean_part


def test_build_tiktok_candidates():
    url_with_params = "https://www.tiktok.com/@user/video/7693187265878674709?is_from_webapp=1&sender_device=pc"
    candidates = build_tiktok_candidates(url_with_params)
    assert len(candidates) == 3
    assert candidates[0] == url_with_params
    assert candidates[1] == "https://www.tiktok.com/@user/video/7693187265878674709"
    assert candidates[2] == "https://m.tiktok.com/v/7693187265878674709.html"

    clean_url = "https://www.tiktok.com/@user/video/7693187265878674709"
    clean_candidates = build_tiktok_candidates(clean_url)
    assert len(clean_candidates) == 2
    assert clean_candidates[0] == clean_url
    assert clean_candidates[1] == "https://m.tiktok.com/v/7693187265878674709.html"

    short_url = "https://vt.tiktok.com/ZS123456/"
    short_candidates = build_tiktok_candidates(short_url)
    assert short_candidates == [short_url]


def test_fetch_tiktok_direct_unit(tmp_path, monkeypatch):
    import os
    from unittest.mock import Mock
    from janeconverter.extractor import _fetch_tiktok_direct

    api_resp = Mock()
    api_resp.status_code = 200
    api_resp.json.return_value = {
        "code": 0,
        "data": {
            "id": "7693187265878674709",
            "title": "Synthetic TikTok Video",
            "author": {"unique_id": "creator_one", "nickname": "Creator One"},
            "duration": 42,
            "play": "https://cdn.example.test/video.mp4",
            "hdplay": "https://cdn.example.test/hd_video.mp4",
            "cover": "https://cdn.example.test/cover.jpg",
        }
    }

    stream_resp = Mock()
    stream_resp.status_code = 200
    stream_resp.headers = {"content-length": "100"}
    stream_resp.iter_content.return_value = [b"synthetic-mp4-data-bytes"]
    stream_resp.__enter__ = Mock(return_value=stream_resp)
    stream_resp.__exit__ = Mock(return_value=False)

    def mock_requests_post(url, **kwargs):
        return api_resp

    def mock_requests_get(url, **kwargs):
        if "tikwm.com" in url:
            return api_resp
        return stream_resp

    monkeypatch.setattr("requests.post", mock_requests_post)
    monkeypatch.setattr("requests.get", mock_requests_get)

    result = _fetch_tiktok_direct(
        "https://www.tiktok.com/@creator_one/video/7693187265878674709",
        str(tmp_path),
    )

    assert result["title"] == "Synthetic TikTok Video"
    assert result["artist"] == "creator_one"
    assert result["duration"] == 42
    assert result["source_type"] == "tiktok"
    assert os.path.exists(result["media_path"])
    with open(result["media_path"], "rb") as f:
        assert f.read() == b"synthetic-mp4-data-bytes"


def test_fetch_media_stream_tiktok_fallback(tmp_path, monkeypatch):
    from unittest.mock import Mock
    import yt_dlp
    from janeconverter.extractor import fetch_media_stream

    def failing_extract(self, query, download):
        raise RuntimeError("ERROR: [TikTok] 7693187265878674709: Unexpected response from webpage request")

    monkeypatch.setattr(yt_dlp.YoutubeDL, "extract_info", failing_extract)

    mock_direct = Mock(return_value={
        "media_path": str(tmp_path / "fallback.mp4"),
        "title": "Direct TikTok Video",
        "artist": "creator_one",
        "duration": 30,
        "source_type": "tiktok",
    })
    monkeypatch.setattr("janeconverter.extractor._fetch_tiktok_direct", mock_direct)

    result = fetch_media_stream(
        "https://www.tiktok.com/@creator_one/video/7693187265878674709",
        str(tmp_path),
    )

    assert result["title"] == "Direct TikTok Video"
    assert mock_direct.call_count == 1


