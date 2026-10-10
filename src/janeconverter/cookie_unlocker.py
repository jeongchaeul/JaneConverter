"""Robust, lock-aware browser cookie database reading for yt-dlp.

On Windows, Chromium-based browsers (Chrome, Edge, Brave, Vivaldi, Opera) lock
their cookie database (Network\\Cookies) exclusively while running. This module
uses the Windows Restart Manager API to safely release the background utility
file lock and allow yt-dlp to read session cookies seamlessly across all browsers.
"""

import os
import shutil
import sqlite3
import threading
import time
from typing import Optional


def unlock_windows_file_lock(file_path: str) -> bool:
    """If a file is locked on Windows by a background utility, request release via Restart Manager."""
    if os.name != "nt" or not file_path or not os.path.exists(file_path):
        return False

    try:
        import ctypes
        from ctypes import wintypes

        rstrtmgr = ctypes.windll.rstrtmgr

        cch_rm_session_key = 32
        rm_force_shutdown = 1
        session_handle = wintypes.DWORD(0)
        session_key = (wintypes.WCHAR * (cch_rm_session_key + 1))()

        res = rstrtmgr.RmStartSession(ctypes.byref(session_handle), 0, session_key)
        if res != 0:
            return False

        try:
            abs_path = os.path.abspath(file_path)
            files = (wintypes.LPCWSTR * 1)(abs_path)
            res = rstrtmgr.RmRegisterResources(session_handle, 1, files, 0, None, 0, None)
            if res != 0:
                return False

            n_needed = wintypes.UINT(0)
            n_proc = wintypes.UINT(0)
            reboot_reasons = wintypes.DWORD(0)

            # Probe for locking processes
            res = rstrtmgr.RmGetList(
                session_handle,
                ctypes.byref(n_needed),
                ctypes.byref(n_proc),
                None,
                ctypes.byref(reboot_reasons),
            )
            if n_needed.value > 0:
                # Release the lock by shutting down the background NetworkService lock holder
                res = rstrtmgr.RmShutdown(session_handle, rm_force_shutdown, None)
                return res == 0
            return True
        finally:
            rstrtmgr.RmEndSession(session_handle)
    except Exception:
        return False


def robust_open_database_copy(database_path: str, tmpdir: str) -> sqlite3.Cursor:
    """Open a copy of an SQLite database, safely handling Windows file locks."""
    database_copy_path = os.path.join(tmpdir, "temporary.sqlite")
    copied = False
    last_err: Optional[Exception] = None

    try:
        shutil.copy(database_path, database_copy_path)
        copied = True
    except (PermissionError, OSError) as err:
        last_err = err
        if os.name == "nt":
            if unlock_windows_file_lock(database_path):
                for _ in range(6):
                    try:
                        shutil.copy(database_path, database_copy_path)
                        copied = True
                        break
                    except (PermissionError, OSError):
                        time.sleep(0.05)

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
                pass

    conn = sqlite3.connect(database_copy_path)
    return conn.cursor()


_PATCHED = False
_LOCK = threading.Lock()


def patch_yt_dlp_cookie_database_reader() -> None:
    """Monkey-patch yt-dlp's database reader with our robust lock-aware reader."""
    global _PATCHED
    with _LOCK:
        if _PATCHED:
            return
        try:
            import yt_dlp.cookies
            yt_dlp.cookies._open_database_copy = robust_open_database_copy
            _PATCHED = True
        except Exception:
            pass
