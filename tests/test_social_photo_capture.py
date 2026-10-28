from __future__ import annotations

import io

from PIL import Image

from janeconverter import cli, social_photo_capture


def _webp_bytes() -> bytes:
    image = Image.new("RGB", (8, 8), color=(35, 90, 160))
    stream = io.BytesIO()
    image.save(stream, format="WEBP")
    return stream.getvalue()


def _jpeg_bytes() -> bytes:
    image = Image.new("RGB", (8, 8), color=(35, 90, 160))
    stream = io.BytesIO()
    image.save(stream, format="JPEG")
    return stream.getvalue()


def _avif_bytes() -> bytes:
    image = Image.new("RGB", (8, 8), color=(35, 90, 160))
    stream = io.BytesIO()
    image.save(stream, format="AVIF")
    return stream.getvalue()


def _mpo_bytes() -> bytes:
    primary = Image.new("RGB", (8, 8), color=(35, 90, 160))
    gain_map = Image.new("RGB", (4, 4), color=(120, 120, 120))
    stream = io.BytesIO()
    primary.save(stream, format="MPO", save_all=True, append_images=[gain_map])
    return stream.getvalue()


class _Response:
    def __init__(self, url: str, body: bytes, content_type: str = "image/webp"):
        self.url = url
        self.body = body
        self.headers = {"Content-Type": content_type, "Content-Length": str(len(body))}
        self.status_code = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def raise_for_status(self):
        return None

    def close(self):
        return None

    def iter_content(self, chunk_size: int):
        for offset in range(0, len(self.body), chunk_size):
            yield self.body[offset:offset + chunk_size]


class _Session:
    def __init__(self):
        self.headers = {}

    def get(self, url: str, **_kwargs):
        return _Response(url, _webp_bytes())

    def close(self):
        return None


def _manifest():
    return {
        "platform": "instagram",
        "title": "Public post",
        "photos": [
            {"id": "photo_1", "url": "https://scontent.cdninstagram.com/photo.webp", "width": 1080},
        ],
    }


def test_selected_png_format_converts_webp_social_photo(tmp_path, monkeypatch):
    monkeypatch.setattr(social_photo_capture.requests, "Session", _Session)

    result = social_photo_capture.download_social_photo_manifest(
        _manifest(),
        str(tmp_path),
        target_format="png",
    )

    saved = list((tmp_path / "Public post").glob("*"))
    assert result["photo_count"] == 1
    assert [path.suffix for path in saved] == [".png"]
    with Image.open(saved[0]) as image:
        assert image.format == "PNG"
        assert image.size == (8, 8)


def test_source_format_keeps_original_webp_social_photo(tmp_path, monkeypatch):
    monkeypatch.setattr(social_photo_capture.requests, "Session", _Session)

    social_photo_capture.download_social_photo_manifest(
        _manifest(),
        str(tmp_path),
        target_format="source",
    )

    saved = list((tmp_path / "Public post").glob("*"))
    assert [path.suffix for path in saved] == [".webp"]
    with Image.open(saved[0]) as image:
        assert image.format == "WEBP"


def test_valid_photo_with_unexpected_content_type_still_converts_to_png(tmp_path, monkeypatch):
    class _UnexpectedTypeSession(_Session):
        def get(self, url: str, **_kwargs):
            return _Response(url, _jpeg_bytes(), "application/octet-stream")

    monkeypatch.setattr(social_photo_capture.requests, "Session", _UnexpectedTypeSession)

    result = social_photo_capture.download_social_photo_manifest(
        _manifest(), str(tmp_path), target_format="png",
    )

    saved = list((tmp_path / "Public post").glob("*"))
    assert result["photo_count"] == 1
    assert [path.suffix for path in saved] == [".png"]
    with Image.open(saved[0]) as image:
        assert image.format == "PNG"


def test_avif_photo_converts_to_png(tmp_path, monkeypatch):
    class _AvifSession(_Session):
        def get(self, url: str, **_kwargs):
            return _Response(url, _avif_bytes(), "image/avif")

    monkeypatch.setattr(social_photo_capture.requests, "Session", _AvifSession)

    social_photo_capture.download_social_photo_manifest(_manifest(), str(tmp_path), target_format="png")

    saved = list((tmp_path / "Public post").glob("*"))
    assert [path.suffix for path in saved] == [".png"]
    with Image.open(saved[0]) as image:
        assert image.format == "PNG"


