"""
Unit tests for FL Studio Project (.flp) parsing, inspection, and downgrading.
"""

import io
import os
import struct
import pytest
from janeconverter.flp.models import FLPEvent, FLPProject, write_varint
from janeconverter.flp.parser import parse_varint, parse_flp, FLPParseError
from janeconverter.flp.inspector import inspect_flp
from janeconverter.flp.downgrade import downgrade_flp, downgrade_flp_file, normalize_target_key


def test_varint_roundtrip():
    test_values = [0, 1, 63, 127, 128, 255, 300, 16384, 2097151]
    for val in test_values:
        encoded = write_varint(val)
        decoded = parse_varint(io.BytesIO(encoded))
        assert decoded == val


def test_event_serialization():
    # 1-byte event (< 64)
    ev1 = FLPEvent(event_id=10, data=b"\x05")
    assert ev1.to_bytes() == b"\x0a\x05"

    # 2-byte event (64..127)
    ev2 = FLPEvent(event_id=68, data=struct.pack("<H", 1400))
    assert ev2.to_bytes() == b"\x44" + struct.pack("<H", 1400)

    # 4-byte event (128..191)
    ev4 = FLPEvent(event_id=130, data=b"\x01\x02\x03\x04")
    assert ev4.to_bytes() == b"\x82\x01\x02\x03\x04"

    # Variable-length event (>= 192)
    ev_var = FLPEvent(event_id=199, data=b"24.1.2.4398\x00")
    expected = b"\xc7" + write_varint(len(b"24.1.2.4398\x00")) + b"24.1.2.4398\x00"
    assert ev_var.to_bytes() == expected


def test_project_roundtrip():
    proj = FLPProject(
        format=0,
        channels=8,
        ppq=96,
        events=[
            FLPEvent(event_id=199, data=b"25.1.0.4000\x00"),
            FLPEvent(event_id=194, data="project//aspyr".encode("utf-16le")),
            FLPEvent(event_id=68, data=struct.pack("<H", 1750)),
            FLPEvent(event_id=28, data=b"\x01"),
        ],
    )
    raw = proj.to_bytes()
    assert raw.startswith(b"FLhd")
    assert b"FLdt" in raw

    parsed = parse_flp(raw)
    assert parsed.format == 0
    assert parsed.channels == 8
    assert parsed.ppq == 96
    assert len(parsed.events) == 4
    assert parsed.events[0].event_id == 199
    assert parsed.events[0].data == b"25.1.0.4000\x00"


def test_inspect_flp():
    proj = FLPProject(
        format=0,
        channels=12,
        ppq=192,
        events=[
            FLPEvent(event_id=199, data=b"25.1.0.4000\x00"),
            FLPEvent(event_id=194, data="Heavenly Demon".encode("utf-16le")),
            FLPEvent(event_id=68, data=struct.pack("<H", 1600)),
            FLPEvent(event_id=28, data=b"\x01"),
            FLPEvent(event_id=200, data="Jane Cerys".encode("utf-16le")),
        ],
    )
    info = inspect_flp(proj)
    assert info["version"] == "25.1.0.4000"
    assert info["majorVersion"] == 25
    assert info["title"] == "Heavenly Demon"
    assert info["bpm"] == 160.0
    assert info["ppq"] == 192
    assert info["channels"] == 12
    assert info["registered"] is True
    assert info["registrationName"] == "Jane Cerys"


def test_downgrade_flp_to_24():
    # FL 25 project with 80-byte playlist records
    dummy_playlist_80 = b"A" * 80
    proj = FLPProject(
        format=0,
        channels=4,
        ppq=96,
        events=[
            FLPEvent(event_id=199, data=b"25.1.0.4000\x00"),
            FLPEvent(event_id=212, data=dummy_playlist_80),
            FLPEvent(event_id=68, data=struct.pack("<H", 1400)),
        ],
    )

    result = downgrade_flp(proj, target_version_key="24")
    summary = result["summary"]
    new_proj: FLPProject = result["project"]

    assert summary["success"] is True
    assert summary["sourceMajor"] == 25
    assert summary["targetProfile"] == "24"
    assert summary["recordsAdjusted"] == 1

    # Check version event is updated
    assert new_proj.events[0].event_id == 199
    assert b"24.1.2" in new_proj.events[0].data

    # Check event 212 is trimmed to 60 bytes
    assert new_proj.events[1].event_id == 212
    assert len(new_proj.events[1].data) == 60
    assert new_proj.events[1].data == b"A" * 60


