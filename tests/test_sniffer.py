"""Unit tests for the Native Standalone Page Sniffer."""

import os
from unittest.mock import MagicMock, patch

import pytest

from janeconverter.sniffer import (
    SniffedAsset,
    download_sniffed_asset,
    is_direct_asset_url,
    is_public_http_url,
    sniff_webpage,
)


def test_is_direct_asset_url_detects_streams_and_models():
    stream = is_direct_asset_url("https://live.example.com/hls/master.m3u8")
    assert stream is not None
    assert stream.asset_kind == "stream"
    assert stream.extension == "m3u8"
    assert stream.title == "master"

    dash = is_direct_asset_url("https://live.example.com/dash/manifest.mpd?token=123")
    assert dash is not None
    assert dash.asset_kind == "stream"
    assert dash.extension == "mpd"

    glb = is_direct_asset_url("https://models.example.com/robot.glb")
    assert glb is not None
    assert glb.asset_kind == "model"
    assert glb.extension == "glb"
    assert glb.title == "robot"

    splat = is_direct_asset_url("https://splats.example.com/scene.splat")
    assert splat is not None
    assert splat.asset_kind == "model"
    assert splat.extension == "splat"

    non_asset = is_direct_asset_url("https://example.com/about-us")
    assert non_asset is None


def test_sniff_webpage_extracts_jwplayer_and_hls_streams():
    html_sample = """
    <!DOCTYPE html>
    <html>
    <head><title>Epic Livestream Concert 2026</title></head>
    <body>
        <div id="player"></div>
        <script>
            jwplayer("player").setup({
                file: "https://streams.example.com/vod/concert.m3u8",
                title: "Live Stream"
            });
        </script>
    </body>
    </html>
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = html_sample
    mock_resp.url = "https://example.com/watch/concert"

    with patch("requests.Session.get", return_value=mock_resp):
        asset = sniff_webpage("https://example.com/watch/concert")
        assert asset is not None
        assert asset.asset_kind == "stream"
        assert asset.extension == "m3u8"
        assert asset.asset_url == "https://streams.example.com/vod/concert.m3u8"
        assert "Epic Livestream Concert 2026" in asset.title


def test_sniff_webpage_extracts_3d_model_assets():
    html_sample = """
    <!DOCTYPE html>
    <html>
    <head><title>3D Character Showcase</title></head>
    <body>
        <model-viewer src="https://assets.example.com/models/avatar_v2.glb"></model-viewer>
    </body>
    </html>
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = html_sample
    mock_resp.url = "https://example.com/showcase"

    with patch("requests.Session.get", return_value=mock_resp):
        asset = sniff_webpage("https://example.com/showcase")
        assert asset is not None
        assert asset.asset_kind == "model"
        assert asset.extension == "glb"
        assert asset.asset_url == "https://assets.example.com/models/avatar_v2.glb"


def test_sniff_webpage_extracts_from_embedded_player_iframe():
    main_html = """
    <!DOCTYPE html>
    <html>
    <head><title>Indie Anime Episode 1</title></head>
    <body>
        <iframe src="https://embed.player-cdn.com/v/999"></iframe>
    </body>
    </html>
    """
    iframe_html = """
    <!DOCTYPE html>
    <html>
    <body>
        <script>
            const videoSource = "https://media.server.org/hls/ep1_1080p.m3u8";
            hls.loadSource(videoSource);
        </script>
    </body>
    </html>
    """

    def mock_get(url, **kwargs):
        resp = MagicMock()
        resp.status_code = 200
        if "embed.player-cdn.com" in url:
            resp.text = iframe_html
            resp.url = "https://embed.player-cdn.com/v/999"
        else:
            resp.text = main_html
            resp.url = "https://anime-site.net/watch/1"
        return resp

    with patch("requests.Session.get", side_effect=mock_get):
        asset = sniff_webpage("https://anime-site.net/watch/1")
        assert asset is not None
        assert asset.asset_kind == "stream"
        assert asset.extension == "m3u8"
        assert asset.asset_url == "https://media.server.org/hls/ep1_1080p.m3u8"


