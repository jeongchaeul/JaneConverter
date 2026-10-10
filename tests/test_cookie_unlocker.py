"""Tests for robust Windows cookie database unlocking and reading."""

import sqlite3
from unittest.mock import Mock

import pytest
import yt_dlp.cookies

from janeconverter import cookie_unlocker


def test_unlock_windows_file_lock_handles_invalid_and_missing_paths():
    assert cookie_unlocker.unlock_windows_file_lock("") is False
    assert cookie_unlocker.unlock_windows_file_lock("C:/nonexistent_file_path_12345.sqlite") is False


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


def test_robust_open_database_copy_retries_after_permission_error_and_unlock(tmp_path, monkeypatch):
    db_file = tmp_path / "locked_cookies.sqlite"
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE test (val TEXT)")
    conn.commit()
    conn.close()

    call_count = [0]
    real_copy = cookie_unlocker.shutil.copy

    def mock_copy(src, dst):
        call_count[0] += 1
        if call_count[0] == 1:
            raise PermissionError("[Errno 13] Permission denied")
        return real_copy(src, dst)

    monkeypatch.setattr(cookie_unlocker.shutil, "copy", mock_copy)
    monkeypatch.setattr(cookie_unlocker, "unlock_windows_file_lock", lambda path: True)

    cursor = cookie_unlocker.robust_open_database_copy(str(db_file), str(tmp_path))
    try:
        assert call_count[0] >= 2
    finally:
        cursor.connection.close()


def test_robust_open_database_copy_raises_if_unlock_fails(tmp_path, monkeypatch):
    db_file = tmp_path / "unfixable_cookies.sqlite"
    db_file.write_bytes(b"dummy")

    monkeypatch.setattr(cookie_unlocker.shutil, "copy", Mock(side_effect=PermissionError("Locked forever")))
    monkeypatch.setattr(cookie_unlocker, "unlock_windows_file_lock", lambda path: False)

    with pytest.raises(PermissionError, match="Locked forever"):
        cookie_unlocker.robust_open_database_copy(str(db_file), str(tmp_path))


def test_patch_yt_dlp_cookie_database_reader_applies_patch():
    cookie_unlocker.patch_yt_dlp_cookie_database_reader()
    assert yt_dlp.cookies._open_database_copy == cookie_unlocker.robust_open_database_copy