def test_mpo_photo_saves_as_jpg_and_converts_to_single_frame_png(tmp_path, monkeypatch):
    class _MpoSession(_Session):
        def get(self, url: str, **_kwargs):
            return _Response(url, _mpo_bytes(), "image/jpeg")

    monkeypatch.setattr(social_photo_capture.requests, "Session", _MpoSession)

    social_photo_capture.download_social_photo_manifest(_manifest(), str(tmp_path), target_format="source")
    saved_source = list((tmp_path / "Public post").glob("*"))
    assert [path.suffix for path in saved_source] == [".jpg"]

    social_photo_capture.download_social_photo_manifest(_manifest(), str(tmp_path), target_format="png")
    saved_png = list((tmp_path / "Public post (2)").glob("*"))
    assert [path.suffix for path in saved_png] == [".png"]
    with Image.open(saved_png[0]) as image:
        assert image.format == "PNG"
        assert getattr(image, "n_frames", 1) == 1
        assert image.size == (8, 8)


def test_non_image_response_does_not_publish_a_photo(tmp_path, monkeypatch):
    class _HtmlSession(_Session):
        def get(self, url: str, **_kwargs):
            return _Response(url, b"<html>Log in to view this photo</html>", "text/html")

    monkeypatch.setattr(social_photo_capture.requests, "Session", _HtmlSession)

    try:
        social_photo_capture.download_social_photo_manifest(_manifest(), str(tmp_path), target_format="png")
    except RuntimeError as error:
        assert "non-image response" in str(error)
    else:
        raise AssertionError("HTML response was accepted as a photo")
    assert list(tmp_path.iterdir()) == []


def test_conversion_passes_selected_image_format_to_social_downloader(tmp_path, monkeypatch):
    received = {}

    def download(_manifest, output_dir, **kwargs):
        received.update(kwargs)
        received["output_dir"] = output_dir
        return {"photo_count": 1, "folder_path": str(tmp_path / "export")}

    monkeypatch.setattr(cli, "download_social_photo_manifest", download)

    result = cli.process_conversion(
        source="https://www.instagram.com/p/public-post/",
        output_dir=str(tmp_path),
        target_format="png",
        bitrate="best",
        social_photo_manifest=_manifest(),
    )

    assert received["target_format"] == "png"
    assert received["quality"] == "best"
    assert result == str(tmp_path / "export")


def test_supported_collection_cdns_are_platform_scoped():
    valid_urls = {
        "tiktok": "https://p16-sign.tiktokcdn.com/tos/image.jpeg",
        "reddit": "https://i.redd.it/image.jpg",
        "tumblr": "https://64.media.tumblr.com/image.jpg",
        "pinterest": "https://i.pinimg.com/originals/image.jpg",
    }

    for platform, url in valid_urls.items():
        assert social_photo_capture._media_url(url, platform) == url
        try:
            social_photo_capture._media_url("https://notallowed.example/image.jpg", platform)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{platform} accepted an unapproved image host")


def test_new_photo_sources_use_their_own_library_folders(tmp_path):
    for platform, folder in (("tiktok", "TikTok"), ("reddit", "Reddit"), ("tumblr", "Tumblr"), ("pinterest", "Pinterest")):
        path = cli.media_library_folder(str(tmp_path), "source", platform, "Images")
        assert path.endswith(f"Images/{folder}") or path.endswith(f"Images\\{folder}")


def test_instagram_and_collection_urls_route_to_platform_library_folders(tmp_path):
    from janeconverter.extractor import identify_source_type

    assert identify_source_type("https://www.instagram.com/p/DFMyvpiSgxW/") == "instagram"
    assert identify_source_type("https://www.instagram.com/reel/DFMyvpiSgxW/") == "instagram"
    assert identify_source_type("https://instagr.am/p/DFMyvpiSgxW/") == "instagram"
    assert identify_source_type("https://www.tumblr.com/blog/123456/post") == "tumblr"
    assert identify_source_type("https://www.pinterest.com/pin/123456/") == "pinterest"
    assert identify_source_type("https://pin.it/abc123") == "pinterest"

    video_folder = cli.media_library_folder(
        f"\\\\?\\{tmp_path}",
        "mp4",
        identify_source_type("https://www.instagram.com/reel/DFMyvpiSgxW/"),
        "Videos",
    )
    assert not video_folder.startswith("\\\\?\\")
    assert video_folder.endswith("Videos/Instagram") or video_folder.endswith("Videos\\Instagram")


