"""Unit tests for yt-dlp runtime override activation, verified installation, and CLI flag."""

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

from janeconverter import cli
from janeconverter import engine_override
from janeconverter import updater


def _build_wheel_bytes(
    version: str = "2026.11.23",
    extra_entries: dict[str, bytes] | None = None,
    symlink_entry: str | None = None,
) -> tuple[bytes, str]:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("yt_dlp/__init__.py", "from .version import __version__\n")
        zf.writestr("yt_dlp/version.py", f"__version__ = '{version}'\n")
        zf.writestr("yt_dlp/extractor/__init__.py", "# extractor\n")
        zf.writestr(f"yt_dlp-{version}.dist-info/METADATA", f"Name: yt-dlp\nVersion: {version}\n")
        if extra_entries:
            for name, content in extra_entries.items():
                zf.writestr(name, content)
        if symlink_entry:
            info = zipfile.ZipInfo(symlink_entry)
            info.external_attr = 0o120777 << 16
            zf.writestr(info, "/etc/passwd")
    data = buf.getvalue()
    return data, hashlib.sha256(data).hexdigest()


class _FakeResponse:
    def __init__(self, status_code: int = 200, json_data=None, content: bytes = b""):
        self.status_code = status_code
        self._json_data = json_data
        self.content = content

    def json(self):
        return self._json_data

    def iter_content(self, chunk_size: int = 65536):
        for idx in range(0, len(self.content), chunk_size):
            yield self.content[idx : idx + chunk_size]

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def _mock_pypi_get(
    monkeypatch,
    version: str,
    wheel_bytes: bytes,
    sha256_hex: str,
    wheel_url: str = "https://files.pythonhosted.org/packages/test/yt_dlp-2026.11.23-py3-none-any.whl",
):
    metadata = {
        "info": {"version": version},
        "urls": [
            {
                "packagetype": "bdist_wheel",
                "filename": f"yt_dlp-{version}-py3-none-any.whl",
                "url": wheel_url,
                "digests": {"sha256": sha256_hex},
            }
        ],
    }

    def fake_get(url, **_kwargs):
        if url.startswith("https://pypi.org/pypi/yt-dlp"):
            return _FakeResponse(200, json_data=metadata)
        if url == wheel_url:
            return _FakeResponse(200, content=wheel_bytes)
        raise AssertionError(f"Unexpected URL requested: {url}")

    monkeypatch.setattr("requests.get", fake_get)


def test_install_yt_dlp_override_happy_path(monkeypatch, tmp_path):
    wheel_bytes, sha256_hex = _build_wheel_bytes("2026.11.23")
    _mock_pypi_get(monkeypatch, "2026.11.23", wheel_bytes, sha256_hex)

    res = engine_override.install_yt_dlp_override(
        target_version="2026.11.23",
        overrides_dir=tmp_path,
    )

    assert res["success"] is True
    assert res["updated"] is True
    assert res["latest_version"] == "2026.11.23"

    active = tmp_path / engine_override.ACTIVE_DIR_NAME
    assert (active / "yt_dlp" / "__init__.py").is_file()
    assert (active / "yt_dlp" / "version.py").is_file()
    assert not (active / "yt_dlp-2026.11.23.dist-info").exists()

    manifest = json.loads((active / engine_override.MANIFEST_NAME).read_text(encoding="utf-8"))
    assert manifest["version"] == "2026.11.23"
    assert manifest["sha256"] == sha256_hex


def test_install_yt_dlp_override_rejects_sha256_mismatch(monkeypatch, tmp_path):
    wheel_bytes, _ = _build_wheel_bytes("2026.11.23")
    _mock_pypi_get(monkeypatch, "2026.11.23", wheel_bytes, "0" * 64)

    res = engine_override.install_yt_dlp_override(
        target_version="2026.11.23",
        overrides_dir=tmp_path,
    )

    assert res["success"] is False
    assert "SHA-256" in res["error"]
    assert not (tmp_path / engine_override.ACTIVE_DIR_NAME).exists()


def test_install_yt_dlp_override_rejects_untrusted_host(monkeypatch, tmp_path):
    wheel_bytes, sha256_hex = _build_wheel_bytes("2026.11.23")
    _mock_pypi_get(
        monkeypatch,
        "2026.11.23",
        wheel_bytes,
        sha256_hex,
        wheel_url="https://evil.example.com/yt_dlp-2026.11.23-py3-none-any.whl",
    )

    res = engine_override.install_yt_dlp_override(
        target_version="2026.11.23",
        overrides_dir=tmp_path,
    )

    assert res["success"] is False
    assert "untrusted wheel host" in res["error"].lower()


