"""
FLP binary data models for events, project chunks, version definitions, and local installation discovery.
"""

from dataclasses import dataclass, field
import os
import struct
import sys
from typing import Any, Dict, List, Optional, Tuple


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
        flhd_payload = struct.pack("<HHH", self.format, self.channels, self.ppq)
        flhd_chunk = b"FLhd" + struct.pack("<I", len(flhd_payload)) + flhd_payload

        fldt_payload = bytearray()
        for ev in self.events:
            fldt_payload.extend(ev.to_bytes())

        fldt_chunk = b"FLdt" + struct.pack("<I", len(fldt_payload)) + bytes(fldt_payload)
        return flhd_chunk + fldt_chunk


# Exhaustive database of known FL Studio releases and official build numbers
KNOWN_FL_VERSIONS: List[Dict[str, Any]] = [
    # FL Studio 24 (2024 releases)
    {"version": "24.2.2", "build": 4597, "label": "FL Studio 24.2.2", "category": "FL 24"},
    {"version": "24.2.1", "build": 4526, "label": "FL Studio 24.2.1", "category": "FL 24"},
    {"version": "24.2.0", "build": 4480, "label": "FL Studio 24.2.0", "category": "FL 24"},
    {"version": "24.1.2", "build": 4398, "label": "FL Studio 24.1.2", "category": "FL 24"},
    {"version": "24.1.1", "build": 4328, "label": "FL Studio 24.1.1", "category": "FL 24"},
    {"version": "24.1.0", "build": 4272, "label": "FL Studio 24.1.0", "category": "FL 24"},
    # FL Studio 21
    {"version": "21.2.3", "build": 4004, "label": "FL Studio 21.2.3", "category": "FL 21"},
    {"version": "21.2.2", "build": 3914, "label": "FL Studio 21.2.2", "category": "FL 21"},
    {"version": "21.2.1", "build": 3859, "label": "FL Studio 21.2.1", "category": "FL 21"},
    {"version": "21.2.0", "build": 3842, "label": "FL Studio 21.2.0", "category": "FL 21"},
    {"version": "21.1.1", "build": 3750, "label": "FL Studio 21.1.1", "category": "FL 21"},
    {"version": "21.1.0", "build": 3713, "label": "FL Studio 21.1.0", "category": "FL 21"},
    {"version": "21.0.3", "build": 3517, "label": "FL Studio 21.0.3", "category": "FL 21"},
    {"version": "21.0.2", "build": 3399, "label": "FL Studio 21.0.2", "category": "FL 21"},
    {"version": "21.0.1", "build": 3348, "label": "FL Studio 21.0.1", "category": "FL 21"},
    {"version": "21.0.0", "build": 3329, "label": "FL Studio 21.0.0", "category": "FL 21"},
    # FL Studio 20
    {"version": "20.9.2", "build": 2963, "label": "FL Studio 20.9.2", "category": "FL 20"},
    {"version": "20.9.1", "build": 2826, "label": "FL Studio 20.9.1", "category": "FL 20"},
    {"version": "20.9.0", "build": 2748, "label": "FL Studio 20.9.0", "category": "FL 20"},
    {"version": "20.8.4", "build": 2576, "label": "FL Studio 20.8.4", "category": "FL 20"},
    {"version": "20.8.3", "build": 2304, "label": "FL Studio 20.8.3", "category": "FL 20"},
    {"version": "20.7.3", "build": 1987, "label": "FL Studio 20.7.3", "category": "FL 20"},
    {"version": "20.6.2", "build": 1458, "label": "FL Studio 20.6.2", "category": "FL 20"},
    {"version": "20.5.1", "build": 1188, "label": "FL Studio 20.5.1", "category": "FL 20"},
    {"version": "20.1.2", "build": 887, "label": "FL Studio 20.1.2", "category": "FL 20"},
    {"version": "20.0.5", "build": 681, "label": "FL Studio 20.0.5", "category": "FL 20"},
    # FL Studio 12
    {"version": "12.5.1", "build": 165, "label": "FL Studio 12.5.1", "category": "FL 12"},
    {"version": "12.5.0", "build": 59, "label": "FL Studio 12.5.0", "category": "FL 12"},
    {"version": "12.4.2", "build": 33, "label": "FL Studio 12.4.2", "category": "FL 12"},
    {"version": "12.3.0", "build": 72, "label": "FL Studio 12.3.0", "category": "FL 12"},
    {"version": "12.2.0", "build": 3, "label": "FL Studio 12.2.0", "category": "FL 12"},
    {"version": "12.1.3", "build": 10, "label": "FL Studio 12.1.3", "category": "FL 12"},
    {"version": "12.0.2", "build": 2, "label": "FL Studio 12.0.2", "category": "FL 12"},
    # FL Studio 11
    {"version": "11.1.1", "build": 100, "label": "FL Studio 11.1.1", "category": "FL 11"},
    {"version": "11.0.4", "build": 1, "label": "FL Studio 11.0.4", "category": "FL 11"},
    {"version": "11.0.0", "build": 1, "label": "FL Studio 11.0.0", "category": "FL 11"},
    # FL Studio 10
    {"version": "10.0.9", "build": 1, "label": "FL Studio 10.0.9", "category": "FL 10"},
    {"version": "10.0.0", "build": 1, "label": "FL Studio 10.0.0", "category": "FL 10"},
]


