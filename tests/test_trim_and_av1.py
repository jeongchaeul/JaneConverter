"""Unit tests for time trimming offsets and AV1 video encoding support."""

import pytest

from janeconverter.converter import (
    sanitize_time_offset,
    parse_time_offset_seconds,
    build_ffmpeg_args,
    SUPPORTED_VIDEO_FORMATS,
    HARDWARE_VIDEO_FORMATS,
    OUTPUT_FILE_EXTENSIONS,
    VIDEO_ENCODER_PROFILES,
    _apply_video_quality_to_encoder_args,
    _detect_best_hardware_encoder,
)


def test_sanitize_time_offset_valid():
    assert sanitize_time_offset(None) is None
    assert sanitize_time_offset("") is None
    assert sanitize_time_offset("   ") is None
    assert sanitize_time_offset("90") == "90"
    assert sanitize_time_offset("45.5") == "45.5"
    assert sanitize_time_offset("01:30") == "01:30"
    assert sanitize_time_offset("00:01:30") == "00:01:30"
    assert sanitize_time_offset("01:15:20.5") == "01:15:20.5"


def test_sanitize_time_offset_invalid():
    with pytest.raises(ValueError, match="Invalid time offset"):
        sanitize_time_offset("-10")
    with pytest.raises(ValueError, match="Invalid time offset"):
        sanitize_time_offset("abc")
    with pytest.raises(ValueError, match="Invalid time offset"):
        sanitize_time_offset("01:2:3:4:5")


def test_parse_time_offset_seconds():
    assert parse_time_offset_seconds(None) is None
    assert parse_time_offset_seconds("") is None
    assert parse_time_offset_seconds("90") == 90.0
    assert parse_time_offset_seconds("45.5") == 45.5
    assert parse_time_offset_seconds("01:30") == 90.0
    assert parse_time_offset_seconds("00:01:30") == 90.0
    assert parse_time_offset_seconds("01:00:00") == 3600.0
    assert parse_time_offset_seconds("01:10:05.5") == 4205.5
    assert parse_time_offset_seconds("bad") is None


def test_build_ffmpeg_args_stream_copy_trim():
    args = build_ffmpeg_args(
        input_path="input.mp4",
        output_path="output.mp4",
        target_format="mp4",
        stream_copy=True,
        start_time="00:01:15",
        end_time="00:03:45",
    )
    ss_idx = args.index("-ss")
    to_idx = args.index("-to")
    i_idx = args.index("-i")
    assert args[ss_idx + 1] == "00:01:15"
    assert args[to_idx + 1] == "00:03:45"
    # Both -ss and -to must be placed before -i for fast keyframe seek
    assert ss_idx < i_idx
    assert to_idx < i_idx
    assert "-c:v" in args
    assert "copy" in args


def test_build_ffmpeg_args_transcode_trim():
    args = build_ffmpeg_args(
        input_path="input.mp4",
        output_path="output.mp3",
        target_format="mp3",
        stream_copy=False,
        start_time="10",
        end_time="50",
    )
    ss_idx = args.index("-ss")
    to_idx = args.index("-to")
    i_idx = args.index("-i")
    assert args[ss_idx + 1] == "10"
    assert args[to_idx + 1] == "50"
    assert ss_idx < i_idx
    assert to_idx < i_idx


def test_av1_format_registration():
    assert "av1" in SUPPORTED_VIDEO_FORMATS
    assert "av1" in HARDWARE_VIDEO_FORMATS
    assert OUTPUT_FILE_EXTENSIONS["av1"] == "mkv"
    assert VIDEO_ENCODER_PROFILES["av1"] == ("libsvtav1", "aac")


def test_av1_hardware_detection_and_profiles():
    # Test fallback CPU SVT-AV1
    cpu_spec = _detect_best_hardware_encoder("libsvtav1")
    assert cpu_spec["encoder"] == "libsvtav1"
    assert "-c:v" in cpu_spec["args"]
    assert "libsvtav1" in cpu_spec["args"]

    # Test NVIDIA AV1 NVENC
    nvenc_spec = _detect_best_hardware_encoder("av1_nvenc")
    assert nvenc_spec["encoder"] == "av1_nvenc"
    assert nvenc_spec["has_gpu"] is True

    # Test AMD AV1 AMF
    amf_spec = _detect_best_hardware_encoder("av1_amf")
    assert amf_spec["encoder"] == "av1_amf"
    assert amf_spec["has_gpu"] is True

    # Test Intel AV1 QSV
    qsv_spec = _detect_best_hardware_encoder("av1_qsv")
    assert qsv_spec["encoder"] == "av1_qsv"
    assert qsv_spec["has_gpu"] is True


def test_apply_video_quality_to_av1_encoders():
    # NVENC
    nvenc_args = _apply_video_quality_to_encoder_args(
        ["-c:v", "av1_nvenc"], "av1_nvenc", "best"
    )
    assert "-cq" in nvenc_args
    assert "20" in nvenc_args
    assert "-preset" in nvenc_args
    assert "p7" in nvenc_args

    # SVT-AV1
    svt_args = _apply_video_quality_to_encoder_args(
        ["-c:v", "libsvtav1"], "libsvtav1", "small"
    )
    assert "-crf" in svt_args
    assert "34" in svt_args
    assert "-preset" in svt_args
    assert "8" in svt_args
