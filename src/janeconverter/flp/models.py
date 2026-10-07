"""
FLP binary data models for events and project chunks.
"""

from dataclasses import dataclass, field
import struct
from typing import List, Optional


def write_varint(value: int) -> bytes:
    """Encode an integer as a little-endian 7-bit variable length quantity (Varint)."""
    if value < 0:
        raise ValueError(f"Varint value cannot be negative: {value}")
    out = bytearray()
    while True:
        b = value & 0x7F
        value >>= 7
        if value > 0:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)


@dataclass
class FLPEvent:
    """A single FL Studio event chunk in the FLdt stream."""
    event_id: int
    data: bytes = field(default_factory=bytes)

    @property
    def is_variable_length(self) -> bool:
        return self.event_id >= 192

    @property
    def fixed_length(self) -> Optional[int]:
        if self.event_id < 64:
            return 1
        elif self.event_id < 128:
            return 2
        elif self.event_id < 192:
            return 4
        return None

    def to_bytes(self) -> bytes:
        """Serialize event to binary byte sequence."""
        buf = bytearray([self.event_id & 0xFF])
        if self.is_variable_length:
            buf.extend(write_varint(len(self.data)))
            buf.extend(self.data)
        else:
            exp_len = self.fixed_length
            if exp_len is not None and len(self.data) != exp_len:
                # Pad or truncate to ensure strict binary conformity
                if len(self.data) < exp_len:
                    buf.extend(self.data + b"\x00" * (exp_len - len(self.data)))
                else:
                    buf.extend(self.data[:exp_len])
            else:
                buf.extend(self.data)
        return bytes(buf)


@dataclass
class FLPProject:
    """An FL Studio project file consisting of an FLhd header and FLdt event stream."""
    format: int = 0
    channels: int = 0
    ppq: int = 96
    events: List[FLPEvent] = field(default_factory=list)

    def to_bytes(self) -> bytes:
        """Serialize the entire project to a valid Image-Line .flp binary file."""
        # 1. Header chunk (FLhd)
        # Magic (4) + Length (4, always 6) + Format (2) + Channels (2) + PPQ (2)
        flhd_payload = struct.pack("<HHH", self.format, self.channels, self.ppq)
        flhd_chunk = b"FLhd" + struct.pack("<I", len(flhd_payload)) + flhd_payload

        # 2. Data chunk (FLdt)
        fldt_payload = bytearray()
        for ev in self.events:
            fldt_payload.extend(ev.to_bytes())

        fldt_chunk = b"FLdt" + struct.pack("<I", len(fldt_payload)) + bytes(fldt_payload)

        return flhd_chunk + fldt_chunk
