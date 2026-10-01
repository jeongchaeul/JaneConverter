from __future__ import annotations

import io
import json
import subprocess

import pytest
from PIL import Image

from janeconverter import converter
from janeconverter.recovery import (
    FailureCategory,
    IntentMode,
    OutputIntent,
    RecoveryCoordinator,
    STRATEGIES,
    classify_ffmpeg_failure,
    record_local_success,
)


def _intent(*, gpu_allowed: bool = True, cover_required: bool = False) -> OutputIntent:
    return OutputIntent(
        target_format="mp4", quality="best", sample_rate=48000,
        resolution="original", normalize_audio=False, fps=None,
        cover_required=cover_required, gpu_allowed=gpu_allowed,
    )


def test_recovery_coordinator_bounds_distinct_policy_safe_methods():
    recovery = RecoveryCoordinator(_intent())
    recovery.start("stream-copy")
    assert recovery.next_method(FailureCategory.CONTAINER) == "gpu-transcode"
    recovery.start("gpu-transcode")
    assert recovery.next_method(FailureCategory.HARDWARE) == "cpu-transcode"
    recovery.start("cpu-transcode")
    assert recovery.next_method(FailureCategory.ENCODER) is None
    with pytest.raises(RuntimeError, match="repeating a method"):
        recovery.start("cpu-transcode")
    assert STRATEGIES["cpu-transcode"].validator == "ffprobe-contract"
    assert ("gpu-transcode", FailureCategory.HARDWARE) in STRATEGIES["cpu-transcode"].after
    assert STRATEGIES["cpu-transcode"].max_seconds > 0


def test_output_intent_distinguishes_source_lossless_and_target_format():
    from dataclasses import replace
    assert replace(_intent(), target_format="source").mode == IntentMode.SOURCE_PRESERVING
    assert replace(_intent(), target_format="flac").mode == IntentMode.LOSSLESS_ENCODING
    assert _intent().mode == IntentMode.TARGET_FORMAT


def test_recovery_budget_and_format_change_gate():
    recovery = RecoveryCoordinator(_intent(), started_at=-1e9)
    recovery.start("stream-copy")
    assert recovery.next_method(FailureCategory.CONTAINER) is None
    with pytest.raises(RuntimeError, match="time limit"):
        recovery.start("cpu-transcode")
    with pytest.raises(RuntimeError, match="user's recovery choice"):
        RecoveryCoordinator(_intent()).start("image-png")


def test_cover_recovery_keeps_artwork_required():
    from dataclasses import replace
    intent = replace(_intent(cover_required=True), target_format="mp3")
    recovery = RecoveryCoordinator(intent)
    recovery.start("cpu-transcode")
    assert classify_ffmpeg_failure(b"Could not mux attached picture") == FailureCategory.ARTWORK
    assert recovery.next_method(FailureCategory.ARTWORK) == "cover-normalized"
    recovery.start("cover-normalized")
    assert recovery.intent.cover_required
    assert recovery.next_method(FailureCategory.ARTWORK) is None


@pytest.mark.parametrize("detail", [
    b"Permission denied", b"No space left on device", b"Invalid data found",
])
def test_non_retryable_failures_stop_without_fallback(detail):
    recovery = RecoveryCoordinator(_intent(cover_required=True))
    recovery.start("gpu-transcode")
    assert recovery.next_method(classify_ffmpeg_failure(detail)) is None
    assert len(recovery.attempts) == 1


def test_transient_io_is_classified_without_a_blind_repeat():
    recovery = RecoveryCoordinator(_intent())
    recovery.start("cpu-transcode")
    assert classify_ffmpeg_failure(b"Connection reset by peer") == FailureCategory.TRANSIENT_IO
    assert recovery.next_method(FailureCategory.TRANSIENT_IO) is None


def test_ffmpeg_banner_does_not_turn_container_failure_into_hardware_failure():
    detail = b"configuration: --enable-nvenc --enable-libmfx\n[flac @ 0x123] Audio codec mp3 not supported in flac\nCould not write header for output file\n"
    assert classify_ffmpeg_failure(detail) == FailureCategory.CONTAINER


def test_source_image_with_wrong_extension_keeps_bytes_and_reports_real_format(tmp_path):
    source = tmp_path / "mislabeled.bin"
    stream = io.BytesIO()
    Image.new("RGB", (11, 7), "navy").save(stream, format="JPEG")
    source.write_bytes(stream.getvalue())

    result = converter.convert_media(str(source), str(tmp_path / "output"), "photo", "source")

    assert result.endswith("photo.jpg")
    assert (tmp_path / "output" / "photo.jpg").read_bytes() == source.read_bytes()
    assert not list((tmp_path / "output").glob(".janeconverter-convert-*"))