def test_download_sniffed_3d_model(tmp_path):
    asset = SniffedAsset(
        asset_url="https://models.example.com/mesh.glb",
        asset_kind="model",
        extension="glb",
        title="Custom Robot",
        source_page="https://example.com",
        headers={"User-Agent": "test"},
    )

    mock_resp = MagicMock()
    mock_resp.headers = {"content-length": "12"}
    mock_resp.iter_content.return_value = [b"glTF", b"\x02\x00\x00\x00", b"\x00\x00\x00\x00"]

    with patch("requests.get", return_value=mock_resp):
        meta = download_sniffed_asset(asset, str(tmp_path))
        assert meta["source_type"] == "model"
        assert meta["title"] == "Custom Robot"
        assert os.path.isfile(meta["media_path"])
        assert meta["media_path"].endswith(".glb")
        assert open(meta["media_path"], "rb").read() == b"glTF\x02\x00\x00\x00\x00\x00\x00\x00"


def test_is_direct_asset_url_detects_audio():
    audio = is_direct_asset_url("https://cdn.example.com/audio/track_01.flac")
    assert audio is not None
    assert audio.asset_kind == "audio"
    assert audio.extension == "flac"
    assert audio.title == "track_01"


def test_sniff_webpage_extracts_from_next_data_hydration():
    html_sample = """
    <!DOCTYPE html>
    <html>
    <head><title>NextJS SPA Video Player</title></head>
    <body>
        <div id="__next"></div>
        <script id="__NEXT_DATA__" type="application/json">
        {
            "props": {
                "pageProps": {
                    "video": {
                        "streamManifest": "https://video-cdn.example.com/hls/master.m3u8",
                        "title": "Exclusive Release"
                    }
                }
            }
        }
        </script>
    </body>
    </html>
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = html_sample
    mock_resp.url = "https://example.com/video/exclusive"

    with patch("requests.Session.get", return_value=mock_resp):
        asset = sniff_webpage("https://example.com/video/exclusive")
        assert asset is not None
        assert asset.asset_kind == "stream"
        assert asset.extension == "m3u8"
        assert asset.asset_url == "https://video-cdn.example.com/hls/master.m3u8"


def test_sniff_webpage_extracts_direct_audio_element():
    html_sample = """
    <!DOCTYPE html>
    <html>
    <head><title>Podcast Audio Player</title></head>
    <body>
        <audio controls src="https://media.podcasts.org/episodes/ep42.mp3"></audio>
    </body>
    </html>
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = html_sample
    mock_resp.url = "https://example.com/podcasts/42"

    with patch("requests.Session.get", return_value=mock_resp):
        asset = sniff_webpage("https://example.com/podcasts/42")
        assert asset is not None
        assert asset.asset_kind == "audio"
        assert asset.extension == "mp3"
        assert asset.asset_url == "https://media.podcasts.org/episodes/ep42.mp3"


def test_sniffer_blocks_ssrf_to_private_and_loopback_hosts(tmp_path):
    assert not is_public_http_url("http://127.0.0.1:8080/live.m3u8")
    assert not is_public_http_url("http://localhost/model.glb")
    assert not is_public_http_url("http://169.254.169.254/latest/meta-data/")
    assert not is_public_http_url("http://192.168.1.1/stream.mp4")
    assert not is_public_http_url("http://10.0.0.1/audio.mp3")
    assert not is_public_http_url("http://[::1]/index.m3u8")
    assert is_direct_asset_url("http://127.0.0.1/stream.m3u8") is None
    assert sniff_webpage("http://127.0.0.1:8000/watch") is None

    evil_html = """
    <html><body>
        <video src="http://127.0.0.1:9000/internal.mp4"></video>
        <iframe src="http://169.254.169.254/latest/meta-data"></iframe>
    </body></html>
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = evil_html
    mock_resp.url = "https://example.com/evil"
    with patch("requests.Session.get", return_value=mock_resp):
        assert sniff_webpage("https://example.com/evil") is None

    loopback_asset = SniffedAsset(
        asset_url="http://127.0.0.1/secret.glb",
        asset_kind="model",
        extension="glb",
        title="Secret",
        source_page="https://example.com",
        headers={},
    )
    with pytest.raises(ValueError, match="private, loopback, or unsafe"):
        download_sniffed_asset(loopback_asset, str(tmp_path))

