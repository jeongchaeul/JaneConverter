"""Regression tests for bounded events, source routing, and safe update defaults."""

import json
import os
import sys
from pathlib import Path

from janeconverter import cli
from janeconverter.events import BoundedLogQueue, CoalescingCallbackQueue
from janeconverter.extractor import identify_source_type, is_playlist_url
from janeconverter import updater
from janeconverter.updater import check_and_apply_all_updates, update_engine
from janeconverter.cli import CLI_CATEGORIES, media_library_folder, _metadata_folder


def test_source_updater_resolves_repository_root():
    assert (Path(updater.REPO_DIR) / "pyproject.toml").is_file()


def test_progress_queue_coalesces_and_bounds_callbacks():
    events = CoalescingCallbackQueue(max_callbacks=2)
    values = []
    for value in range(100_000):
        events.put(lambda v=value: values.append(v), key="progress")
    callbacks = events.drain(max_items=10)
    for callback in callbacks:
        callback()
    assert values == [99_999]
    assert events.qsize() == 0


def test_log_queue_drops_under_pressure_and_batches():
    logs = BoundedLogQueue(max_items=2)
    assert logs.put("a")
    assert logs.put("b")
    assert not logs.put("c")
    assert logs.dropped == 1
    assert logs.get_batch() == ["a", "b"]


def test_source_matching_does_not_accept_lookalike_domains():
    assert identify_source_type("https://not-spotify.com/track/1") == "generic_url"
    assert identify_source_type("https://cdn.youtube.com/video/1") == "youtube"
    assert is_playlist_url("https://open.spotify.com/album/abc123")


def test_library_folder_keeps_sources_separate_except_miscellaneous(tmp_path):
    root = str(tmp_path)
    assert media_library_folder(root, "mp3", "spotify", "Music").endswith(os.path.join("Music", "Spotify"))
    assert media_library_folder(root, "mp4", "youtube", "Video").endswith(os.path.join("Videos", "YouTube"))
    assert media_library_folder(root, "mp3", "spotify", "Miscellaneous").endswith(os.path.join("Miscellaneous", "Audio"))
    assert media_library_folder(root, "png", "facebook", "Image").endswith(os.path.join("Images", "Facebook"))


def test_cli_categories_include_image_capture_output():
    assert "Image" in CLI_CATEGORIES


def test_single_item_metadata_isolated_by_source(tmp_path):
    first = _metadata_folder(str(tmp_path), "https://youtube.com/watch?v=one", "Same Title")
    second = _metadata_folder(str(tmp_path), "https://soundcloud.com/artist/same", "Same Title")
    assert first != second
    assert first.endswith(os.path.join("metadata", "Same Title_" + first.rsplit("_", 1)[-1]))


def test_updates_are_read_only_by_default(monkeypatch):
    monkeypatch.setattr("janeconverter.updater.check_for_engine_updates", lambda: {
        "has_update": False, "online": True, "current_version": "1", "latest_version": "1"
    })
    monkeypatch.setattr("janeconverter.updater.check_for_repo_updates", lambda: {
        "has_update": False, "is_git": False, "current_commit": "unknown", "commits_behind": 0
    })
    result = check_and_apply_all_updates()
    assert result["already_up_to_date"] is True
    assert result["repo_updated"] is False
    assert result["engine_updated"] is False


def test_packaged_update_check_can_skip_the_repository_release_api(monkeypatch, capsys):
    engine_info = {"has_update": False, "online": True, "current_version": "1", "latest_version": "1"}

    def fail_if_called():
        raise AssertionError("the updater-enabled app must use its signed commit feed for app updates")

    monkeypatch.setattr(cli, "check_for_engine_updates", lambda: engine_info)
    monkeypatch.setattr(cli, "check_for_repo_updates", fail_if_called)
    monkeypatch.setattr(sys, "argv", ["janeconverter", "--check-engine-updates"])

    cli.main()

    assert json.loads(capsys.readouterr().out) == {"engine": engine_info}


def test_engine_install_requires_explicit_permission(monkeypatch):
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("the package installer must not run during a read-only update check")

    monkeypatch.setattr("janeconverter.updater.subprocess.run", fail_if_called)
    result = update_engine(info={
        "has_update": True,
        "online": True,
        "current_version": "2026.1",
        "latest_version": "2026.2",
    })
    assert result is False