def test_failed_attempt_keeps_final_directory_empty(tmp_path, monkeypatch):
    source = tmp_path / "source.bin"
    source.write_bytes(b"input stays untouched")

    def fail_after_writing(*_args, **kwargs):
        (tmp_path / "output" / "visible.mp4").parent.mkdir(exist_ok=True)
        stage = kwargs["output_dir"]
        from pathlib import Path
        (Path(stage) / "incomplete.mp4").write_bytes(b"partial")
        raise RuntimeError("conversion failed")

    monkeypatch.setattr(converter, "_convert_media_impl", fail_after_writing)
    with pytest.raises(RuntimeError, match="conversion failed"):
        converter.convert_media(str(source), str(tmp_path / "output"), "visible", "mp4")

    assert source.read_bytes() == b"input stays untouched"
    assert not list((tmp_path / "output").iterdir())


def test_video_recovery_rejects_missing_audio_or_changed_dimensions(monkeypatch):
    source = {"streams": [
        {"codec_type": "video", "width": 1920, "height": 1080},
        {"codec_type": "audio", "sample_rate": "48000"},
    ]}
    output = {"streams": [{"codec_type": "video", "width": 1280, "height": 720}]}
    monkeypatch.setattr(converter, "probe_media_streams", lambda path: source if path == "source" else output)
    with pytest.raises(RuntimeError, match="audio stream was lost"):
        converter.validate_output_intent("source", "output", _intent())
    output["streams"].append({"codec_type": "audio", "sample_rate": "48000"})
    with pytest.raises(RuntimeError, match="dimensions changed"):
        converter.validate_output_intent("source", "output", _intent())


def test_local_recovery_evidence_records_only_structural_outcome(tmp_path):
    recovery = RecoveryCoordinator(_intent())
    recovery.start("gpu-transcode")
    assert recovery.next_method(FailureCategory.HARDWARE) == "cpu-transcode"
    recovery.start("cpu-transcode")
    path = tmp_path / "recovery.json"

    record_local_success(str(path), recovery)
    saved = json.loads(path.read_text(encoding="utf-8"))

    assert saved["version"] == 1
    assert set(saved["entries"]) == {"mp4|hardware|cpu-transcode"}
    assert saved["entries"]["mp4|hardware|cpu-transcode"]["count"] == 1
    assert "source" not in path.read_text(encoding="utf-8")


def test_animation_is_not_silently_reduced_to_one_frame(tmp_path):
    source = tmp_path / "animated.gif"
    first = Image.new("RGB", (12, 8), "red")
    second = Image.new("RGB", (12, 8), "blue")
    first.save(source, save_all=True, append_images=[second], duration=[100, 100], loop=0)

    with pytest.raises(RuntimeError, match="discard animation frames"):
        converter.convert_media(str(source), str(tmp_path / "output"), "still", "jpg")

    assert source.exists()
    assert not list((tmp_path / "output").iterdir())


def test_png_format_change_requires_explicit_recovery_policy(tmp_path, monkeypatch):
    source = tmp_path / "source.bin"
    Image.new("RGBA", (9, 6), (20, 30, 40, 100)).save(tmp_path / "source.png")
    source.write_bytes((tmp_path / "source.png").read_bytes())
    real_validate = converter.validate_output_file
    source_checks = 0

    def fail_source_validation(path, target_format, *args, **kwargs):
        nonlocal source_checks
        if target_format == "png" and path.endswith("source.png") and source_checks < 2:
            source_checks += 1
            raise RuntimeError("ValidationFailed: source-preserving path rejected")
        return real_validate(path, target_format, *args, **kwargs)

    monkeypatch.setattr(converter, "validate_output_file", fail_source_validation)
    monkeypatch.setattr(converter, "record_local_success", lambda *_args: None)
    with pytest.raises(RuntimeError, match="source-preserving path rejected"):
        converter.convert_media(str(source), str(tmp_path / "blocked"), "source", "source")
    assert not list((tmp_path / "blocked").iterdir())

    messages = []
    output = converter.convert_media(
        str(source), str(tmp_path / "allowed"), "source", "source",
        allow_lossless_png_recovery=True,
        progress_callback=lambda _progress, message: messages.append(message),
    )
    assert output.endswith(".png")
    assert source.read_bytes() == (tmp_path / "source.png").read_bytes()
    assert any("Recovered" in message and "PNG" in message for message in messages)


