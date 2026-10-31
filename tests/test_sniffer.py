"""Unit tests for the Native Standalone Page Sniffer."""

import os
from unittest.mock import MagicMock, patch

import pytest

from janeconverter.sniffer import (
    SniffedAsset,
    download_sniffed_asset,
    is_direct_asset_url,
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
