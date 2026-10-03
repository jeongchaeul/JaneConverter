import json
import subprocess

import pytest
from PIL import Image

from janeconverter.capture_validation import validate_capture
from janeconverter.converter import get_ffmpeg_binary


def test_image_bytes_are_decoded_instead_of_trusting_extension(tmp_path):
    capture = tmp_path / "capture.png.part"
    Image.new("RGB", (20, 30)).save(capture, format="JPEG")
    assert validate_capture(str(capture), "image") == {"mimeType": "image/jpeg", "width": 20, "height": 30}
    capture.write_bytes(b"<html>Login required</html>")
    with pytest.raises(OSError):
        validate_capture(str(capture), "image")


def test_empty_capture_is_rejected(tmp_path):
    capture = tmp_path / "empty"
    capture.touch()
    with pytest.raises(ValueError, match="empty"):
        validate_capture(str(capture), "video")


def test_video_requires_a_decodable_stream(tmp_path, monkeypatch):
    capture = tmp_path / "video.part"
    capture.write_bytes(b"untrusted")
    report = {"streams": [{"codec_type": "video", "width": 720, "height": 1280}],
              "format": {"duration": "12", "format_name": "mov,mp4"}}
    results = iter([subprocess.CompletedProcess([], 0, json.dumps(report).encode()),
                    subprocess.CompletedProcess([], 1)])
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: next(results))
    with pytest.raises(ValueError, match="decoded"):
        validate_capture(str(capture), "video")


def test_rendered_webm_without_duration_still_requires_playable_frames(tmp_path):
    capture = tmp_path / "rendered.webm.part"
    subprocess.run([get_ffmpeg_binary(), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=10",
                    "-t", "0.5", "-an", "-c:v", "libvpx", "-f", "webm", "-live", "1", "-y", str(capture)],
                   check=True, timeout=15, capture_output=True,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    report = validate_capture(str(capture), "video")
    assert report["mimeType"] == "video/webm"
    assert report["duration"] is None


def test_header_only_stream_is_not_accepted(tmp_path, monkeypatch):
    capture = tmp_path / "empty-stream.part"
    capture.write_bytes(b"headers")
    report = {"streams": [{"codec_type": "video", "width": 64, "height": 64}], "format": {"format_name": "webm"}}
    results = iter([subprocess.CompletedProcess([], 0, json.dumps(report).encode()),
                    subprocess.CompletedProcess([], 0, b"frame=0\nout_time_us=0\nprogress=end\n")])
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: next(results))
    with pytest.raises(ValueError, match="no playable"):
        validate_capture(str(capture), "video")