def test_downgrade_flp_file(tmp_path):
    proj = FLPProject(
        format=0,
        channels=10,
        ppq=96,
        events=[
            FLPEvent(event_id=199, data=b"25.0.0.1234\x00"),
            FLPEvent(event_id=194, data="Test Downgrade".encode("utf-16le")),
            FLPEvent(event_id=68, data=struct.pack("<H", 1500)),
        ],
    )
    src_file = str(tmp_path / "original.flp")
    dst_file = str(tmp_path / "downgraded.flp")

    with open(src_file, "wb") as f:
        f.write(proj.to_bytes())

    summary = downgrade_flp_file(src_file, target_version_key="21", output_path=dst_file)
    assert summary["success"] is True
    assert summary["targetProfile"] == "21"
    assert summary["outputPath"] == dst_file

    # Parse back the downgraded file
    downgraded_proj = parse_flp(open(dst_file, "rb").read())
    info = inspect_flp(downgraded_proj)
    assert info["majorVersion"] == 21
    assert "21.2.3" in info["version"]
    assert info["bpm"] == 150.0


def test_invalid_flp_header():
    with pytest.raises(FLPParseError):
        parse_flp(b"RIFF\x00\x00\x00\x00WAVE")


def test_normalize_target_key():
    assert normalize_target_key("FL24") == "24"
    assert normalize_target_key("fl 21") == "21"
    assert normalize_target_key("20") == "20"
    assert normalize_target_key("studio 12") == "12"


def test_cli_flp_inspect_and_downgrade(tmp_path, capsys):
    import json
    import sys
    from janeconverter.cli import main

    proj = FLPProject(
        format=0,
        channels=6,
        ppq=96,
        events=[
            FLPEvent(event_id=199, data=b"25.0.0.100\x00"),
            FLPEvent(event_id=194, data="CLI Project".encode("utf-16le")),
            FLPEvent(event_id=68, data=struct.pack("<H", 1300)),
        ],
    )
    test_flp = str(tmp_path / "cli_test.flp")
    out_flp = str(tmp_path / "cli_out.flp")
    with open(test_flp, "wb") as f:
        f.write(proj.to_bytes())

    # 1. Test inspect
    orig_argv = sys.argv
    try:
        sys.argv = ["janeconverter", "--flp-inspect", test_flp]
        main()
        out = capsys.readouterr().out
        data = json.loads(out)
        assert data["version"] == "25.0.0.100"
        assert data["title"] == "CLI Project"
        assert data["bpm"] == 130.0

        # 2. Test downgrade
        sys.argv = [
            "janeconverter",
            "--flp-downgrade", test_flp,
            "--flp-target", "20",
            "--flp-output", out_flp,
        ]
        main()
        out2 = capsys.readouterr().out
        summary = json.loads(out2)
        assert summary["success"] is True
        assert summary["targetProfile"] == "20"
        assert summary["outputPath"] == out_flp

        # Verify downgraded file
        info = inspect_flp(parse_flp(open(out_flp, "rb").read()))
        assert info["majorVersion"] == 20
    finally:
        sys.argv = orig_argv


def test_detect_installed_fl_studios():
    from janeconverter.flp.models import detect_installed_fl_studios
    # Function runs safely on any environment
    installs = detect_installed_fl_studios()
    assert isinstance(installs, list)
    for inst in installs:
        assert "name" in inst
        assert "version" in inst
        assert "build" in inst
        assert "executablePath" in inst


def test_adaptive_build_downgrade(tmp_path):
    proj = FLPProject(
        format=0,
        channels=2,
        ppq=96,
        events=[
            FLPEvent(event_id=199, data=b"26.1.4.5589\x00"),
            FLPEvent(event_id=159, data=struct.pack("<I", 5589)),
            FLPEvent(event_id=68, data=struct.pack("<H", 1400)),
        ],
    )
    test_file = str(tmp_path / "modern_fl26.flp")
    with open(test_file, "wb") as f:
        f.write(proj.to_bytes())

    # Downgrade with explicit version and build (e.g. user's 21.2.3.4004)
    summary = downgrade_flp_file(
        input_path=test_file,
        target_version_key="21.2.3",
        target_build=4004,
        overwrite=True,
    )
    assert summary["success"] is True
    assert summary["targetVersion"] == "21.2.3"
    assert summary["targetBuild"] == 4004
    assert summary["backupPath"] is not None
    assert os.path.exists(summary["backupPath"])

    # Inspect downgraded file
    info = inspect_flp(parse_flp(open(test_file, "rb").read()))
    assert info["majorVersion"] == 21
    assert "21.2.3" in info["version"]
    assert info["build"] == 4004


