"""Tests for robust Windows cookie database reading and handle duplication."""

import os
import sqlite3
from unittest.mock import Mock

import pytest
import yt_dlp.cookies

from janeconverter import cookie_unlocker


def test_unlock_windows_file_lock_handles_invalid_and_missing_paths():
    assert cookie_unlocker.unlock_windows_file_lock("") is False
    assert cookie_unlocker.unlock_windows_file_lock("C:/nonexistent_file_path_12345.sqlite") is False


def test_clean_nt_path():
    assert cookie_unlocker.clean_nt_path(r"\\?\C:\Users\foo\Cookies") == r"C:\Users\foo\Cookies"
    assert cookie_unlocker.clean_nt_path(r"\\?\UNC\server\share\file") == r"\\server\share\file"
    assert cookie_unlocker.clean_nt_path(r"C:\normal\path") == r"C:\normal\path"


def test_robust_open_database_copy_creates_readable_cursor(tmp_path):
    db_file = tmp_path / "test_cookies.sqlite"
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE test (id INT, val TEXT)")
    conn.execute("INSERT INTO test VALUES (1, 'alice')")
    conn.commit()
    conn.close()

    cursor = cookie_unlocker.robust_open_database_copy(str(db_file), str(tmp_path))
    try:
        row = cursor.execute("SELECT val FROM test WHERE id = 1").fetchone()
        assert row[0] == "alice"
    finally:
        cursor.connection.close()


def test_robust_open_database_copy_copies_sidecars_if_present(tmp_path):
    db_file = tmp_path / "test_cookies_sidecars.sqlite"
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE test (val TEXT)")
    conn.commit()
    conn.close()

    wal_file = tmp_path / "test_cookies_sidecars.sqlite-wal"
    wal_file.write_bytes(b"wal-content")

    cursor = cookie_unlocker.robust_open_database_copy(str(db_file), str(tmp_path))
    try:
        copied_wal = tmp_path / "temporary.sqlite-wal"
        assert copied_wal.exists()
        assert copied_wal.read_bytes() == b"wal-content"
    finally:
        cursor.connection.close()


def test_robust_open_database_copy_falls_back_to_handle_duplication_on_permission_error(tmp_path, monkeypatch):
    db_file = tmp_path / "locked_cookies.sqlite"
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE test (val TEXT)")
    conn.execute("INSERT INTO test VALUES ('from_snapshot')")
    conn.commit()
    conn.close()

    monkeypatch.setattr(cookie_unlocker.os, "name", "nt")
    monkeypatch.setattr(cookie_unlocker.shutil, "copy", Mock(side_effect=PermissionError("Locked exclusively")))

    def mock_snapshot(src, dst):
        # Emulate successful snapshot via handle duplication
        with open(src, "rb") as in_f, open(dst, "wb") as out_f:
            out_f.write(in_f.read())
        return True

    monkeypatch.setattr(cookie_unlocker, "snapshot_file_via_handle_duplication", mock_snapshot)

    cursor = cookie_unlocker.robust_open_database_copy(str(db_file), str(tmp_path))
    try:
        row = cursor.execute("SELECT val FROM test").fetchone()
        assert row[0] == "from_snapshot"
    finally:
        cursor.connection.close()


def test_robust_open_database_copy_falls_back_to_shared_copy_if_handle_duplication_fails(tmp_path, monkeypatch):
    db_file = tmp_path / "locked_cookies_fallback.sqlite"
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE test (val TEXT)")
    conn.execute("INSERT INTO test VALUES ('from_shared_copy')")
    conn.commit()
    conn.close()

    monkeypatch.setattr(cookie_unlocker.os, "name", "nt")
    monkeypatch.setattr(cookie_unlocker.shutil, "copy", Mock(side_effect=PermissionError("Locked exclusively")))
    monkeypatch.setattr(cookie_unlocker, "snapshot_file_via_handle_duplication", lambda s, d: False)

    def mock_shared_copy(src, dst):
        with open(src, "rb") as in_f, open(dst, "wb") as out_f:
            out_f.write(in_f.read())
        return True

    monkeypatch.setattr(cookie_unlocker, "_win32_shared_copy", mock_shared_copy)

    cursor = cookie_unlocker.robust_open_database_copy(str(db_file), str(tmp_path))
    try:
        row = cursor.execute("SELECT val FROM test").fetchone()
        assert row[0] == "from_shared_copy"
    finally:
        cursor.connection.close()


def test_robust_open_database_copy_raises_if_all_copies_fail(tmp_path, monkeypatch):
    db_file = tmp_path / "unfixable_cookies.sqlite"
    db_file.write_bytes(b"dummy")

    monkeypatch.setattr(cookie_unlocker.os, "name", "nt")
    monkeypatch.setattr(cookie_unlocker.shutil, "copy", Mock(side_effect=PermissionError("Locked forever")))
    monkeypatch.setattr(cookie_unlocker, "snapshot_file_via_handle_duplication", lambda s, d: False)
    monkeypatch.setattr(cookie_unlocker, "_win32_shared_copy", lambda s, d: False)

    with pytest.raises(PermissionError, match="Locked forever"):
        cookie_unlocker.robust_open_database_copy(str(db_file), str(tmp_path))


def test_patch_yt_dlp_cookie_database_reader_applies_patch():
    import inspect

    cookie_unlocker.patch_yt_dlp_cookie_database_reader()
    assert yt_dlp.cookies._open_database_copy == cookie_unlocker.robust_open_database_copy
    sig = inspect.signature(cookie_unlocker.robust_open_database_copy)
    assert "database_path" in sig.parameters
    assert "tmpdir" in sig.parameters
    assert getattr(yt_dlp.cookies.WindowsChromeCookieDecryptor, "_jane_patched", False) is True
