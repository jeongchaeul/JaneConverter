"""Robust, lock-aware browser cookie database reading for yt-dlp.

On Windows, Chromium-based browsers (Chrome, Edge, Brave, Vivaldi, Opera) lock
their cookie database (Network\\Cookies) exclusively while running. This module
uses non-destructive Win32 handle duplication to safely stream a snapshot of the
active cookie database without terminating or disrupting running browser processes,
background network services, or active WebSockets.
"""

import os
import shutil
import sqlite3
import threading
from typing import List, Optional

# Win32 / NT API definitions for non-destructive handle duplication
if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32
    ntdll = ctypes.windll.ntdll
    rstrtmgr = ctypes.windll.rstrtmgr

    kernel32.DuplicateHandle.argtypes = [
        wintypes.HANDLE,
        wintypes.HANDLE,
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.HANDLE),
        wintypes.DWORD,
        wintypes.BOOL,
        wintypes.DWORD,
    ]
    kernel32.DuplicateHandle.restype = wintypes.BOOL

    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE

    kernel32.GetCurrentProcess.restype = wintypes.HANDLE

    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    kernel32.GetFinalPathNameByHandleW.argtypes = [
        wintypes.HANDLE,
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
    ]
    kernel32.GetFinalPathNameByHandleW.restype = wintypes.DWORD

    kernel32.GetFileType.argtypes = [wintypes.HANDLE]
    kernel32.GetFileType.restype = wintypes.DWORD

    kernel32.ReadFile.argtypes = [
        wintypes.HANDLE,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.c_void_p,
    ]
    kernel32.ReadFile.restype = wintypes.BOOL

    kernel32.SetFilePointerEx.argtypes = [
        wintypes.HANDLE,
        wintypes.LARGE_INTEGER,
        ctypes.POINTER(wintypes.LARGE_INTEGER),
        wintypes.DWORD,
    ]
    kernel32.SetFilePointerEx.restype = wintypes.BOOL

    class RM_UNIQUE_PROCESS(ctypes.Structure):
        _fields_ = [
            ("dwProcessId", wintypes.DWORD),
            ("ProcessStartTime", wintypes.FILETIME),
        ]

    class RM_PROCESS_INFO(ctypes.Structure):
        _fields_ = [
            ("Process", RM_UNIQUE_PROCESS),
            ("strAppName", wintypes.WCHAR * 256),
            ("strServiceShortName", wintypes.WCHAR * 64),
            ("ApplicationType", wintypes.DWORD),
            ("AppStatus", wintypes.DWORD),
            ("TSSessionId", wintypes.DWORD),
            ("bRestartable", wintypes.BOOL),
        ]

    SystemExtendedHandleInformation = 64

    class SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX(ctypes.Structure):
        _fields_ = [
            ("Object", ctypes.c_void_p),
            ("UniqueProcessId", ctypes.c_size_t),
            ("HandleValue", ctypes.c_size_t),
            ("GrantedAccess", wintypes.ULONG),
            ("CreatorBackTraceIndex", wintypes.USHORT),
            ("ObjectTypeIndex", wintypes.USHORT),
            ("HandleAttributes", wintypes.ULONG),
            ("Reserved", wintypes.ULONG),
        ]


def clean_nt_path(path: str) -> str:
    """Strip Win32 device prefixes from paths returned by GetFinalPathNameByHandleW."""
    if path.startswith("\\\\?\\UNC\\"):
        return "\\\\" + path[8:]
    if path.startswith("\\\\?\\"):
        return path[4:]
    return path


