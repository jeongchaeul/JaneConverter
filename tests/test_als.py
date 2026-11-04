"""
Unit tests for Ableton Live (.als) parser, inspector, and migration engine.
"""

import gzip
import os
import pytest

from janeconverter.als import (
    AlsParseError,
    inspect_als,
    inspect_als_file,
    migrate_als_bytes,
    migrate_als_file,
    normalize_als_target_key,
    parse_als,
    parse_als_file,
)


SAMPLE_LIVE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" SchemaChangeCount="3" Creator="Ableton Live 12.0.1" Revision="f56d09c8">
  <LiveSet>
    <Tracks>
      <AudioTrack Id="1">
        <Name>
          <EffectiveName Value="Lead Vocal" />
        </Name>
      </AudioTrack>
      <MidiTrack Id="2">
        <Name>
          <UserName Value="Bass Synth" />
        </Name>
        <DeviceChain>
          <DeviceChain>
            <Devices>
              <PluginDevice Id="10">
                <PluginDesc>
                  <Vst3PluginInfo>
                    <PlugName Value="Vital" />
                  </Vst3PluginInfo>
                </PluginDesc>
              </PluginDevice>
            </Devices>
          </DeviceChain>
        </DeviceChain>
      </MidiTrack>
    </Tracks>
    <MasterTrack>
      <DeviceChain>
        <Mixer>
          <Tempo>
            <Manual Value="138.0" />
          </Tempo>
        </Mixer>
      </DeviceChain>
    </MasterTrack>
  </LiveSet>
</Ableton>
"""


def _create_sample_als_bytes(xml_text: str = SAMPLE_LIVE_XML) -> bytes:
    return gzip.compress(xml_text.encode("utf-8"))


def test_normalize_als_target_key():
    assert normalize_als_target_key("11") == "11"
    assert normalize_als_target_key("Live 11") == "11"
    assert normalize_als_target_key("Ableton Live 10") == "10"
    assert normalize_als_target_key("9.7") == "9"


def test_parse_als_metadata_and_tracks():
    data = _create_sample_als_bytes()
    proj = parse_als(data)

    assert proj.creator == "Ableton Live 12.0.1"
    assert proj.detected_major == 12
    assert proj.minor_version == "12.0_12049"
    assert proj.schema_change_count == "3"
    assert proj.bpm == 138.0
    assert proj.tracks_count == 2
    assert proj.track_names == ["Lead Vocal", "Bass Synth"]
    assert proj.plugins_count == 1
    assert proj.plugin_names == ["Vital"]


def test_parse_als_rejects_empty_and_corrupt_data():
    with pytest.raises(AlsParseError, match="empty"):
        parse_als(b"")

    with pytest.raises(AlsParseError, match="gzip-compressed"):
        parse_als(b"Not an als file at all")


def test_inspect_als_and_file(tmp_path):
    data = _create_sample_als_bytes()
    test_als = tmp_path / "MySong Project.als"
    test_als.write_bytes(data)

    info = inspect_als_file(str(test_als))
    assert info["fileName"] == "MySong Project.als"
    assert info["title"] == "MySong Project"
    assert info["majorVersion"] == 12
    assert info["bpm"] == 138.0
    assert info["tracksCount"] == 2
    assert "Lead Vocal" in info["tracks"]
    assert "Vital" in info["plugins"]


def test_migrate_als_bytes_to_live_11():
    data = _create_sample_als_bytes()
    migrated_bytes, summary = migrate_als_bytes(data, target_version="11")

    assert summary["success"] is True
    assert summary["sourceMajor"] == 12
    assert summary["targetMajor"] == 11
    assert summary["targetProfile"] == "11"

    # Verify migrated XML structure
    decompressed = gzip.decompress(migrated_bytes).decode("utf-8")
    assert 'Creator="Ableton Live 11.3.10"' in decompressed
    assert 'MinorVersion="11.0_11300"' in decompressed

    # Parse with parser
    migrated_proj = parse_als(migrated_bytes)
    assert migrated_proj.detected_major == 11
    assert migrated_proj.tracks_count == 2
    assert migrated_proj.bpm == 138.0


def test_migrate_als_file_with_backup(tmp_path):
    data = _create_sample_als_bytes()
    source_file = tmp_path / "Summer_Track.als"
    source_file.write_bytes(data)

    out_file = tmp_path / "Summer_Track_v11.als"
    summary = migrate_als_file(str(source_file), target_version="11", output_path=str(out_file))

    assert summary["success"] is True
    assert os.path.isfile(out_file)

    migrated_proj = parse_als_file(str(out_file))
    assert migrated_proj.detected_major == 11


def test_parse_als_rejects_xml_entities_and_gzip_bombs(monkeypatch):
    import janeconverter.als.parser as als_parser

    xxe_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE Ableton [
      <!ENTITY lol "lololololol">
    ]>
    <Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.0.1">
      <LiveSet></LiveSet>
    </Ableton>
    """
    with pytest.raises(AlsParseError, match="Unsafe XML DOCTYPE or ENTITY"):
        parse_als(gzip.compress(xxe_xml.encode("utf-8")))

    # UTF-16 encoded DOCTYPE/ENTITY should also be rejected
    with pytest.raises(AlsParseError, match="Unsafe XML DOCTYPE or ENTITY"):
        parse_als(gzip.compress(xxe_xml.encode("utf-16")))

    # Gzip decompression bomb exceeding MAX_ALS_FILE_SIZE should be rejected without unbounded decompression
    monkeypatch.setattr(als_parser, "MAX_ALS_FILE_SIZE", 1024)
    oversized_payload = gzip.compress(b"<Ableton>" + (b"A" * 4096) + b"</Ableton>")
    with pytest.raises(AlsParseError, match="exceeds maximum ceiling"):
        parse_als(oversized_payload)
