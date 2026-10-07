"""
Binary parser for Image-Line FL Studio (.flp) projects.
Parses FLhd header and FLdt event stream into structured objects.
"""

import io
import struct
from typing import BinaryIO
from .models import FLPEvent, FLPProject


class FLPParseError(ValueError):
    """Raised when an FLP file has invalid headers or corrupted byte stream."""
    pass


def parse_varint(stream: BinaryIO) -> int:
    """Read a little-endian 7-bit variable length quantity (Varint) from a stream."""
    value = 0
    shift = 0
    while True:
        b_raw = stream.read(1)
        if not b_raw:
            raise FLPParseError("Unexpected end of file while reading variable length integer.")
        b = b_raw[0]
        value |= (b & 0x7F) << shift
        shift += 7
        if (b & 0x80) == 0:
            break
        if shift > 35:  # Safeguard against malformed streams
            raise FLPParseError("Varint overflow detected in FLP event.")
    return value


def parse_flp(data: bytes) -> FLPProject:
    """Parse raw FLP bytes into an FLPProject instance."""
    stream = io.BytesIO(data)

    # 1. Read FLhd chunk
    flhd_magic = stream.read(4)
    if flhd_magic != b"FLhd":
        raise FLPParseError(f"Invalid FLP header magic: expected b'FLhd', got {flhd_magic!r}")

    flhd_len_raw = stream.read(4)
    if len(flhd_len_raw) < 4:
        raise FLPParseError("Truncated FLhd header length.")
    flhd_len = struct.unpack("<I", flhd_len_raw)[0]
    if flhd_len < 6:
        raise FLPParseError(f"Invalid FLhd chunk length: {flhd_len} (minimum 6 bytes required).")

    flhd_data = stream.read(flhd_len)
    if len(flhd_data) < 6:
        raise FLPParseError("Truncated FLhd chunk payload.")

    fmt, channels, ppq = struct.unpack("<HHH", flhd_data[:6])

    # 2. Find and read FLdt chunk(s)
    events = []
    while True:
        chunk_magic = stream.read(4)
        if not chunk_magic:
            break
        chunk_len_raw = stream.read(4)
        if len(chunk_len_raw) < 4:
            break
        chunk_len = struct.unpack("<I", chunk_len_raw)[0]

        if chunk_magic == b"FLdt":
            chunk_bytes = stream.read(chunk_len)
            data_stream = io.BytesIO(chunk_bytes)
            while True:
                ev_id_byte = data_stream.read(1)
                if not ev_id_byte:
                    break
                ev_id = ev_id_byte[0]
                if ev_id < 64:
                    ev_data = data_stream.read(1)
                elif ev_id < 128:
                    ev_data = data_stream.read(2)
                elif ev_id < 192:
                    ev_data = data_stream.read(4)
                else:
                    var_len = parse_varint(data_stream)
                    ev_data = data_stream.read(var_len)
                events.append(FLPEvent(event_id=ev_id, data=ev_data))
        else:
            # Skip unknown or auxiliary chunks (e.g., sample chunks or metadata)
            stream.seek(chunk_len, io.SEEK_CUR)

    return FLPProject(
        format=fmt,
        channels=channels,
        ppq=ppq,
        events=events,
    )


def parse_flp_file(path: str) -> FLPProject:
    """Read and parse an FLP file from a local file path."""
    with open(path, "rb") as f:
        data = f.read()
    return parse_flp(data)