def test_sanitize_filename_preserves_multilingual_scripts_and_strips_rtl_bidi_marks():
    from janeconverter.extractor import sanitize_filename

    arabic_wrapped = "\u200f\u202bفيديو انستغرام رائع جدًا...\u202c\u200f"
    assert sanitize_filename(arabic_wrapped) == "فيديو انستغرام رائع جدًا"

    multilingual = "\u200eالعربية • 한국어 노래 • 日本語の曲 • 中文 • Русский...\u200f"
    assert sanitize_filename(multilingual) == "العربية • 한국어 노래 • 日本語の曲 • 中文 • Русский"


def test_arabic_instagram_photo_post_exports_to_clean_library_path(tmp_path, monkeypatch):
    monkeypatch.setattr(social_photo_capture.requests, "Session", _Session)

    manifest = {
        "platform": "instagram",
        "title": "\u200fلحظات جميلة من القاهرة...\u200f",
        "photos": [
            {"id": "photo_1", "url": "https://scontent.cdninstagram.com/photo.webp", "width": 1080},
        ],
    }
    photo_folder = cli.media_library_folder(f"\\\\?\\{tmp_path}", "source", "instagram", "Images")
    result = social_photo_capture.download_social_photo_manifest(
        manifest,
        photo_folder,
        target_format="source",
    )

    assert not result["folder_path"].startswith("\\\\?\\")
    assert result["title"] == "لحظات جميلة من القاهرة"
    saved = list((tmp_path / "Images" / "Instagram" / "لحظات جميلة من القاهرة").glob("*"))
    assert len(saved) == 1
    assert saved[0].name == "لحظات جميلة من القاهرة_001.webp"


def test_probe_media_streams_decodes_utf8_arabic_metadata(tmp_path, monkeypatch):
    from janeconverter import converter

    media_file = tmp_path / "arabic.mp3"
    media_file.write_bytes(b"ID3")
    captured_kwargs = {}

    class _Completed:
        returncode = 0
        stdout = '{"streams":[{"codec_type":"audio"}],"format":{"tags":{"title":"فيديو رائع \\u200f"}}}'

    def fake_run(*_args, **kwargs):
        captured_kwargs.update(kwargs)
        return _Completed()

    monkeypatch.setattr(converter.subprocess, "run", fake_run)
    probed = converter.probe_media_streams(str(media_file))

    assert captured_kwargs.get("encoding") == "utf-8"
    assert captured_kwargs.get("errors") == "replace"
    assert probed is not None
    assert probed["format"]["tags"]["title"].startswith("فيديو رائع")


def test_pinterest_candidate_urls():
    from janeconverter.social_photo_capture import _pinterest_candidate_urls

    # 1. 236x thumbnail produces originals first (with original and alt extensions), then display buckets, then fallback
    thumb_url = "https://i.pinimg.com/236x/8d/33/65/8d3365853fcf58b4566cf2be30a7d515.jpg"
    candidates = _pinterest_candidate_urls(thumb_url)
    assert candidates[0] == "https://i.pinimg.com/originals/8d/33/65/8d3365853fcf58b4566cf2be30a7d515.jpg"
    assert "https://i.pinimg.com/originals/8d/33/65/8d3365853fcf58b4566cf2be30a7d515.png" in candidates
    assert "https://i.pinimg.com/1200x/8d/33/65/8d3365853fcf58b4566cf2be30a7d515.jpg" in candidates
    assert "https://i.pinimg.com/736x/8d/33/65/8d3365853fcf58b4566cf2be30a7d515.jpg" in candidates
    assert candidates[-1] == thumb_url

    # 2. Already originals URL has that URL as the first candidate
    orig_url = "https://i.pinimg.com/originals/8d/33/65/8d3365853fcf58b4566cf2be30a7d515.jpg"
    candidates_orig = _pinterest_candidate_urls(orig_url)
    assert candidates_orig[0] == orig_url

    # 3. Non-pinterest URL returns [url]
    other_url = "https://pbs.twimg.com/media/example.jpg"
    assert _pinterest_candidate_urls(other_url) == [other_url]