def get_locking_pids(file_path: str) -> List[int]:
    """Query locking PIDs via Restart Manager in strictly read-only mode without shutting down anything."""
    if os.name != "nt" or not file_path or not os.path.exists(file_path):
        return []

    try:
        import ctypes
        from ctypes import wintypes

        rstrtmgr = ctypes.windll.rstrtmgr
        cch_rm_session_key = 32
        session_handle = wintypes.DWORD(0)
        session_key = (wintypes.WCHAR * (cch_rm_session_key + 1))()

        res = rstrtmgr.RmStartSession(ctypes.byref(session_handle), 0, session_key)
        if res != 0:
            return []

        try:
            abs_path = os.path.abspath(file_path)
            files = (wintypes.LPCWSTR * 1)(abs_path)
            res = rstrtmgr.RmRegisterResources(session_handle, 1, files, 0, None, 0, None)
            if res != 0:
                return []

            n_needed = wintypes.UINT(0)
            n_proc = wintypes.UINT(0)
            reboot_reasons = wintypes.DWORD(0)

            # Probe for locking processes (strictly informational, no shutdown)
            rstrtmgr.RmGetList(
                session_handle,
                ctypes.byref(n_needed),
                ctypes.byref(n_proc),
                None,
                ctypes.byref(reboot_reasons),
            )
            if n_needed.value == 0:
                return []

            procs = (RM_PROCESS_INFO * n_needed.value)()
            n_proc.value = n_needed.value
            rstrtmgr.RmGetList(
                session_handle,
                ctypes.byref(n_needed),
                ctypes.byref(n_proc),
                procs,
                ctypes.byref(reboot_reasons),
            )
            return [p.Process.dwProcessId for p in procs]
        finally:
            rstrtmgr.RmEndSession(session_handle)
    except Exception:
        return []


def snapshot_file_via_handle_duplication(file_path: str, dst_path: str) -> bool:
    """Safely snapshot a locked file by duplicating its open handle from the locking process.

    This operates completely non-destructively: it bypasses exclusive sharing locks
    without terminating or interrupting the browser process holding the file lock.
    """
    if os.name != "nt":
        return False

    try:
        pids = get_locking_pids(file_path)
        if not pids:
            return False

        buf_size = 1024 * 1024 * 16
        max_buf_size = 256 * 1024 * 1024
        buf = ctypes.create_string_buffer(buf_size)
        while True:
            size = wintypes.ULONG(buf_size)
            return_len = wintypes.ULONG(0)
            status = ctypes.c_uint32(
                ntdll.NtQuerySystemInformation(
                    SystemExtendedHandleInformation,
                    buf,
                    size,
                    ctypes.byref(return_len),
                )
            ).value
            if status == 0:
                break
            if status != 0xC0000004:  # STATUS_INFO_LENGTH_MISMATCH
                return False
            buf_size *= 2
            if buf_size > max_buf_size:
                return False
            buf = ctypes.create_string_buffer(buf_size)

        count = ctypes.c_size_t.from_buffer_copy(buf.raw[:8]).value
        entry_size = ctypes.sizeof(SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX)
        curr_proc = kernel32.GetCurrentProcess()
        norm_target = os.path.normcase(os.path.abspath(file_path))

        os.makedirs(os.path.dirname(os.path.abspath(dst_path)), exist_ok=True)
        tmp_dst = dst_path + ".tmp"

        PROCESS_DUP_HANDLE = 0x0040
        DUPLICATE_SAME_ACCESS = 0x0002
        FILE_TYPE_DISK = 1
        FILE_BEGIN = 0
        FILE_CURRENT = 1

        pid_set = set(pids)
        pid_handles: dict[int, list[int]] = {p: [] for p in pids}
        for i in range(count):
            entry = SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX.from_buffer(buf, 16 + i * entry_size)
            if entry.UniqueProcessId in pid_set:
                pid_handles[entry.UniqueProcessId].append(entry.HandleValue)

        for pid in pids:
            handles = pid_handles.get(pid)
            if not handles:
                continue
            h_proc = kernel32.OpenProcess(PROCESS_DUP_HANDLE, False, pid)
            if not h_proc:
                continue
            try:
                for handle_val in handles:
                    target_handle = wintypes.HANDLE()
                    ok = kernel32.DuplicateHandle(
                        h_proc,
                        wintypes.HANDLE(handle_val),
                        curr_proc,
                        ctypes.byref(target_handle),
                        0,
                        False,
                        DUPLICATE_SAME_ACCESS,
                    )
                    if ok and target_handle.value:
                        try:
                            if kernel32.GetFileType(target_handle) == FILE_TYPE_DISK:
                                path_buf = ctypes.create_unicode_buffer(1024)
                                plen = kernel32.GetFinalPathNameByHandleW(target_handle, path_buf, 1024, 0)
                                if plen > 0:
                                    clean = clean_nt_path(path_buf.value)
                                    if os.path.normcase(clean) == norm_target:
                                        # Save original 64-bit file position to leave handle untouched
                                        orig_pos = wintypes.LARGE_INTEGER(0)
                                        has_orig_pos = bool(
                                            kernel32.SetFilePointerEx(
                                                target_handle,
                                                wintypes.LARGE_INTEGER(0),
                                                ctypes.byref(orig_pos),
                                                FILE_CURRENT,
                                            )
                                        )
                                        try:
                                            kernel32.SetFilePointerEx(
                                                target_handle,
                                                wintypes.LARGE_INTEGER(0),
                                                None,
                                                FILE_BEGIN,
                                            )

                                            chunk_size = 64 * 1024
                                            read_buf = ctypes.create_string_buffer(chunk_size)
                                            bytes_read = wintypes.DWORD(0)
                                            read_success = True
                                            with open(tmp_dst, "wb") as out_f:
                                                while True:
                                                    r_ok = kernel32.ReadFile(
                                                        target_handle,
                                                        read_buf,
                                                        chunk_size,
                                                        ctypes.byref(bytes_read),
                                                        None,
                                                    )
                                                    if not r_ok:
                                                        read_success = False
                                                        break
                                                    if bytes_read.value == 0:
                                                        break
                                                    out_f.write(read_buf.raw[: bytes_read.value])
                                        finally:
                                            if has_orig_pos:
                                                kernel32.SetFilePointerEx(
                                                    target_handle,
                                                    orig_pos,
                                                    None,
                                                    FILE_BEGIN,
                                                )

                                        if read_success and os.path.exists(tmp_dst) and os.path.getsize(tmp_dst) > 0:
                                            kernel32.CloseHandle(target_handle)
                                            target_handle = None
                                            os.replace(tmp_dst, dst_path)
                                            return True
                                        elif os.path.exists(tmp_dst):
                                            try:
                                                os.remove(tmp_dst)
                                            except OSError:
                                                pass
                        finally:
                            if target_handle and target_handle.value:
                                kernel32.CloseHandle(target_handle)
            finally:
                kernel32.CloseHandle(h_proc)

        if os.path.exists(tmp_dst):
            try:
                os.remove(tmp_dst)
            except OSError:
                pass
        return False
    except Exception:
        return False


