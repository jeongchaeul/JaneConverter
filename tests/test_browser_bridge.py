"""Tests for the consent-based direct browser-media bridge."""

import json

import pytest

from janeconverter.browser_bridge import (
    CaptureBridgeError,
    BrowserCaptureStore,
    parse_capture_metadata,
)


def _metadata(**overrides):
    value = {
        "fileName": "friend-story.mp4",
        "mediaKind": "video",
        "mimeType": "video/mp4",
        "captureMode": "current",
        "pageUrl": "https://www.facebook.com/stories/123",
        "expectedBytes": 6,
    }
    value.update(overrides)
    return value


def test_capture_metadata_is_source_scoped_and_safe():
    metadata = parse_capture_metadata(
        json.dumps(_metadata()),
        "https://www.facebook.com/reel/123",
    )

    assert metadata.file_name == "friend-story.mp4"
    assert metadata.media_kind == "video"
    assert metadata.capture_mode == "current"


@pytest.mark.parametrize(
    "overrides",
    [
        {"fileName": "..\\..\\cookies.txt"},
        {"mediaKind": "document"},
        {"pageUrl": "https://evil.example/media.mp4"},
        {"expectedBytes": -1},
        {"expectedBytes": 1024 * 1024 * 1024 + 1},
    ],
)
def test_capture_metadata_rejects_unsafe_values(overrides):
    with pytest.raises(CaptureBridgeError):
        parse_capture_metadata(
            json.dumps(_metadata(**overrides)),
            "https://www.facebook.com/reel/123",
        )


def test_capture_store_accepts_ordered_chunks_and_returns_a_temporary_file(tmp_path):
    store = BrowserCaptureStore(tmp_path, "https://www.facebook.com/reel/123")
    metadata = parse_capture_metadata(
        json.dumps(_metadata()),
        "https://www.facebook.com/reel/123",
    )

    capture_id = store.start(metadata)
    store.append(capture_id, 0, b"abc")
    store.append(capture_id, 3, b"def")
    captured = store.finish(capture_id)

    assert captured.path.read_bytes() == b"abcdef"
    assert captured.media_kind == "video"
    assert store.captures_for("https://www.facebook.com/reel/123")[0].path == captured.path

    store.close()
    assert not captured.path.exists()


def test_capture_store_rejects_out_of_order_chunks(tmp_path):
    store = BrowserCaptureStore(tmp_path, "https://www.facebook.com/reel/123")
    metadata = parse_capture_metadata(
        json.dumps(_metadata()),
        "https://www.facebook.com/reel/123",
    )
    capture_id = store.start(metadata)
    store.append(capture_id, 0, b"abc")

    with pytest.raises(CaptureBridgeError, match="offset"):
        store.append(capture_id, 1, b"def")

    store.close()


def test_capture_metadata_accepts_stream_and_model():
    stream_meta = parse_capture_metadata(
        json.dumps(_metadata(
            fileName="live-stream.m3u8",
            mediaKind="stream",
            mimeType="application/vnd.apple.mpegurl",
        )),
        "https://www.facebook.com/reel/123",
    )
    assert stream_meta.media_kind == "stream"
    assert stream_meta.mime_type == "application/vnd.apple.mpegurl"

    model_meta = parse_capture_metadata(
        json.dumps(_metadata(
            fileName="avatar.glb",
            mediaKind="model",
            mimeType="model/gltf-binary",
        )),
        "https://www.facebook.com/reel/123",
    )
    assert model_meta.media_kind == "model"
    assert model_meta.mime_type == "model/gltf-binary"


def test_validate_capture_stream_and_model(tmp_path):
    from janeconverter.capture_validation import validate_capture

    m3u8_file = tmp_path / "stream.m3u8"
    m3u8_file.write_text("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n", encoding="utf-8")
    stream_res = validate_capture(str(m3u8_file), "stream")
    assert "mpegurl" in stream_res["mimeType"]

    glb_file = tmp_path / "model.glb"
    glb_file.write_bytes(b"glTF\x02\x00\x00\x00\x20\x00\x00\x00")
    model_res = validate_capture(str(glb_file), "model")
    assert model_res["mimeType"] == "model/gltf-binary"
