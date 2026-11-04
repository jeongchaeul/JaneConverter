"""
Hermetic unit tests for the Archival Vault Indexing & Recovery Module.
"""
from unittest.mock import MagicMock, patch

from janeconverter.archival import (
    ArchivalMetadata,
    ArchivalStreamResult,
    extract_youtube_id,
    lookup_historical_metadata,
    probe_archival_vaults,
    query_archive_org_collections,
    query_ghostarchive,
    query_wayback_machine_stream,
)
from janeconverter.extractor import fetch_playlist_entries


def test_extract_youtube_id_formats():
    """Verify robust extraction of YouTube video IDs across diverse URL formats."""
    assert extract_youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_id("https://www.youtube.com/live/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_id("https://example.com/not-youtube") is None
    assert extract_youtube_id("") is None


def test_lookup_historical_metadata_filmot():
    """Verify Filmot metadata resolution for deleted/hidden videos."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "title": "Lost Studio Master",
        "channel_name": "project//aspyr",
        "description": "Original uncompressed mix",
        "duration": 210,
        "upload_date": "2024-01-01",
    }
    with patch("requests.get", return_value=mock_resp):
        meta = lookup_historical_metadata("test_vid_123")
        assert meta.title == "Lost Studio Master"
        assert meta.uploader == "project//aspyr"
        assert meta.source_service == "Filmot"


def test_query_archive_org_collections():
    """Verify Archive.org item search and direct file download resolution."""
    search_resp = MagicMock()
    search_resp.status_code = 200
    search_resp.json.return_value = {
        "response": {
            "docs": [
                {"identifier": "youtube-test_vid_123", "title": "Archived Master"}
            ]
        }
    }

    files_resp = MagicMock()
    files_resp.status_code = 200
    files_resp.json.return_value = {
        "result": [
            {"name": "test_vid_123.mp4", "size": "10485760"},
            {"name": "test_vid_123.jpg", "size": "50000"},
        ]
    }

    head_resp = MagicMock()
    head_resp.status_code = 200

    def mock_get(url, *args, **kwargs):
        if "advancedsearch.php" in url:
            return search_resp
        if "metadata" in url:
            return files_resp
        return MagicMock(status_code=404)

    with patch("requests.get", side_effect=mock_get), \
         patch("requests.head", return_value=head_resp):
        meta = ArchivalMetadata(video_id="test_vid_123", title="Studio Master")
        res = query_archive_org_collections("test_vid_123", meta)
        assert res is not None
        assert res.found is True
        assert res.source_name == "Internet Archive"
        assert "archive.org/download/youtube-test_vid_123/test_vid_123.mp4" in res.stream_url
        assert res.ext == "mp4"


def test_query_ghostarchive():
    """Verify Ghostarchive stream extraction from HTML mirror."""
    html_content = '<video src="/varchive/test_vid_123.mp4" controls></video>'
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = html_content

    head_resp = MagicMock()
    head_resp.status_code = 200

    with patch("requests.get", return_value=mock_resp), \
         patch("requests.head", return_value=head_resp):
        meta = ArchivalMetadata(video_id="test_vid_123")
        res = query_ghostarchive("test_vid_123", meta)
        assert res is not None
        assert res.found is True
        assert res.source_name == "Ghostarchive"
        assert res.stream_url == "https://ghostarchive.org/varchive/test_vid_123.mp4"


def test_query_wayback_machine_stream():
    """Verify Wayback Machine googlevideo CDX stream capture lookup."""
    cdx_resp = MagicMock()
    cdx_resp.status_code = 200
    cdx_resp.json.return_value = [
        ["timestamp", "original", "statuscode"],
        ["20240101120000", "https://rr1---sn.googlevideo.com/videoplayback?id=test_vid_123", "200"],
    ]
    head_resp = MagicMock()
    head_resp.status_code = 200

    with patch("requests.get", return_value=cdx_resp), \
         patch("requests.head", return_value=head_resp):
        meta = ArchivalMetadata(video_id="test_vid_123")
        res = query_wayback_machine_stream("test_vid_123", meta)
        assert res is not None
        assert res.found is True
        assert res.source_name == "Wayback Machine Playback"
        assert "web.archive.org/web/20240101120000id_" in res.stream_url


def test_probe_archival_vaults_ladder():
    """Verify the sequential discovery ladder across archival repositories."""
    with patch("janeconverter.archival.lookup_historical_metadata") as mock_meta, \
         patch("janeconverter.archival.query_archive_org_collections") as mock_ia, \
         patch("janeconverter.archival.query_ghostarchive") as mock_ga, \
         patch("janeconverter.archival.query_wayback_machine_stream") as mock_wb:

        mock_meta.return_value = ArchivalMetadata(video_id="dQw4w9WgXcQ", title="Never Gonna Give You Up")
        mock_ia.return_value = None
        mock_ga.return_value = ArchivalStreamResult(
            found=True,
            source_name="Ghostarchive",
            stream_url="https://ghostarchive.org/varchive/dQw4w9WgXcQ.mp4",
            title="Never Gonna Give You Up",
            uploader="Rick Astley",
            description="",
            ext="mp4",
        )

        res = probe_archival_vaults("https://www.youtube.com/watch?v=dQw4w9WgXcQ", parallel=False)
        assert res is not None
        assert res.found is True
        assert res.source_name == "Ghostarchive"
        mock_ia.assert_called_once()
        mock_ga.assert_called_once()
        mock_wb.assert_not_called()


def test_probe_archival_vaults_parallel():
    """Verify concurrent vault probing prioritizes higher ladder vaults (IA > GA > WB)."""
    from janeconverter.archival import clear_archival_cache
    clear_archival_cache()
    with patch("janeconverter.archival.lookup_historical_metadata") as mock_meta, \
         patch("janeconverter.archival.query_archive_org_collections") as mock_ia, \
         patch("janeconverter.archival.query_ghostarchive") as mock_ga, \
         patch("janeconverter.archival.query_wayback_machine_stream") as mock_wb:

        mock_meta.return_value = ArchivalMetadata(video_id="par_vid_123", title="Never Gonna Give You Up")
        mock_ia.return_value = None
        mock_ga.return_value = ArchivalStreamResult(
            found=True,
            source_name="Ghostarchive",
            stream_url="https://ghostarchive.org/varchive/par_vid_123.mp4",
            title="Ghostarchive Title",
            uploader="Ghostarchive Uploader",
            description="",
            ext="mp4",
        )
        mock_wb.return_value = ArchivalStreamResult(
            found=True,
            source_name="Wayback Machine Playback",
            stream_url="https://web.archive.org/web/videoplayback",
            title="Wayback Title",
            uploader="Wayback Uploader",
            description="",
            ext="mp4",
        )

        res = probe_archival_vaults("https://www.youtube.com/watch?v=par_vid_123", parallel=True)
        assert res is not None
        assert res.found is True
        # Ghostarchive should be chosen over Wayback Machine due to ladder priority
        assert res.source_name == "Ghostarchive"
        # Metadata title should be applied
        assert res.title == "Never Gonna Give You Up"
        mock_ia.assert_called_once()
        mock_ga.assert_called_once()
        mock_wb.assert_called_once()
        clear_archival_cache()


def test_fetch_playlist_entries_archival_fallback_disabled(monkeypatch):
    """Verify that unavailable videos are omitted when archival fallback is disabled (default)."""
    fake_info = {
        "_type": "playlist",
        "title": "Test Playlist",
        "entries": [
            {"id": "vid1", "title": "Normal Video", "duration": 180, "url": "https://youtube.com/watch?v=vid1"},
            {"id": "vid2", "title": "[Deleted video]", "duration": 0},
            {"id": "vid3", "title": "[Private video]", "duration": 0},
        ]
    }
    class MockYDL:
        def __init__(self, opts):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def extract_info(self, url, download=False):
            return fake_info

    import yt_dlp
    monkeypatch.setattr(yt_dlp, "YoutubeDL", MockYDL)

    pdata = fetch_playlist_entries("https://www.youtube.com/playlist?list=PL123", archival_fallback=False)
    entries = pdata.get("entries", [])
    assert len(entries) == 1
    assert entries[0]["id"] == "vid1"


def test_fetch_playlist_entries_archival_fallback_enabled(monkeypatch):
    """Verify that unavailable videos are retained and enriched when archival fallback is enabled."""
    fake_info = {
        "_type": "playlist",
        "title": "Test Playlist",
        "entries": [
            {"id": "vid1", "title": "Normal Video", "duration": 180, "url": "https://youtube.com/watch?v=vid1"},
            {"id": "vid2", "title": "[Deleted video]", "duration": 0},
        ]
    }
    class MockYDL:
        def __init__(self, opts):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def extract_info(self, url, download=False):
            return fake_info

    import yt_dlp
    monkeypatch.setattr(yt_dlp, "YoutubeDL", MockYDL)

    with patch("janeconverter.archival.lookup_historical_metadata") as mock_hist:
        mock_hist.return_value = ArchivalMetadata(
            video_id="vid2",
            title="Recovered Deleted Song",
            uploader="Original Artist",
            duration=240,
        )
        pdata = fetch_playlist_entries("https://www.youtube.com/playlist?list=PL123", archival_fallback=True)
        entries = pdata.get("entries", [])
        assert len(entries) == 2
        assert entries[0]["id"] == "vid1"
        assert entries[1]["id"] == "vid2"
        assert entries[1]["title"] == "Recovered Deleted Song"
        assert entries[1]["artist"] == "Original Artist"
        assert entries[1]["is_archival_candidate"] is True


def test_archival_cache_prevents_repeated_lookups():
    from janeconverter.archival import clear_archival_cache
    clear_archival_cache()
    with patch("janeconverter.archival.lookup_historical_metadata") as mock_meta, \
         patch("janeconverter.archival.query_archive_org_collections") as mock_ia, \
         patch("janeconverter.archival.query_ghostarchive") as mock_ga, \
         patch("janeconverter.archival.query_wayback_machine_stream") as mock_wb:
        mock_meta.return_value = ArchivalMetadata(video_id="dead1234567")
        mock_ia.return_value = None
        mock_ga.return_value = None
        mock_wb.return_value = None

        res1 = probe_archival_vaults("https://www.youtube.com/watch?v=dead1234567")
        assert res1 is None
        assert mock_ia.call_count == 1

        # Second lookup for same ID should immediately return cached None without calling APIs
        res2 = probe_archival_vaults("https://www.youtube.com/watch?v=dead1234567")
        assert res2 is None
        assert mock_ia.call_count == 1
        clear_archival_cache()


def test_archival_disk_cache_persistence(tmp_path, monkeypatch):
    from janeconverter.archival import clear_archival_cache, _ARCHIVAL_CACHE
    import janeconverter.archival as archival_mod
    monkeypatch.setattr(archival_mod, "_get_disk_cache_path", lambda: str(tmp_path / "test_cache.json"))
    clear_archival_cache()

    with patch("janeconverter.archival.lookup_historical_metadata") as mock_meta, \
         patch("janeconverter.archival.query_archive_org_collections") as mock_ia, \
         patch("janeconverter.archival.query_ghostarchive") as mock_ga, \
         patch("janeconverter.archival.query_wayback_machine_stream") as mock_wb:
        mock_meta.return_value = ArchivalMetadata(video_id="disk_vid_999", title="Persisted Song")
        mock_ia.return_value = ArchivalStreamResult(
            found=True,
            source_name="Internet Archive",
            stream_url="https://archive.org/download/test.mp4",
            title="Persisted Song",
            uploader="Creator",
            description="",
            ext="mp4",
        )
        mock_ga.return_value = None
        mock_wb.return_value = None

        res1 = probe_archival_vaults("https://www.youtube.com/watch?v=disk_vid_999", parallel=True)
        assert res1 is not None
        assert res1.found is True

        # Clear in-memory cache to simulate brand new process launch
        _ARCHIVAL_CACHE.clear()

        # Probe again: should load straight from disk cache without invoking mock_ia
        mock_ia.reset_mock()
        res2 = probe_archival_vaults("https://www.youtube.com/watch?v=disk_vid_999", parallel=True)
        assert res2 is not None
        assert res2.found is True
        assert res2.stream_url == "https://archive.org/download/test.mp4"
        mock_ia.assert_not_called()
        clear_archival_cache()