def test_published_release_check_finds_newer_github_version_and_installer(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "tag_name": "v1.3.0",
                "html_url": "https://github.com/janecerys/JaneConverter/releases/tag/v1.3.0",
                "assets": [
                    {
                        "name": "JaneConverter-1.3.0-windows-x64-setup.exe",
                        "browser_download_url": "https://github.com/janecerys/JaneConverter/releases/download/v1.3.0/JaneConverter-1.3.0-windows-x64-setup.exe",
                    },
                    {
                        "name": "JaneConverter-1.3.0-windows-x64-setup.exe.sha256",
                        "browser_download_url": "https://github.com/janecerys/JaneConverter/releases/download/v1.3.0/JaneConverter-1.3.0-windows-x64-setup.exe.sha256",
                    },
                    {
                        "name": "JaneConverter-1.3.0-macos-arm64.dmg",
                        "browser_download_url": "https://github.com/janecerys/JaneConverter/releases/download/v1.3.0/JaneConverter-1.3.0-macos-arm64.dmg",
                    },
                    {
                        "name": "JaneConverter-1.3.0-macos-arm64.dmg.sha256",
                        "browser_download_url": "https://github.com/janecerys/JaneConverter/releases/download/v1.3.0/JaneConverter-1.3.0-macos-arm64.dmg.sha256",
                    },
                    {
                        "name": "JaneConverter-1.3.0-macos-x86_64.dmg",
                        "browser_download_url": "https://github.com/janecerys/JaneConverter/releases/download/v1.3.0/JaneConverter-1.3.0-macos-x86_64.dmg",
                    },
                    {
                        "name": "JaneConverter-1.3.0-macos-x86_64.dmg.sha256",
                        "browser_download_url": "https://github.com/janecerys/JaneConverter/releases/download/v1.3.0/JaneConverter-1.3.0-macos-x86_64.dmg.sha256",
                    },
                    {
                        "name": "JaneConverter-1.3.0-linux-x86_64.AppImage",
                        "browser_download_url": "https://github.com/janecerys/JaneConverter/releases/download/v1.3.0/JaneConverter-1.3.0-linux-x86_64.AppImage",
                    },
                    {
                        "name": "JaneConverter-1.3.0-linux-x86_64.AppImage.sha256",
                        "browser_download_url": "https://github.com/janecerys/JaneConverter/releases/download/v1.3.0/JaneConverter-1.3.0-linux-x86_64.AppImage.sha256",
                    },
                ],
            }

    requested = {}

    def fake_get(url, **kwargs):
        requested.update(url=url, kwargs=kwargs)
        return FakeResponse()

    monkeypatch.setattr(updater.requests, "get", fake_get)
    monkeypatch.setattr(updater, "__version__", "1.2.0")

    result = updater.check_for_release_updates()

    assert result["has_update"] is True
    assert result["current_version"] == "1.2.0"
    assert result["latest_version"] == "1.3.0"
    assert result["installer_available"] is True
    if sys.platform == "darwin":
        assert result["installer_url"].endswith(".dmg")
        assert result["installer_checksum_url"].endswith(".dmg.sha256")
    elif sys.platform.startswith("linux"):
        assert result["installer_url"].endswith("JaneConverter-1.3.0-linux-x86_64.AppImage")
        assert result["installer_checksum_url"].endswith("JaneConverter-1.3.0-linux-x86_64.AppImage.sha256")
    else:
        assert result["installer_url"].endswith("JaneConverter-1.3.0-windows-x64-setup.exe")
        assert result["installer_checksum_url"].endswith(
            "JaneConverter-1.3.0-windows-x64-setup.exe.sha256"
        )
    assert result["release_url"].endswith("/v1.3.0")
    assert requested["url"] == updater.GITHUB_LATEST_RELEASE_URL
    assert requested["kwargs"]["headers"]["User-Agent"].startswith("JaneConverter/")


