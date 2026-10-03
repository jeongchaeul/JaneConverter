"""
Security tests for thumbnail download, SSRF prevention, and image handling limits.
"""

import os
import unittest.mock as mock
from PIL import Image

from janeconverter.extractor import (
    _is_safe_public_url,
    download_and_convert_thumbnail,
    MAX_THUMBNAIL_BYTES,
    MAX_THUMBNAIL_DIMENSION,
)


def test_is_safe_public_url_rejects_ssrf_and_invalid_schemes():
    # Loopback & local
    assert not _is_safe_public_url("http://127.0.0.1/art.jpg")
    assert not _is_safe_public_url("http://127.0.0.1:8080/art.jpg")
    assert not _is_safe_public_url("http://localhost/art.jpg")
    assert not _is_safe_public_url("http://localhost:3000/art.jpg")
    assert not _is_safe_public_url("http://[::1]/art.jpg")

    # Cloud metadata & link-local
    assert not _is_safe_public_url("http://169.254.169.254/latest/meta-data")
    assert not _is_safe_public_url("https://169.254.169.254/")

    # Private IP address spaces (RFC 1918)
    assert not _is_safe_public_url("http://10.0.0.1/secret.png")
    assert not _is_safe_public_url("http://192.168.1.1/secret.png")
    assert not _is_safe_public_url("http://172.16.0.1/secret.png")

    # Non-HTTP/HTTPS schemes
    assert not _is_safe_public_url("file:///etc/passwd")
    assert not _is_safe_public_url("ftp://example.com/art.jpg")
    assert not _is_safe_public_url("gopher://example.com/art.jpg")

    # Embedded credentials
    assert not _is_safe_public_url("http://user:pass@example.com/art.jpg")

    # Internal TLDs / hostnames
    assert not _is_safe_public_url("http://router.local/art.jpg")
    assert not _is_safe_public_url("http://db.internal/art.jpg")
    assert not _is_safe_public_url("http://secret.onion/art.jpg")

    # Empty / malformed
    assert not _is_safe_public_url("")
    assert not _is_safe_public_url("not a url")


def test_is_safe_public_url_allows_public_hosts():
    with mock.patch("socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (2, 1, 6, "", ("93.184.216.34", 443))  # public IP (example.com)
        ]
        assert _is_safe_public_url("https://example.com/cover.jpg")
        assert _is_safe_public_url("https://i.ytimg.com/vi/test/maxresdefault.jpg")


def test_download_and_convert_thumbnail_rejects_ssrf(tmp_path):
    out_path = os.path.join(str(tmp_path), "out.jpg")
    result = download_and_convert_thumbnail("http://127.0.0.1/evil.jpg", out_path)
    assert result is None
    assert not os.path.exists(out_path)


def test_download_and_convert_thumbnail_rejects_oversized_local_file(tmp_path):
    huge_file = os.path.join(str(tmp_path), "huge.png")
    out_path = os.path.join(str(tmp_path), "out.jpg")

    with open(huge_file, "wb") as f:
        # Seek past limit to create sparse/oversized file without allocating disk
        f.seek(MAX_THUMBNAIL_BYTES + 1024)
        f.write(b"0")

    result = download_and_convert_thumbnail(huge_file, out_path)
    assert result is None
    assert not os.path.exists(out_path)


def test_download_and_convert_thumbnail_rejects_oversized_dimensions(tmp_path):
    wide_img_path = os.path.join(str(tmp_path), "wide.png")
    out_path = os.path.join(str(tmp_path), "out.jpg")

    # 1 pixel high, but width exceeds MAX_THUMBNAIL_DIMENSION
    img = Image.new("RGB", (MAX_THUMBNAIL_DIMENSION + 10, 1), color=(255, 0, 0))
    img.save(wide_img_path, format="PNG")

    result = download_and_convert_thumbnail(wide_img_path, out_path)
    assert result is None
    assert not os.path.exists(out_path)