def test_pinterest_get_photo_upgrades_to_highest_available_candidate():
    from janeconverter.social_photo_capture import _get_photo

    requested_urls: list[str] = []

    class _MockResponse:
        def __init__(self, url: str, status_code: int):
            self.url = url
            self.status_code = status_code
            self.closed = False

        def close(self):
            self.closed = True

    class _MockSession:
        def __init__(self, available_urls: set[str]):
            self.available_urls = available_urls
            self.headers = {}

        def get(self, url: str, **_kwargs):
            requested_urls.append(url)
            status = 200 if url in self.available_urls else 403
            return _MockResponse(url, status)

    # Scenario A: originals.jpg is 403, but originals.png is 200 (uploaded as PNG)
    png_original = "https://i.pinimg.com/originals/c3/ce/f8/c3cef8d24599723ec08d132649bca022.png"
    thumb_a = "https://i.pinimg.com/236x/c3/ce/f8/c3cef8d24599723ec08d132649bca022.jpg"
    session_a = _MockSession(available_urls={png_original, thumb_a})

    requested_urls.clear()
    resp_a = _get_photo(session_a, thumb_a, "pinterest")
    assert resp_a.status_code == 200
    assert resp_a.url == png_original

    # Scenario B: all originals are 403, but 736x is available
    res_736 = "https://i.pinimg.com/736x/8d/33/65/8d3365853fcf58b4566cf2be30a7d515.jpg"
    thumb_b = "https://i.pinimg.com/236x/8d/33/65/8d3365853fcf58b4566cf2be30a7d515.jpg"
    session_b = _MockSession(available_urls={res_736, thumb_b})

    requested_urls.clear()
    resp_b = _get_photo(session_b, thumb_b, "pinterest")
    assert resp_b.status_code == 200
    assert resp_b.url == res_736


def test_is_pinterest_newshub_url():
    from janeconverter.social_photo_capture import is_pinterest_newshub_url, is_pinterest_collection_url

    assert is_pinterest_newshub_url("https://ph.pinterest.com/news_hub/3943610033677608128/") is True
    assert is_pinterest_newshub_url("https://www.pinterest.com/news_hub/123456789") is True
    assert is_pinterest_newshub_url("https://pinterest.com/notifications/987654321") is True
    assert is_pinterest_newshub_url("https://www.pinterest.com/multi-pin-share/3085903370100674897/") is True
    assert is_pinterest_newshub_url("https://ph.pinterest.com/pin/123456789/") is False
    assert is_pinterest_newshub_url("https://instagram.com/p/abc123xyz") is False
    assert is_pinterest_newshub_url("not a url") is False

    assert is_pinterest_collection_url("https://www.pinterest.com/multi-pin-share/3085903370100674897/") is True
    assert is_pinterest_collection_url("https://ph.pinterest.com/news_hub/3943610033677608128/") is True
    assert is_pinterest_collection_url("https://pinterest.com/pin/123456") is False


def test_is_pinterest_pin_url():
    from janeconverter.social_photo_capture import is_pinterest_pin_url

    assert is_pinterest_pin_url("https://www.pinterest.com/pin/114067803058525657/") is True
    assert is_pinterest_pin_url("https://ph.pinterest.com/pin/123456789/") is True
    assert is_pinterest_pin_url("https://se.pinterest.com/pin/622552348532976470/") is True
    assert is_pinterest_pin_url("https://www.pinterest.com/multi-pin-share/3085903370100674897/") is False
    assert is_pinterest_pin_url("https://www.pinterest.com/news_hub/123456789") is False
    assert is_pinterest_pin_url("not a url") is False


