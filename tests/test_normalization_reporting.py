import math
import shutil
import struct
import wave

import pytest

from janeconverter.converter import convert_media, build_loudnorm_filter
from janeconverter import converter


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="requires FFmpeg")
@pytest.mark.parametrize("force_dynamic,expected", [(False, "linear"), (True, "dynamic")])
def test_reports_the_actual_ffmpeg_normalization_mode(tmp_path, monkeypatch, force_dynamic, expected):
    source = tmp_path / "input.wav"
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(48000)
        audio.writeframes(b"".join(struct.pack("<h", int(2048 * math.sin(2 * math.pi * 440 * index / 48000))) for index in range(192000)))
    monkeypatch.setattr(converter, "measure_audio_loudness", lambda *a, **kw: {
        "input_i": "-27.85", "input_tp": "-24.08", "input_lra": "20" if force_dynamic else "1",
        "input_thresh": "-37.85", "target_offset": "-0.05"
    })
    messages = []
    convert_media(str(source), str(tmp_path / "output"), "normalized", "flac", normalize_audio=True,
                  progress_callback=lambda _value, message: messages.append(message))
    assert any(f"Normalization mode: {expected}." in message for message in messages), messages


def test_nonfinite_silence_measurements_do_not_form_invalid_ffmpeg_arguments():
    assert "measured_I" not in build_loudnorm_filter({"input_i": "-inf", "input_tp": "-inf", "input_lra": "0", "input_thresh": "-70", "target_offset": "inf"})