def unlock_windows_file_lock(file_path: str) -> bool:
    """Non-destructive lock query on Windows.

    Queries whether a file is locked by any active process using Restart Manager
    in strictly read-only mode, without terminating or disrupting any processes.
    """
    if os.name != "nt" or not file_path or not os.path.exists(file_path):
        return False
    try:
        pids = get_locking_pids(file_path)
        return len(pids) > 0
    except Exception:
        return False


def _win32_shared_copy(src: str, dst: str) -> bool:
    """Attempt a low-level copy using Win32 API with full sharing flags (READ|WRITE|DELETE)."""
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        kernel32.CreateFileW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            ctypes.c_void_p,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.HANDLE,
        ]
        kernel32.CreateFileW.restype = wintypes.HANDLE

        GENERIC_READ = 0x80000000
        FILE_SHARE_READ = 0x00000001
        FILE_SHARE_WRITE = 0x00000002
        FILE_SHARE_DELETE = 0x00000004
        OPEN_EXISTING = 3
        FILE_ATTRIBUTE_NORMAL = 0x00000080

        handle = kernel32.CreateFileW(
            src,
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
        invalid_val = (1 << (ctypes.sizeof(ctypes.c_void_p) * 8)) - 1
        raw_val = handle.value or 0
        if raw_val == 0 or raw_val == invalid_val:
            return False

        try:
            chunk_size = 64 * 1024
            buf = ctypes.create_string_buffer(chunk_size)
            bytes_read = wintypes.DWORD(0)
            os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
            tmp_dst = dst + ".tmp"
            read_success = True
            with open(tmp_dst, "wb") as out_f:
                while True:
                    success = kernel32.ReadFile(handle, buf, chunk_size, ctypes.byref(bytes_read), None)
                    if not success:
                        read_success = False
                        break
                    if bytes_read.value == 0:
                        break
                    out_f.write(buf.raw[: bytes_read.value])
            if read_success and os.path.exists(tmp_dst) and os.path.getsize(tmp_dst) > 0:
                os.replace(tmp_dst, dst)
                return True
            if os.path.exists(tmp_dst):
                try:
                    os.remove(tmp_dst)
                except OSError:
                    pass
            return False
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        return False


class AutoClosingCursor:
    """Cursor proxy that closes its underlying sqlite3 connection when cursor.close() is called."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn
        try:
            self._cursor = conn.cursor()
        except Exception:
            conn.close()
            raise

    @property
    def connection(self) -> sqlite3.Connection:
        return self._conn

    def close(self):
        try:
            self._cursor.close()
        finally:
            self._conn.close()

    def __getattr__(self, name):
        return getattr(self._cursor, name)

    def __iter__(self):
        return iter(self._cursor)


def robust_open_database_copy(database_path: str, tmpdir: str) -> sqlite3.Cursor:
    """Open a copy of an SQLite database, safely handling Windows file locks non-destructively."""
    database_copy_path = os.path.join(tmpdir, "temporary.sqlite")
    copied = False
    last_err: Optional[Exception] = None

    try:
        shutil.copy(database_path, database_copy_path)
        copied = True
    except (PermissionError, OSError) as err:
        last_err = err
        if os.name == "nt":
            # Attempt non-destructive Win32 handle duplication snapshot
            copied = snapshot_file_via_handle_duplication(database_path, database_copy_path)
            if not copied:
                copied = _win32_shared_copy(database_path, database_copy_path)

    if not copied:
        if last_err is not None:
            raise last_err
        raise PermissionError(f"Could not copy database file: {database_path}")

    # Copy accompanying WAL / journal files if present
    for suffix in ("-wal", "-journal", "-shm"):
        sidecar_src = database_path + suffix
        if os.path.isfile(sidecar_src):
            sidecar_dst = database_copy_path + suffix
            try:
                shutil.copy(sidecar_src, sidecar_dst)
            except (PermissionError, OSError):
                if os.name == "nt":
                    if not snapshot_file_via_handle_duplication(sidecar_src, sidecar_dst):
                        _win32_shared_copy(sidecar_src, sidecar_dst)

    conn = sqlite3.connect(database_copy_path)
    return AutoClosingCursor(conn)  # type: ignore[return-value]


_PATCHED = False
_LOCK = threading.Lock()


def patch_yt_dlp_cookie_database_reader() -> None:
    """Monkey-patch yt-dlp's database reader with our robust lock-aware reader and safe v20 handler."""
    global _PATCHED
    with _LOCK:
        if _PATCHED:
            return
        try:
            import yt_dlp.cookies

            yt_dlp.cookies._open_database_copy = robust_open_database_copy
            orig_decrypt = getattr(yt_dlp.cookies.WindowsChromeCookieDecryptor, "decrypt", None)
            if orig_decrypt and not getattr(yt_dlp.cookies.WindowsChromeCookieDecryptor, "_jane_patched", False):

                def safe_decrypt(self, encrypted_value):
                    if encrypted_value and encrypted_value[:3] == b"v20":
                        return None
                    try:
                        return orig_decrypt(self, encrypted_value)
                    except Exception:
                        return None

                yt_dlp.cookies.WindowsChromeCookieDecryptor.decrypt = safe_decrypt
                yt_dlp.cookies.WindowsChromeCookieDecryptor._jane_patched = True
            _PATCHED = True
        except (ImportError, AttributeError):
            pass