def test_fetch_pinterest_multi_pin_share_manifest(monkeypatch):
    import io
    import json
    from http.cookiejar import Cookie
    from janeconverter.social_photo_capture import fetch_pinterest_collection_manifest

    fake_cookie = Cookie(
        version=0, name="csrftoken", value="fake_csrf", port=None, port_specified=False,
        domain=".pinterest.com", domain_specified=True, domain_initial_dot=True,
        path="/", path_specified=True, secure=True, expires=None, discard=False,
        comment=None, comment_url=None, rest={}, rfc2109=False,
    )
    fake_auth_cookie = Cookie(
        version=0, name="_auth", value="1", port=None, port_specified=False,
        domain=".pinterest.com", domain_specified=True, domain_initial_dot=True,
        path="/", path_specified=True, secure=True, expires=None, discard=False,
        comment=None, comment_url=None, rest={}, rfc2109=False,
    )

    import http.cookiejar
    class FakeCookieJar(http.cookiejar.CookieJar):
        filename = None

    fake_jar = FakeCookieJar()
    fake_jar.set_cookie(fake_cookie)
    fake_jar.set_cookie(fake_auth_cookie)

    import yt_dlp
    monkeypatch.setattr(yt_dlp.cookies, "extract_cookies_from_browser", lambda b, *a, **kw: fake_jar if b == "vivaldi" else [])

    class FakeOpener:
        def open(self, req):
            url = req.full_url
            if "multipinshare" in url:
                resp = {
                    "resource_response": {
                        "data": {
                            "id": "3085903370100674897",
                            "pin_ids": ["111222333", "444555666"],
                        }
                    }
                }
                return io.BytesIO(json.dumps(resp).encode("utf-8"))
            elif "pins" in url:
                resp = {
                    "resource_response": {
                        "data": [
                            {
                                "id": "111222333",
                                "title": "First Pin",
                                "image_large_url": "https://i.pinimg.com/1200x/aa/bb/cc/aabbcc01.jpg",
                            },
                            {
                                "id": "444555666",
                                "title": "Second Pin",
                                "image_large_url": "https://i.pinimg.com/736x/dd/ee/ff/ddeeff02.jpg",
                            },
                        ]
                    }
                }
                return io.BytesIO(json.dumps(resp).encode("utf-8"))
            raise ValueError(f"Unexpected url: {url}")

    monkeypatch.setattr("urllib.request.build_opener", lambda *args: FakeOpener())

    manifest = fetch_pinterest_collection_manifest("https://www.pinterest.com/multi-pin-share/3085903370100674897/")
    assert manifest["platform"] == "pinterest"
    assert manifest["title"] == "Pinterest Share 3085903370100674897"
    assert len(manifest["photos"]) == 2
    assert manifest["photos"][0]["url"] == "https://i.pinimg.com/originals/aa/bb/cc/aabbcc01.jpg"
    assert manifest["photos"][1]["url"] == "https://i.pinimg.com/originals/dd/ee/ff/ddeeff02.jpg"



def test_fetch_pinterest_newshub_manifest(monkeypatch):
    import io
    import json
    from http.cookiejar import Cookie
    from janeconverter.social_photo_capture import fetch_pinterest_newshub_manifest

    fake_cookie = Cookie(
        version=0, name="csrftoken", value="fake_csrf", port=None, port_specified=False,
        domain=".pinterest.com", domain_specified=True, domain_initial_dot=True,
        path="/", path_specified=True, secure=True, expires=None, discard=False,
        comment=None, comment_url=None, rest={}, rfc2109=False,
    )
    fake_auth_cookie = Cookie(
        version=0, name="_auth", value="1", port=None, port_specified=False,
        domain=".pinterest.com", domain_specified=True, domain_initial_dot=True,
        path="/", path_specified=True, secure=True, expires=None, discard=False,
        comment=None, comment_url=None, rest={}, rfc2109=False,
    )

    import http.cookiejar
    class FakeCookieJar(http.cookiejar.CookieJar):
        filename = None

    fake_jar = FakeCookieJar()
    fake_jar.set_cookie(fake_cookie)
    fake_jar.set_cookie(fake_auth_cookie)

    import yt_dlp
    monkeypatch.setattr(yt_dlp.cookies, "extract_cookies_from_browser", lambda b, *a, **kw: fake_jar if b == "vivaldi" else [])

    fake_api_response = {
        "resource_response": {
            "data": [
                {
                    "detail_header": "Made the cut",
                    "content_items": [
                        {
                            "action_object": {
                                "image_square_url": "https://i.pinimg.com/150x150/f1/83/2e/f1832e0bb5921309a831495f78a913f9.jpg"
                            }
                        },
                        {
                            "action_object": {
                                "image_url": "https://i.pinimg.com/236x/ab/cd/ef/abcdef0123456789abcdef0123456789.jpg"
                            }
                        }
                    ]
                }
            ]
        }
    }

    class FakeOpener:
        def open(self, req):
            assert "NewsHubDetailsResource" in req.full_url
            return io.BytesIO(json.dumps(fake_api_response).encode("utf-8"))

    monkeypatch.setattr("urllib.request.build_opener", lambda *args: FakeOpener())

    manifest = fetch_pinterest_newshub_manifest("https://ph.pinterest.com/news_hub/3943610033677608128/")
    assert manifest["platform"] == "pinterest"
    assert manifest["title"] == "Made the cut"
    assert len(manifest["photos"]) == 2
    assert manifest["photos"][0]["url"] == "https://i.pinimg.com/originals/f1/83/2e/f1832e0bb5921309a831495f78a913f9.jpg"
    assert manifest["photos"][1]["url"] == "https://i.pinimg.com/originals/ab/cd/ef/abcdef0123456789abcdef0123456789.jpg"