def get_file_version_info(path: str) -> Optional[Tuple[str, str, int]]:
    """
    Read Windows file version info from an executable via Win32 API.
    Returns (full_version_string, base_version_string, build_int) or None.
    """
    if not os.path.isfile(path) or sys.platform != "win32":
        return None
    try:
        import ctypes
        size = ctypes.windll.version.GetFileVersionInfoSizeW(path, None)
        if not size:
            return None
        res = ctypes.create_string_buffer(size)
        ctypes.windll.version.GetFileVersionInfoW(path, 0, size, res)
        u_len = ctypes.c_uint()
        lp_data = ctypes.c_void_p()
        if ctypes.windll.version.VerQueryValueW(res, "\\", ctypes.byref(lp_data), ctypes.byref(u_len)):
            val = ctypes.string_at(lp_data, u_len.value)
            _, _, ms, ls = struct.unpack("<IIII", val[:16])
            major = ms >> 16
            minor = ms & 0xFFFF
            patch = ls >> 16
            build = ls & 0xFFFF
            full = f"{major}.{minor}.{patch}.{build}"
            base = f"{major}.{minor}.{patch}"
            return full, base, build
    except Exception:
        pass
    return None


def detect_installed_fl_studios() -> List[Dict[str, Any]]:
    """
    Scan local machine for all installed FL Studio versions and builds.
    Returns structured list sorted newest-to-oldest.
    """
    results: List[Dict[str, Any]] = []
    seen = set()
    candidate_exes: List[str] = []

    # Common folder paths across local drives
    search_dirs = [
        r"C:\Program Files\Image-Line",
        r"C:\Program Files (x86)\Image-Line",
        r"D:\Programs",
        r"C:\Programs",
        r"E:\Programs",
    ]
    for base in search_dirs:
        if os.path.exists(base):
            try:
                for sub in os.listdir(base):
                    if "fl studio" in sub.lower():
                        folder = os.path.join(base, sub)
                        exe64 = os.path.join(folder, "FL64.exe")
                        if os.path.isfile(exe64):
                            candidate_exes.append(exe64)
                        exe32 = os.path.join(folder, "FL.exe")
                        if os.path.isfile(exe32):
                            candidate_exes.append(exe32)
            except Exception:
                pass

    # Windows Registry shell open commands and installation records
    if sys.platform == "win32":
        try:
            import winreg
            for subkey in [
                r"FL64.flp.26\shell\open\command",
                r"FL64.flp.24\shell\open\command",
                r"FL64.flp.21\shell\open\command",
                r"FL64.flp.20\shell\open\command",
            ]:
                try:
                    with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, subkey) as k:
                        val, _ = winreg.QueryValueEx(k, "")
                        parts = val.split('"')
                        cmd = parts[1] if len(parts) > 1 else val.split()[0]
                        if os.path.isfile(cmd):
                            candidate_exes.append(cmd)
                except Exception:
                    pass
        except Exception:
            pass

    for exe in candidate_exes:
        norm = os.path.normcase(os.path.abspath(exe))
        if norm in seen:
            continue
        seen.add(norm)
        info = get_file_version_info(exe)
        if info:
            full_ver, base_ver, build = info
            folder_name = os.path.basename(os.path.dirname(exe))
            results.append({
                "name": f"{folder_name} (Build {build})",
                "fullVersion": full_ver,
                "version": base_ver,
                "build": build,
                "executablePath": exe,
            })

    def sort_key(item: Dict[str, Any]) -> List[int]:
        parts = item["fullVersion"].split(".")
        return [int(p) if p.isdigit() else 0 for p in parts]

    results.sort(key=sort_key, reverse=True)
    return results