def test_audio_recovery_rejects_wrong_bit_depth_and_missing_cover(monkeypatch):
    from dataclasses import replace
    wav_intent = replace(_intent(), target_format="wav", quality="24-bit", cover_required=False)
    output = {"streams": [{"codec_type": "audio", "sample_rate": "48000", "codec_name": "pcm_s16le"}]}
    monkeypatch.setattr(converter, "probe_media_streams", lambda _path: output)
    with pytest.raises(RuntimeError, match="WAV bit depth"):
        converter.validate_output_intent("source", "output", wav_intent)

    mp3_intent = replace(wav_intent, target_format="mp3", quality="320k", cover_required=True)
    with pytest.raises(RuntimeError, match="cover art"):
        converter.validate_output_intent("source", "output", mp3_intent)


def test_audio_recovery_rejects_channel_loss(monkeypatch):
    source = {"streams": [{"codec_type": "audio", "channels": 2}]}
    output = {"streams": [{"codec_type": "audio", "channels": 1, "sample_rate": "48000"}]}
    monkeypatch.setattr(converter, "probe_media_streams", lambda path: source if path == "source" else output)
    from dataclasses import replace
    with pytest.raises(RuntimeError, match="channel count changed"):
        converter.validate_output_intent("source", "output", replace(_intent(), target_format="mp3"))


def test_gif_recovery_rejects_changed_requested_frame_rate(monkeypatch):
    from dataclasses import replace
    output = {"streams": [{"codec_type": "video", "avg_frame_rate": "10/1"}]}
    monkeypatch.setattr(converter, "probe_media_streams", lambda _path: output)
    with pytest.raises(RuntimeError, match="GIF frame rate"):
        converter.validate_output_intent("source", "output", replace(_intent(), target_format="gif", fps=24))


def test_video_recovery_rejects_truncated_duration(monkeypatch):
    source = {"streams": [{"codec_type": "video", "width": 640, "height": 360}], "format": {"duration": "10.0"}}
    output = {"streams": [{"codec_type": "video", "width": 640, "height": 360}], "format": {"duration": "3.0"}}
    monkeypatch.setattr(converter, "probe_media_streams", lambda path: source if path == "source" else output)
    with pytest.raises(RuntimeError, match="duration changed"):
        converter.validate_output_intent("source", "output", _intent())


def test_recovery_rejects_lost_requested_metadata(monkeypatch):
    from dataclasses import replace
    output = {"streams": [{"codec_type": "audio", "sample_rate": "48000"}], "format": {"tags": {"title": "Other"}}}
    monkeypatch.setattr(converter, "probe_media_streams", lambda _path: output)
    intent = replace(_intent(), target_format="mp3", metadata=(("title", "Requested"),))
    with pytest.raises(RuntimeError, match="metadata was not retained"):
        converter.validate_output_intent("source", "output", intent)


def test_recovery_rejects_video_frame_rate_change(monkeypatch):
    source = {"streams": [{"codec_type": "video", "width": 640, "height": 360, "avg_frame_rate": "30/1"}]}
    output = {"streams": [{"codec_type": "video", "width": 640, "height": 360, "avg_frame_rate": "15/1"}]}
    monkeypatch.setattr(converter, "probe_media_streams", lambda path: source if path == "source" else output)
    with pytest.raises(RuntimeError, match="video frame rate changed"):
        converter.validate_output_intent("source", "output", _intent())


def test_image_recovery_preserves_profile_or_stops_before_bad_color_conversion(tmp_path):
    rgb_source = tmp_path / "profiled.png"
    Image.new("RGB", (7, 5), "red").save(rgb_source, icc_profile=b"test-rgb-profile")
    result = converter.convert_media(str(rgb_source), str(tmp_path / "out"), "photo", "webp")
    with Image.open(result) as converted:
        assert converted.info["icc_profile"] == b"test-rgb-profile"

    cmyk_source = tmp_path / "profiled-cmyk.tif"
    Image.new("CMYK", (7, 5), (0, 100, 100, 0)).save(cmyk_source, icc_profile=b"test-cmyk-profile")
    with pytest.raises(ValueError, match="color-managed CMYK"):
        converter.convert_media(str(cmyk_source), str(tmp_path / "blocked"), "photo", "png")
    assert cmyk_source.exists()
    assert not list((tmp_path / "blocked").iterdir())