def test_instagram_shortcode_and_url_helpers():
    from janeconverter.social_photo_capture import _shortcode_to_pk, is_instagram_post_url

    assert _shortcode_to_pk("DFMyvpiSgxW") == 3552437382828133462
    assert is_instagram_post_url("https://www.instagram.com/p/DFMyvpiSgxW/") is True
    assert is_instagram_post_url("https://instagram.com/reel/DFMyvpiSgxW") is True
    assert is_instagram_post_url("https://instagr.am/p/DFMyvpiSgxW/") is True
    assert is_instagram_post_url("https://www.instagram.com/user/p/DFMyvpiSgxW/") is True
    assert is_instagram_post_url("https://pinterest.com/pin/123456") is False
    assert is_instagram_post_url("invalid") is False


def test_fetch_instagram_manifest(monkeypatch):
    import io
    import json
    import http.cookiejar
    from http.cookiejar import Cookie
    from janeconverter.social_photo_capture import fetch_instagram_manifest

    fake_session_cookie = Cookie(
        version=0, name="sessionid", value="fake_session", port=None, port_specified=False,
        domain=".instagram.com", domain_specified=True, domain_initial_dot=True,
        path="/", path_specified=True, secure=True, expires=None, discard=False,
        comment=None, comment_url=None, rest={}, rfc2109=False,
    )
    fake_user_cookie = Cookie(
        version=0, name="ds_user_id", value="12345", port=None, port_specified=False,
        domain=".instagram.com", domain_specified=True, domain_initial_dot=True,
        path="/", path_specified=True, secure=True, expires=None, discard=False,
        comment=None, comment_url=None, rest={}, rfc2109=False,
    )

    class FakeCookieJar(http.cookiejar.CookieJar):
        filename = None

    fake_jar = FakeCookieJar()
    fake_jar.set_cookie(fake_session_cookie)
    fake_jar.set_cookie(fake_user_cookie)

    import yt_dlp
    monkeypatch.setattr(yt_dlp.cookies, "extract_cookies_from_browser", lambda b, *a, **kw: fake_jar if b == "vivaldi" else [])

    fake_api_response = {
        "items": [
            {
                "pk": 3552437382828133462,
                "media_type": 8,
                "user": {"username": "test_artist"},
                "caption": {"text": "Studio setup and master bounce\nSecond line"},
                "carousel_media": [
                    {
                        "pk": 1111111111,
                        "image_versions2": {
                            "candidates": [
                                {"url": "https://instagram.fbag4-1.fna.fbcdn.net/v/photo1_high.webp", "width": 1440, "height": 1800},
                                {"url": "https://instagram.fbag4-1.fna.fbcdn.net/v/photo1_low.webp", "width": 640, "height": 800},
                            ]
                        }
                    },
                    {
                        "pk": 2222222222,
                        "image_versions2": {
                            "candidates": [
                                {"url": "https://instagram.fbag4-1.fna.fbcdn.net/v/photo2_high.webp", "width": 1440, "height": 1800},
                            ]
                        }
                    }
                ]
            }
        ]
    }

    class FakeOpener:
        def open(self, req):
            assert "i.instagram.com/api/v1/media/3552437382828133462/info/" in req.full_url
            assert req.get_header("X-ig-app-id") == "936619743392459" or req.headers.get("X-ig-app-id") == "936619743392459" or req.headers.get("X-IG-App-ID") == "936619743392459"
            return io.BytesIO(json.dumps(fake_api_response).encode("utf-8"))

    monkeypatch.setattr("urllib.request.build_opener", lambda *args: FakeOpener())

    manifest = fetch_instagram_manifest("https://www.instagram.com/p/DFMyvpiSgxW/")
    assert manifest is not None
    assert manifest["platform"] == "instagram"
    assert manifest["title"] == "Studio setup and master bounce"
    assert len(manifest["photos"]) == 2
    assert manifest["photos"][0]["url"] == "https://instagram.fbag4-1.fna.fbcdn.net/v/photo1_high.webp"
    assert manifest["photos"][0]["width"] == 1440
    assert manifest["photos"][1]["url"] == "https://instagram.fbag4-1.fna.fbcdn.net/v/photo2_high.webp"