def test_published_release_check_falls_back_to_atom_feed_on_api_403(monkeypatch):
    import platform
    atom_feed = b'''<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>JaneConverter v1.3.0</title>
        <link rel="alternate" href="https://github.com/jeongchaeul/JaneConverter/releases/tag/v1.3.0" />
      </entry>
    </feed>'''
    requested = []

    class FakeResponse:
        def __init__(self, status_code, text="", content=b""):
            self.status_code = status_code
            self.text = text
            self.content = content

    def fake_get(url, **kwargs):
        requested.append((url, kwargs))
        if url == updater.GITHUB_LATEST_RELEASE_URL:
            return FakeResponse(403, "API rate limit exceeded")
        return FakeResponse(200, atom_feed.decode("utf-8"), atom_feed)

    monkeypatch.setattr(updater.requests, "get", fake_get)
    monkeypatch.setattr(updater, "__version__", "1.2.0")

    result = updater.check_for_release_updates()

    assert result["has_update"] is True
    assert result["latest_version"] == "1.3.0"
    assert result["installer_available"] is True
    expected_arch = "arm64" if platform.machine().lower() in {"arm64", "aarch64"} else "x86_64"
    if sys.platform == "darwin":
        expected_installer = f"JaneConverter-1.3.0-macos-{expected_arch}.dmg"
    elif sys.platform.startswith("linux"):
        expected_installer = "JaneConverter-1.3.0-linux-x86_64.AppImage"
    else:
        expected_installer = "JaneConverter-1.3.0-windows-x64-setup.exe"
    assert result["installer_url"] == (
        f"https://github.com/jeongchaeul/JaneConverter/releases/download/v1.3.0/{expected_installer}"
    )
    assert result["installer_checksum_url"] == f"{result['installer_url']}.sha256"
    assert result["release_url"] == "https://github.com/jeongchaeul/JaneConverter/releases/tag/v1.3.0"
    assert [url for url, _ in requested] == [
        updater.GITHUB_LATEST_RELEASE_URL,
        updater.GITHUB_RELEASES_ATOM_URL,
    ]
    assert requested[1][1]["headers"]["Accept"] == "application/atom+xml"


def test_unsigned_legacy_application_update_download_is_disabled(monkeypatch):
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("the retired unsigned installer path must not make network requests")

    monkeypatch.setattr(updater.requests, "get", fail_if_called)
    result = updater.download_application_update({"has_update": True})

    assert result["success"] is False
    assert "Unsigned installer downloads are disabled" in result["error"]


def test_non_git_snapshot_uses_published_release_check(monkeypatch):
    monkeypatch.setattr(updater, "is_git_repo", lambda: False)
    monkeypatch.setattr(updater, "check_for_release_updates", lambda **_: {
        "has_update": True,
        "online": True,
        "current_version": "1.2.0",
        "latest_version": "1.3.0",
        "installer_available": True,
        "release_url": "https://github.com/janecerys/JaneConverter/releases/tag/v1.3.0",
        "error": None,
    })

    result = updater.check_for_repo_updates()

    assert result["is_git"] is False
    assert result["has_update"] is True
    assert result["current_version"] == "1.2.0"
    assert result["latest_version"] == "1.3.0"
    assert result["installer_available"] is True


def test_engine_update_version_bounds(monkeypatch):
    executed_commands = []

    class FakeCompleted:
        returncode = 0
        stderr = ""

    def fake_run(cmd, **_kwargs):
        executed_commands.append(cmd)
        return FakeCompleted()

    monkeypatch.setattr("janeconverter.updater.subprocess.run", fake_run)

    # 1. Valid 2027 CalVer version must be accepted when install is allowed
    assert updater.update_engine(
        info={"has_update": True, "online": True, "current_version": "2026.10.01", "latest_version": "2027.01.15"},
        allow_install=True,
    ) is True
    assert any("yt-dlp==2027.01.15" in arg for cmd in executed_commands for arg in cmd)

    # 2. Out of tested range year (>2029) must be skipped
    assert updater.update_engine(
        info={"has_update": True, "online": True, "current_version": "2026.10.01", "latest_version": "2035.01.01"},
        allow_install=True,
    ) is False

    # 3. Malformed version format must be skipped
    assert updater.update_engine(
        info={"has_update": True, "online": True, "current_version": "2026.10.01", "latest_version": "invalid_version"},
        allow_install=True,
    ) is False