def test_staged_output_waits_for_transient_windows_file_lock(tmp_path, monkeypatch):
    source = tmp_path / "photo.png"
    Image.new("RGB", (7, 5), "blue").save(source)
    original_replace = converter.os.replace
    attempts = []

    def replace_after_lock(staged_path, final_path):
        attempts.append((staged_path, final_path))
        if len(attempts) == 1:
            error = PermissionError("file is temporarily in use")
            error.winerror = 32
            raise error
        original_replace(staged_path, final_path)

    monkeypatch.setattr(converter.os, "replace", replace_after_lock)
    monkeypatch.setattr(converter.time, "sleep", lambda _delay: None)
    result = converter.convert_media(str(source), str(tmp_path / "out"), "photo", "webp")

    assert len(attempts) == 2
    assert result.endswith(".webp")
    assert (tmp_path / "out" / "photo.webp").is_file()
    assert not list((tmp_path / "out").glob(".janeconverter-convert-*"))


def test_recovery_output_summary_contains_properties_without_metadata(monkeypatch):
    output = {"streams": [
        {"codec_type": "video", "width": 1280, "height": 720, "tags": {"title": "Private"}},
        {"codec_type": "audio", "channels": 2},
    ]}
    monkeypatch.setattr(converter, "probe_media_streams", lambda _path: output)
    summary = converter.validated_output_properties("hidden-source.mp4", "mp4")
    assert summary == "1280×720, with audio"
    assert "Private" not in summary
    assert "hidden-source" not in summary


def test_requested_audio_metadata_survives_real_conversion(tmp_path):
    source = tmp_path / "tone.wav"
    cover = tmp_path / "cover.jpg"
    Image.new("RGB", (64, 64), "purple").save(cover, format="JPEG")
    subprocess.run([
        converter.get_ffmpeg_binary(), "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2",
        "-ar", "48000", str(source),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    result = converter.convert_media(
        str(source), str(tmp_path / "out"), "song", "mp3",
        metadata={"title": "Requested title", "artist": "Jane Cerys", "comment": "Converted by JaneConverter"},
        cover_path=str(cover),
    )
    tags = converter.probe_media_streams(result)["format"]["tags"]
    assert tags["title"] == "Requested title"
    assert tags["artist"] == "Jane Cerys"
    assert tags["comment"] == "Converted by JaneConverter"


def test_requested_video_properties_survive_real_conversion(tmp_path, monkeypatch):
    monkeypatch.setattr(converter, "record_local_success", lambda *_args: None)
    source = tmp_path / "clip.mp4"
    subprocess.run([
        converter.get_ffmpeg_binary(), "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24:d=0.5",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    result = converter.convert_media(
        str(source), str(tmp_path / "out"), "clip", "mp4",
        use_gpu=False, allow_stream_copy=False,
        metadata={"title": "Requested clip"},
    )
    output = converter.probe_media_streams(result)
    assert output["format"]["tags"]["title"] == "Requested clip"
    assert any(stream["codec_type"] == "audio" for stream in output["streams"])
    assert any(stream["codec_type"] == "video" and stream["width"] == 160 and stream["height"] == 90
               for stream in output["streams"])

    monkeypatch.setattr(converter, "get_best_hardware_encoder", lambda **_kwargs: {
        "has_gpu": True, "encoder": "h264_qsv",
        "args": ["-c:v", "unavailable_qsv", "-global_quality", "23", "-pix_fmt", "nv12"],
    })
    messages = []
    recovered = converter.convert_media(
        str(source), str(tmp_path / "recovered"), "clip", "mp4",
        use_gpu=True, allow_stream_copy=False,
        progress_callback=lambda _progress, message: messages.append(message),
    )
    assert converter.probe_media_streams(recovered)
    assert any("gpu-transcode could not finish" in message and "cpu-transcode" in message for message in messages), messages
    assert any("Recovered from hardware" in message for message in messages)


def test_audio_container_recovery_reencodes_to_requested_flac(tmp_path, monkeypatch):
    monkeypatch.setattr(converter, "record_local_success", lambda *_args: None)
    source = tmp_path / "tone.mp3"
    subprocess.run([
        converter.get_ffmpeg_binary(), "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2",
        "-c:a", "libmp3lame", "-ar", "48000", str(source),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    monkeypatch.setattr(converter, "is_stream_copy_safe", lambda **_kwargs: True)
    messages = []
    result = converter.convert_media(
        str(source), str(tmp_path / "out"), "tone", "flac", bitrate="16-bit",
        use_gpu=False, progress_callback=lambda _progress, message: messages.append(message),
    )
    output = converter.probe_media_streams(result)
    audio = next(stream for stream in output["streams"] if stream["codec_type"] == "audio")
    assert audio["codec_name"] == "flac"
    assert audio["bits_per_raw_sample"] == "16"
    assert any("stream-copy could not finish" in message and "cpu-transcode" in message for message in messages)