def test_fetch_instagram_manifest_handles_null_caption_and_single_photo(monkeypatch):
    import http.cookiejar
    from http.cookiejar import Cookie
    import json
    import yt_dlp

    fake_session_cookie = Cookie(
        version=0, name="sessionid", value="fake_session", port=None, port_specified=False,
        domain=".instagram.com", domain_specified=True, domain_initial_dot=True,
        path="/", path_specified=True, secure=True, expires=None, discard=False,
        comment=None, comment_url=None, rest={}, rfc2109=False,
    )
    class FakeCookieJar(http.cookiejar.CookieJar):
        filename = None

    fake_jar = FakeCookieJar()
    fake_jar.set_cookie(fake_session_cookie)
    empty_jar = FakeCookieJar()
    monkeypatch.setattr(yt_dlp.cookies, "extract_cookies_from_browser", lambda b, *a, **kw: fake_jar if b == "vivaldi" else empty_jar)

    fake_api_response = {
        "items": [
            {
                "pk": 4006878054114504149,
                "media_type": 1,
                "user": {"username": "yanya_uxu"},
                "caption": None,
                "carousel_media": None,
                "image_versions2": {
                    "candidates": [
                        {"url": "https://instagram.fbag4-1.fna.fbcdn.net/v/single_high.webp", "width": 1440, "height": 1800},
                        {"url": "https://instagram.fbag4-1.fna.fbcdn.net/v/single_low.webp", "width": 640, "height": 800},
                    ]
                }
            }
        ]
    }

    class FakeOpener:
        def open(self, req):
            return io.BytesIO(json.dumps(fake_api_response).encode("utf-8"))

    monkeypatch.setattr("urllib.request.build_opener", lambda *args: FakeOpener())

    manifest = social_photo_capture.fetch_instagram_manifest("https://www.instagram.com/p/DebSlxhza3V/")
    assert manifest is not None
    assert manifest["platform"] == "instagram"
    assert manifest["title"] == "Instagram Post by @yanya_uxu"
    assert len(manifest["photos"]) == 1
    assert manifest["photos"][0]["url"] == "https://instagram.fbag4-1.fna.fbcdn.net/v/single_high.webp"
    assert manifest["photos"][0]["width"] == 1440






def test_resolve_pinterest_shortlink_safe_and_unsafe_redirects(monkeypatch):
    from janeconverter.social_photo_capture import resolve_pinterest_shortlink

    # Non-pin.it link returned unchanged immediately
    assert resolve_pinterest_shortlink("https://example.com/item") == "https://example.com/item"

    class FakeResponse:
        def __init__(self, status_code, headers):
            self.status_code = status_code
            self.headers = headers
        def close(self):
            pass

    # Safe redirect
    def fake_head(self, url, *args, **kwargs):
        if url == "https://pin.it/safe123":
            return FakeResponse(301, {"Location": "https://www.pinterest.com/pin/123456789/"})
        elif url == "https://www.pinterest.com/pin/123456789/":
            return FakeResponse(200, {})
        raise ValueError(f"Unexpected url requested: {url}")

    monkeypatch.setattr("requests.Session.head", fake_head)
    monkeypatch.setattr("janeconverter.extractor._is_safe_public_url", lambda u: "127.0.0.1" not in u and "169.254" not in u)

    resolved = resolve_pinterest_shortlink("https://pin.it/safe123")
    assert resolved == "https://www.pinterest.com/pin/123456789/"

    # Unsafe redirect to loopback: must be aborted before requesting the target
    def fake_head_unsafe(self, url, *args, **kwargs):
        if url == "https://pin.it/evil":
            return FakeResponse(302, {"Location": "http://127.0.0.1:8080/admin"})
        raise AssertionError(f"Head should not be called on unsafe target: {url}")

    monkeypatch.setattr("requests.Session.head", fake_head_unsafe)
    result = resolve_pinterest_shortlink("https://pin.it/evil")
    assert result == "https://pin.it/evil"