def test_install_yt_dlp_override_rejects_zip_slip_and_symlinks(monkeypatch, tmp_path):
    slip_bytes, slip_sha = _build_wheel_bytes(
        "2026.11.23",
        extra_entries={"yt_dlp/../../escape.py": b"print('bad')\n"},
    )
    _mock_pypi_get(monkeypatch, "2026.11.23", slip_bytes, slip_sha)
    res_slip = engine_override.install_yt_dlp_override(
        target_version="2026.11.23",
        overrides_dir=tmp_path,
    )
    assert res_slip["success"] is False
    assert "traversal" in res_slip["error"].lower()

    sym_bytes, sym_sha = _build_wheel_bytes(
        "2026.11.23",
        symlink_entry="yt_dlp/link.py",
    )
    _mock_pypi_get(monkeypatch, "2026.11.23", sym_bytes, sym_sha)
    res_sym = engine_override.install_yt_dlp_override(
        target_version="2026.11.23",
        overrides_dir=tmp_path,
    )
    assert res_sym["success"] is False
    assert "symlink" in res_sym["error"].lower()


def test_install_yt_dlp_override_rejects_invalid_calver(tmp_path):
    for bad in ("2035.01.01", "2020.01.01", "invalid"):
        res = engine_override.install_yt_dlp_override(
            target_version=bad,
            overrides_dir=tmp_path,
        )
        assert res["success"] is False
        assert "Unsupported yt-dlp version" in res["error"]


def test_activate_yt_dlp_override_precedence(monkeypatch, tmp_path):
    wheel_bytes, sha256_hex = _build_wheel_bytes("2026.11.23")
    _mock_pypi_get(monkeypatch, "2026.11.23", wheel_bytes, sha256_hex)
    install_res = engine_override.install_yt_dlp_override(
        target_version="2026.11.23",
        overrides_dir=tmp_path,
    )
    assert install_res["success"] is True

    saved_meta_path = list(sys.meta_path)
    saved_yt_modules = {
        k: v for k, v in sys.modules.items() if k == "yt_dlp" or k.startswith("yt_dlp.")
    }
    try:
        for k in list(saved_yt_modules):
            sys.modules.pop(k, None)

        # Case 1: Bundled is newer or equal -> skip override
        monkeypatch.setattr(engine_override, "get_bundled_yt_dlp_version", lambda: "2026.12.01")
        assert engine_override.activate_yt_dlp_override(tmp_path) is None
        assert not any(
            isinstance(f, engine_override._YtDlpOverrideFinder) for f in sys.meta_path
        )

        # Case 2: Override is newer -> activate and import overridden version
        monkeypatch.setattr(engine_override, "get_bundled_yt_dlp_version", lambda: "2026.10.26")
        activated = engine_override.activate_yt_dlp_override(tmp_path)
        assert activated == "2026.11.23"
        assert isinstance(sys.meta_path[0], engine_override._YtDlpOverrideFinder)

        import yt_dlp.version

        assert yt_dlp.version.__version__ == "2026.11.23"
    finally:
        for k in [m for m in sys.modules if m == "yt_dlp" or m.startswith("yt_dlp.")]:
            sys.modules.pop(k, None)
        sys.modules.update(saved_yt_modules)
        sys.meta_path[:] = saved_meta_path


def test_cli_update_engine_paths(monkeypatch, capsys):
    # 1. Successful update
    monkeypatch.setattr(
        cli,
        "apply_engine_update",
        lambda: {"success": True, "updated": True, "latest_version": "2026.11.23"},
    )
    monkeypatch.setattr(sys, "argv", ["janeconverter", "--update-engine"])
    cli.main()
    assert json.loads(capsys.readouterr().out) == {
        "success": True,
        "updated": True,
        "latest_version": "2026.11.23",
    }

    # 2. Failed update exits non-zero
    monkeypatch.setattr(
        cli,
        "apply_engine_update",
        lambda: {"success": False, "updated": False, "error": "network failed"},
    )
    monkeypatch.setattr(sys, "argv", ["janeconverter", "--update-engine"])
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 1
    assert json.loads(capsys.readouterr().out)["error"] == "network failed"

    # 3. apply_engine_update when already up to date
    monkeypatch.setattr(
        updater,
        "check_for_engine_updates",
        lambda **_kwargs: {
            "has_update": False,
            "online": True,
            "current_version": "2026.11.23",
            "latest_version": "2026.11.23",
        },
    )
    up_to_date = updater.apply_engine_update()
    assert up_to_date["success"] is True
    assert up_to_date["updated"] is False
