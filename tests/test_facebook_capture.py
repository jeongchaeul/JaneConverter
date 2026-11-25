from __future__ import annotations

import io

import pytest
from PIL import Image

from janeconverter import facebook_capture


def _jpeg_bytes() -> bytes:
    image = Image.new("RGB", (8, 8), color=(35, 90, 160))
    stream = io.BytesIO()
    image.save(stream, format="JPEG")
    return stream.getvalue()


class _Response:
    def __init__(self, url: str, body: bytes, content_type: str = "image/jpeg"):
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
    def __init__(self, response_type: str = "image/jpeg", body: bytes | None = None):
        self.headers = {}
        self.response_type = response_type
        self.body = body if body is not None else _jpeg_bytes()
        self.requested = []

    def get(self, url: str, **_kwargs):
        self.requested.append(url)
        return _Response(url, self.body, self.response_type)

    def close(self):
        return None


class _RedirectResponse(_Response):
    def __init__(self, url: str, location: str):
        super().__init__(url, b"")
        self.headers = {"Location": location}
        self.status_code = 302


class _RedirectSession(_Session):
    def get(self, url: str, **_kwargs):
        self.requested.append(url)
        return _RedirectResponse(url, "https://example.com/redirected-photo.jpg")


def _manifest():
    return {
        "title": "Public album",
        "photos": [
            {"id": "123456", "url": "https://scontent-1.xx.fbcdn.net/low.jpg", "width": 480},
            {"id": "123456", "url": "https://scontent-1.xx.fbcdn.net/high.jpg", "width": 1080},
            {"id": "234567", "url": "https://scontent-2.xx.fbcdn.net/second.jpg", "width": 960},
        ],
    }


def test_manifest_download_deduplicates_and_keeps_largest_rendition(tmp_path, monkeypatch):
    session = _Session()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)
    reports = []

    result = facebook_capture.download_facebook_photo_manifest(
        _manifest(),
        str(tmp_path),
        progress_callback=lambda progress, message: reports.append((progress, message)),
    )

    album_dir = tmp_path / "Public album"
    assert result["photo_count"] == 2
    assert session.requested == [
        "https://scontent-1.xx.fbcdn.net/high.jpg",
        "https://scontent-2.xx.fbcdn.net/second.jpg",
    ]
    saved = sorted(album_dir.glob("*.jpg"))
    assert len(saved) == 2
    with Image.open(saved[0]) as image:
        assert image.size == (8, 8)
    assert reports[-1][0] == 1.0
    assert not list(tmp_path.glob(".facebook-album-*"))


def test_manifest_converts_photo_to_selected_png(tmp_path, monkeypatch):
    monkeypatch.setattr(facebook_capture.requests, "Session", _Session)

    facebook_capture.download_facebook_photo_manifest(
        _manifest(),
        str(tmp_path),
        target_format="png",
    )

    saved = sorted((tmp_path / "Public album").glob("*"))
    assert len(saved) == 2
    assert all(path.suffix == ".png" for path in saved)
    with Image.open(saved[0]) as image:
        assert image.format == "PNG"


@pytest.mark.parametrize(
    "url",
    [
        "http://scontent.xx.fbcdn.net/photo.jpg",
        "https://example.com/photo.jpg",
        "https://user@example.xx.fbcdn.net/photo.jpg",
        "https://scontent.xx.fbcdn.net/v/t39.1997-6/sticker.png",
        "https://scontent.xx.fbcdn.net/stickers/reaction.png",
        "https://static.xx.fbcdn.net/images/emoji.php/v9/t6d/1/16/1f3ce.png",
    ],
)
def test_manifest_rejects_non_public_or_non_cdn_urls(tmp_path, url):
    manifest = {
        "title": "Invalid album",
        "photos": [
            {"id": "123456", "url": url, "width": 960},
            {"id": "234567", "url": "https://scontent.xx.fbcdn.net/second.jpg", "width": 960},
        ],
    }

    with pytest.raises(ValueError, match="public media CDN"):
        facebook_capture.download_facebook_photo_manifest(manifest, str(tmp_path))


def test_manifest_never_follows_redirects_outside_facebook_cdn(tmp_path, monkeypatch):
    session = _RedirectSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    with pytest.raises(RuntimeError, match="redirected a photo outside"):
        facebook_capture.download_facebook_photo_manifest(_manifest(), str(tmp_path))

    assert session.requested == ["https://scontent-1.xx.fbcdn.net/high.jpg"]


def test_response_label_does_not_override_decoded_image_format(tmp_path, monkeypatch):
    session = _Session(response_type="text/html")
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    result = facebook_capture.download_facebook_photo_manifest(_manifest(), str(tmp_path))

    assert result["photo_count"] == 2
    assert len(list((tmp_path / "Public album").glob("*.jpg"))) == 2


def test_failed_image_validation_removes_staging_without_partial_album(tmp_path, monkeypatch):
    session = _Session(response_type="image/jpeg", body=b"<html>not a photo</html>")
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    with pytest.raises(RuntimeError, match="could not be downloaded or decoded"):
        facebook_capture.download_facebook_photo_manifest(_manifest(), str(tmp_path))

    assert not list(tmp_path.glob(".facebook-album-*"))
    assert not (tmp_path / "Public album").exists()


def test_expired_rendition_uses_observed_alternate_in_same_album(tmp_path, monkeypatch):
    class RecoveringSession(_Session):
        def get(self, url: str, **kwargs):
            if url.endswith("high.jpg"):
                self.requested.append(url)
                return _Response(url, b"expired", "text/html")
            return super().get(url, **kwargs)

    session = RecoveringSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)
    manifest = _manifest()
    result = facebook_capture.download_facebook_photo_manifest(manifest, str(tmp_path))

    assert result["photo_count"] == 2
    high_idx = session.requested.index("https://scontent-1.xx.fbcdn.net/high.jpg")
    low_idx = session.requested.index("https://scontent-1.xx.fbcdn.net/low.jpg")
    assert high_idx < low_idx
    assert "https://scontent-2.xx.fbcdn.net/second.jpg" in session.requested


def test_expired_renditions_refresh_once_from_the_active_capture(tmp_path, monkeypatch):
    class RefreshingSession(_Session):
        def get(self, url: str, **kwargs):
            self.requested.append(url)
            if "refreshed.jpg" not in url and not url.endswith("second.jpg"):
                return _Response(url, b"expired", "text/html")
            return _Response(url, _jpeg_bytes())

    session = RefreshingSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)
    refresh_requests = []

    def refresh(photo_id: str) -> list[str]:
        refresh_requests.append(photo_id)
        return [f"https://scontent-1.xx.fbcdn.net/{photo_id}-refreshed.jpg"]

    result = facebook_capture.download_facebook_photo_manifest(
        _manifest(),
        str(tmp_path),
        refresh_candidates=refresh,
    )

    assert result["photo_count"] == 2
    assert refresh_requests == ["123456"]
    high_idx = session.requested.index("https://scontent-1.xx.fbcdn.net/high.jpg")
    low_idx = session.requested.index("https://scontent-1.xx.fbcdn.net/low.jpg")
    refresh_idx = session.requested.index("https://scontent-1.xx.fbcdn.net/123456-refreshed.jpg")
    assert high_idx < low_idx < refresh_idx
    assert "https://scontent-2.xx.fbcdn.net/second.jpg" in session.requested


def test_rendition_refresh_ignores_urls_outside_facebook_cdn(tmp_path, monkeypatch):
    class RefreshingSession(_Session):
        def get(self, url: str, **kwargs):
            self.requested.append(url)
            if "refreshed.jpg" in url or url.endswith("second.jpg"):
                return _Response(url, _jpeg_bytes())
            return _Response(url, b"expired", "text/html")

    session = RefreshingSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    result = facebook_capture.download_facebook_photo_manifest(
        _manifest(),
        str(tmp_path),
        refresh_candidates=lambda _photo_id: [
            "https://example.test/forbidden.jpg",
            "https://scontent-1.xx.fbcdn.net/refreshed.jpg",
        ],
    )

    assert result["photo_count"] == 2
    assert "https://example.test/forbidden.jpg" not in session.requested
    assert "https://scontent-1.xx.fbcdn.net/refreshed.jpg" in session.requested


def test_rendition_refresh_is_bounded_across_the_album(tmp_path, monkeypatch):
    class RefreshingSession(_Session):
        def get(self, url: str, **kwargs):
            self.requested.append(url)
            if "refreshed.jpg" in url:
                return _Response(url, _jpeg_bytes())
            if url.endswith("photo-8.jpg"):
                return _Response(url, b"expired", "text/html")
            return _Response(url, b"expired", "text/html")

    session = RefreshingSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)
    manifest = {
        "title": "Bounded refresh",
        "photos": [
            {"id": str(100000 + index), "url": f"https://scontent.xx.fbcdn.net/photo-{index}.jpg"}
            for index in range(facebook_capture.MAX_RENDITION_REFRESHES + 1)
        ],
    }
    refreshed = []

    def refresh(photo_id: str) -> list[str]:
        refreshed.append(photo_id)
        return [f"https://scontent.xx.fbcdn.net/{photo_id}-refreshed.jpg"]

    with pytest.raises(RuntimeError, match="No partial album was saved"):
        facebook_capture.download_facebook_photo_manifest(
            manifest,
            str(tmp_path),
            refresh_candidates=refresh,
        )

    assert len(refreshed) == facebook_capture.MAX_RENDITION_REFRESHES
    assert not (tmp_path / "Bounded refresh").exists()
    assert not list(tmp_path.glob(".facebook-album-*"))


def test_second_photo_failure_never_publishes_the_first(tmp_path, monkeypatch):
    class PartialSession(_Session):
        def get(self, url: str, **kwargs):
            if url.endswith("second.jpg"):
                self.requested.append(url)
                return _Response(url, b"expired", "image/jpeg")
            return super().get(url, **kwargs)

    session = PartialSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)
    with pytest.raises(RuntimeError, match="No partial album was saved"):
        facebook_capture.download_facebook_photo_manifest(_manifest(), str(tmp_path))

    assert not (tmp_path / "Public album").exists()
    assert not list(tmp_path.glob(".facebook-album-*"))


def test_manifest_download_single_photo(tmp_path, monkeypatch):
    session = _Session()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)
    reports = []
    manifest = {
        "title": "Wonyoung Solo Post",
        "photos": [
            {"id": "999888777", "url": "https://scontent-1.xx.fbcdn.net/solo.jpg", "width": 1080},
        ],
    }

    result = facebook_capture.download_facebook_photo_manifest(
        manifest,
        str(tmp_path),
        progress_callback=lambda progress, message: reports.append((progress, message)),
    )

    album_dir = tmp_path / "Wonyoung Solo Post"
    assert result["photo_count"] == 1
    assert session.requested == ["https://scontent-1.xx.fbcdn.net/solo.jpg"]
    saved = sorted(album_dir.glob("*.jpg"))
    assert len(saved) == 1
    with Image.open(saved[0]) as image:
        assert image.size == (8, 8)
    assert reports[-1] == (1.0, "Saved 1 Facebook photo.")
    assert not list(tmp_path.glob(".facebook-album-*"))


def test_manifest_empty_photos_raises(tmp_path):
    manifest = {
        "title": "Empty Post",
        "photos": [],
    }
    with pytest.raises(RuntimeError, match="does not contain downloadable photos"):
        facebook_capture.download_facebook_photo_manifest(manifest, str(tmp_path))


def test_is_facebook_post_url():
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/share/p/1EZzZ7RdBe/") is True
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/share/v/1DuAvWDUy7/") is False
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/share/r/1AbCdEfG/") is False
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/permalink.php?story_fbid=123&id=456") is True
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/user/posts/12345678") is True
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/photo/?fbid=12345678") is True
    assert facebook_capture.is_facebook_post_url("https://fb.watch/xyz123/") is True
    assert facebook_capture.is_facebook_post_url("https://youtube.com/watch?v=123") is False
    assert facebook_capture.is_facebook_post_url("https://instagram.com/p/123") is False
    assert facebook_capture.is_facebook_post_url("") is False


def test_fetch_facebook_manifest_disabled_browser():
    assert facebook_capture.fetch_facebook_manifest("https://www.facebook.com/share/p/1EZzZ7RdBe/", browser="none") is None
    assert facebook_capture.fetch_facebook_manifest("https://www.facebook.com/share/p/1EZzZ7RdBe/", browser="disabled") is None


def test_fetch_facebook_manifest_mocked(monkeypatch):
    class _MockCookie:
        def __init__(self, name, value, domain=".facebook.com", path="/"):
            self.name = name
            self.value = value
            self.domain = domain
            self.path = path

    class _MockYDL:
        def __init__(self, *args, **kwargs):
            self.cookiejar = [_MockCookie("c_user", "10001"), _MockCookie("xs", "secret")]

    import yt_dlp
    monkeypatch.setattr(yt_dlp, "YoutubeDL", _MockYDL)

    html_content = (
        '<html><head><title>Test Album - Facebook</title></head><body>'
        '<script>'
        '{"all_subattachments":{"count":2,"nodes":['
        '{"media":{"__typename":"Photo","id":"112233","is_playable":false,"image":{"uri":"https:\\/\\/scontent-1.xx.fbcdn.net\\/photo1.jpg","width":1080,"height":1080}}},'
        '{"media":{"__typename":"Photo","id":"445566","is_playable":false,"image":{"uri":"https:\\/\\/scontent-2.xx.fbcdn.net\\/photo2.jpg","width":720,"height":720}}}'
        ']}}'
        '</script></body></html>'
    )

    class _MockSession:
        def __init__(self):
            self.cookies = {}
            self.headers = {}
        def set_cookie(self, name, value, domain=None, path=None):
            pass
        def get(self, url, **kwargs):
            class _Resp:
                status_code = 200
                url = "https://www.facebook.com/permalink.php?story_fbid=112233"
                text = html_content
            return _Resp()

    class _MockCookiesObj:
        def set(self, name, value, domain=None, path=None):
            pass

    mock_sess = _MockSession()
    mock_sess.cookies = _MockCookiesObj()

    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: mock_sess)

    manifest = facebook_capture.fetch_facebook_manifest("https://www.facebook.com/share/p/1EZzZ7RdBe/", browser="vivaldi")
    assert manifest is not None
    assert manifest["platform"] == "facebook"
    assert manifest["title"] == "Test Album"
    assert len(manifest["photos"]) == 2
    assert manifest["photos"][0]["id"] == "112233"
    assert manifest["photos"][0]["width"] == 1080
    assert "https://scontent-1.xx.fbcdn.net/photo1.jpg" in manifest["photos"][0]["url"]


def test_clean_fb_photo_url():
    raw = "https://scontent.xx.fbcdn.net/v/t39.30808-6/123_n.jpg?stp=dst-jpg&cstp=mx1536x2048&ctp=s960x960&_nc_cat=104"
    cleaned = facebook_capture._clean_fb_photo_url(raw)
    assert "ctp=s960x960" not in cleaned
    assert "cstp=mx1536x2048" in cleaned
    assert cleaned.startswith("https://scontent.xx.fbcdn.net/")


def test_fetch_facebook_manifest_mediaset_complete_album(monkeypatch):
    class _MockCookie:
        def __init__(self, name, value, domain=".facebook.com", path="/"):
            self.name = name
            self.value = value
            self.domain = domain
            self.path = path

    class _MockYDL:
        def __init__(self, *args, **kwargs):
            self.cookiejar = [_MockCookie("c_user", "10001"), _MockCookie("xs", "secret")]

    import yt_dlp
    monkeypatch.setattr(yt_dlp, "YoutubeDL", _MockYDL)

    post_html = (
        '<html><head><title>Album Post - Facebook</title></head><body>'
        '<script>'
        '{"mediaset_token":"pcb.998877",'
        '"all_subattachments":{"count":15,"nodes":[{"media":{"__typename":"Photo","id":"111","image":{"uri":"https:\\/\\/scontent-1.xx.fbcdn.net\\/p1.jpg"}}}]}}'
        '</script>'
        # Unrelated suggested post in the feed with arbitrary Photo typename
        '<script>{"suggested":{"__typename":"Photo","id":"999999","image":{"uri":"https:\\/\\/scontent-9.xx.fbcdn.net\\/meme.jpg"}}}</script>'
        '</body></html>'
    )

    mediaset_html = (
        '<html><head><title>Photos in Album - Facebook</title></head><body>'
        '<script>'
        '{"media":{"edges":['
        + ",".join(
            f'{{"node":{{"__typename":"Photo","id":"{i}","image":{{"uri":"https:\\/\\/scontent-1.xx.fbcdn.net\\/photo{i}.jpg?ctp=s960x960","width":720,"height":960}}}}}}'
            for i in range(1, 16)
        )
        + '],"page_info":{"has_next_page":false}}}'
        '</script></body></html>'
    )

    class _MockSession:
        def __init__(self):
            self.cookies = type("MockCookies", (), {"set": lambda *args, **kwargs: None})()
            self.headers = {}
        def get(self, url, **kwargs):
            class _Resp:
                def __init__(self, text, resp_url):
                    self.status_code = 200
                    self.text = text
                    self.url = resp_url
            if "media/set" in url:
                return _Resp(mediaset_html, url)
            return _Resp(post_html, url)

    monkeypatch.setattr(facebook_capture.requests, "Session", _MockSession)

    manifest = facebook_capture.fetch_facebook_manifest("https://www.facebook.com/share/p/19RLsXCtZM/", browser="vivaldi")
    assert manifest is not None
    assert manifest["title"] == "Album Post"
    assert len(manifest["photos"]) == 15
    # Ensure all 15 album photos were retrieved
    for i in range(1, 16):
        assert any(p["id"] == str(i) for p in manifest["photos"])
    # Ensure unrelated suggestion photo 999999 was NOT included
    assert not any(p["id"] == "999999" for p in manifest["photos"])
    # Ensure ctp=s960x960 was stripped to preserve full resolution
    assert "ctp=s960x960" not in manifest["photos"][0]["url"]


def test_fetch_facebook_manifest_album_graphql_pagination(monkeypatch):
    class _MockCookie:
        def __init__(self, name, value, domain=".facebook.com", path="/"):
            self.name = name
            self.value = value
            self.domain = domain
            self.path = path

    class _MockYDL:
        def __init__(self, *args, **kwargs):
            self.cookiejar = [_MockCookie("c_user", "10001"), _MockCookie("xs", "secret")]

    import yt_dlp
    monkeypatch.setattr(yt_dlp, "YoutubeDL", _MockYDL)

    post_html = (
        '<html><head><title>Album Post - Facebook</title></head><body>'
        '<script>'
        '{"mediaset_token":"pcb.778899"}'
        '</script>'
        '</body></html>'
    )

    mediaset_html = (
        '<html><head><title>Photos in Album - Facebook</title></head><body>'
        '<script>'
        '{"DTSGInitialData":{"token":"dtsg_secret_token_12345"}}'
        '</script>'
        '<script>'
        '{"media":{"edges":['
        '{"node":{"__typename":"Photo","id":"101","image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/photo101.jpg","width":1080,"height":1080}}},'
        '{"node":{"__typename":"Photo","id":"102","image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/photo102.jpg","width":1080,"height":1080}}}'
        '],"page_info":{"end_cursor":"cursor_batch_1","has_next_page":true}},"id":"bWVkaWFzZXQ6cGNiLjc3ODg5OQ=="}'
        '</script></body></html>'
    )

    graphql_page_2 = {
        "data": {
            "node": {
                "media": {
                    "edges": [
                        {"node": {"__typename": "Photo", "id": "103", "image": {"uri": "https://scontent.xx.fbcdn.net/photo103.jpg", "width": 1080, "height": 1080}}},
                        {"node": {"__typename": "Photo", "id": "104", "image": {"uri": "https://scontent.xx.fbcdn.net/photo104.jpg", "width": 1080, "height": 1080}}},
                    ],
                    "page_info": {
                        "end_cursor": "cursor_batch_2",
                        "has_next_page": False,
                    },
                }
            }
        }
    }

    class _MockSession:
        def __init__(self):
            self.cookies = type("MockCookies", (), {"set": lambda *args, **kwargs: None})()
            self.headers = {}
            self.graphql_calls = []

        def get(self, url, **kwargs):
            class _Resp:
                def __init__(self, text, resp_url):
                    self.status_code = 200
                    self.text = text
                    self.url = resp_url
            if "media/set" in url:
                return _Resp(mediaset_html, url)
            return _Resp(post_html, url)

        def post(self, url, **kwargs):
            self.graphql_calls.append((url, kwargs.get("data", {})))
            class _GqlResp:
                status_code = 200
                def json(self):
                    return graphql_page_2
            return _GqlResp()

    session_inst = _MockSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session_inst)

    manifest = facebook_capture.fetch_facebook_manifest("https://www.facebook.com/share/p/19RLsXCtZM/", browser="vivaldi")
    assert manifest is not None
    assert manifest["title"] == "Album Post"
    assert len(manifest["photos"]) == 4
    assert [p["id"] for p in manifest["photos"]] == ["101", "102", "103", "104"]
    assert len(session_inst.graphql_calls) == 1
    gql_url, gql_payload = session_inst.graphql_calls[0]
    assert "api/graphql" in gql_url
    assert gql_payload["doc_id"] == "28559589567041913"
    assert "cursor_batch_1" in gql_payload["variables"]


def test_fetch_facebook_manifest_grid_album_graphql_pagination_guest(monkeypatch):
    class _EmptyYDL:
        def __init__(self, *args, **kwargs):
            self.cookiejar = []

    import yt_dlp
    monkeypatch.setattr(yt_dlp, "YoutubeDL", _EmptyYDL)

    grid_album_html = (
        '<html><head><title>Ketecc Idol Album - Facebook</title></head><body>'
        '<script>'
        '{"DTSGInitialData":{"token":"dtsg_grid_secret_token"}}'
        '</script>'
        '<script>'
        '{"grid_media":{"edges":['
        '{"node":{"__typename":"Photo","id":"501","viewer_image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/photo501.jpg","width":2048,"height":2048}}},'
        '{"node":{"__typename":"Photo","id":"502","viewer_image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/photo502.jpg","width":2048,"height":2048}}}'
        '],"page_info":{"end_cursor":"grid_cursor_page_1","has_next_page":true}},"id":"480509343424848"}'
        '</script></body></html>'
    )

    graphql_grid_page_2 = {
        "data": {
            "node": {
                "grid_media": {
                    "edges": [
                        {"node": {"__typename": "Photo", "id": "503", "viewer_image": {"uri": "https://scontent.xx.fbcdn.net/photo503.jpg", "width": 2048, "height": 2048}}},
                        {"node": {"__typename": "Photo", "id": "504", "viewer_image": {"uri": "https://scontent.xx.fbcdn.net/photo504.jpg", "width": 2048, "height": 2048}}},
                    ],
                    "page_info": {
                        "end_cursor": "grid_cursor_page_2",
                        "has_next_page": False,
                    },
                }
            }
        }
    }

    class _MockGridSession:
        def __init__(self):
            self.cookies = type("MockCookies", (), {"set": lambda *args, **kwargs: None})()
            self.headers = {}
            self.graphql_calls = []

        def get(self, url, **kwargs):
            class _Resp:
                def __init__(self, text, resp_url):
                    self.status_code = 200
                    self.text = text
                    self.url = resp_url
            return _Resp(grid_album_html, url)

        def post(self, url, **kwargs):
            self.graphql_calls.append((url, kwargs.get("data", {})))
            class _GqlResp:
                status_code = 200
                def json(self):
                    return graphql_grid_page_2
            return _GqlResp()

    grid_session_inst = _MockGridSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: grid_session_inst)

    # Calling with guest browser or no logged-in cookies
    manifest = facebook_capture.fetch_facebook_manifest(
        "https://www.facebook.com/media/set/?set=a.480509343424848&type=3",
        browser="guest",
    )
    assert manifest is not None
    assert manifest["title"] == "Ketecc Idol Album"
    assert len(manifest["photos"]) == 4
    assert [p["id"] for p in manifest["photos"]] == ["501", "502", "503", "504"]
    assert all(p["width"] == 2048 for p in manifest["photos"])
    assert len(grid_session_inst.graphql_calls) == 1
    gql_url, gql_payload = grid_session_inst.graphql_calls[0]
    assert "api/graphql" in gql_url
    assert gql_payload["doc_id"] == "34407011978913359"
    assert gql_payload["fb_api_req_friendly_name"] == "ProfileCometLegacyAlbumGridViewPaginationQuery"
    assert "grid_cursor_page_1" in gql_payload["variables"]
    assert "480509343424848" in gql_payload["variables"]


def test_manifest_concurrent_downloads_preserves_order_and_naming(tmp_path, monkeypatch):
    session = _Session()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    photos_list = [
        {"id": str(100000 + i), "url": f"https://scontent.xx.fbcdn.net/photo_{i:03d}.jpg", "width": 1080}
        for i in range(1, 13)
    ]
    manifest = {
        "title": "Concurrent Album",
        "photos": photos_list,
    }

    result = facebook_capture.download_facebook_photo_manifest(
        manifest,
        str(tmp_path),
        max_workers=4,
    )

    album_dir = tmp_path / "Concurrent Album"
    assert result["photo_count"] == 12
    saved = sorted(album_dir.glob("*.jpg"))
    assert len(saved) == 12
    for i, path in enumerate(saved, start=1):
        assert path.name == f"Concurrent Album_{i:03d}.jpg"
        with Image.open(path) as img:
            assert img.size == (8, 8)

def test_resolve_facebook_share_url_returns_redirect_target(monkeypatch):
    class _MockSession:
        def __init__(self):
            self.headers = {}

        def get(self, url, headers=None, allow_redirects=False, timeout=None):
            class _Resp:
                status_code = 302
                headers = {"Location": "https://www.facebook.com/permalink.php?story_fbid=pfbid123&id=456"}
            return _Resp()

    session = _MockSession()
    resolved = facebook_capture.resolve_facebook_share_url("https://www.facebook.com/share/p/1FfgatjfC9/", session=session)
    assert resolved == "https://www.facebook.com/permalink.php?story_fbid=pfbid123&id=456"


def test_fetch_facebook_manifest_single_photo_post(monkeypatch):
    single_photo_html = (
        '<!doctype html><html><head>'
        '<title>Single Photo Post Title</title>'
        '<meta property="og:title" content="Single Photo Post Title">'
        '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/t39.30808-6/sample_photo.jpg?_nc_cat=100&cstp=mx1040x2048">'
        '</head><body>'
        '<script type="application/json">{"attachment":{"media":{"__typename":"Photo","id":"987654321","image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/v\\/t39.30808-6\\/sample_photo.jpg?_nc_cat=100&cstp=mx1040x2048","width":1040,"height":2048}}}}</script>'
        '</body></html>'
    )

    class _MockSinglePhotoSession:
        def __init__(self):
            self.headers = {}
            self.cookies = type("MockCookies", (), {"set": lambda *args, **kwargs: None})()

        def get(self, url, **kwargs):
            class _Resp:
                status_code = 200
                text = single_photo_html
                url = "https://www.facebook.com/permalink.php?story_fbid=pfbid123&id=456"
            return _Resp()

    session = _MockSinglePhotoSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    manifest = facebook_capture.fetch_facebook_manifest(
        "https://www.facebook.com/permalink.php?story_fbid=pfbid123&id=456",
        browser="guest",
    )
    assert manifest is not None
    assert manifest["title"] == "Single Photo Post Title"
    assert len(manifest["photos"]) == 1
    photo = manifest["photos"][0]
    assert photo["id"] == "987654321"
    assert "sample_photo.jpg" in photo["url"]
    assert photo["width"] >= 1040



def test_is_facebook_post_url_photostream():
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/profile.php?id=61557058889808&sk=photos_by")
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/people/user/61557058889808/?sk=photos_by")
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/user/photos_by")
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/user/photos")
    assert facebook_capture.is_facebook_post_url("https://www.facebook.com/user/photos_all")


def test_resolve_facebook_canonical_url_profile(monkeypatch):
    class _MockSession:
        def __init__(self):
            self.headers = {}

        def get(self, url, headers=None, allow_redirects=False, timeout=None):
            class _Resp:
                status_code = 301
                headers = {"Location": "https://www.facebook.com/people/artist/61557058889808/?sk=photos_by"}
            return _Resp()

    session = _MockSession()
    resolved = facebook_capture.resolve_facebook_canonical_url(
        "https://www.facebook.com/profile.php?id=61557058889808&sk=photos_by",
        session=session,
    )
    assert resolved == "https://www.facebook.com/people/artist/61557058889808/?sk=photos_by"


def test_fetch_facebook_manifest_profile_photostream(monkeypatch):
    photostream_html = (
        '<!doctype html><html><head>'
        '<title>Profile Photostream Title - Facebook</title>'
        '<meta property="og:title" content="Profile Photostream Title">'
        '</head><body>'
        '<script type="application/json">{"require":[["ScheduledServerJS","handle",null,[{"__typename":"Photo","id":"111222333","viewer_image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/v\\/t39.30808-6\\/scattered_1.jpg","width":1166,"height":1166}}]]}</script>'
        '<script type="application/json">{"require":[["ScheduledServerJS","handle",null,[{"__typename":"Photo","id":"444555666","viewer_image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/v\\/t39.30808-6\\/scattered_2.jpg","width":1170,"height":1170}}]]}</script>'
        '</body></html>'
    )

    class _MockPhotostreamSession:
        def __init__(self):
            self.headers = {}
            self.cookies = type("MockCookies", (), {"set": lambda *args, **kwargs: None})()

        def get(self, url, **kwargs):
            class _Resp:
                status_code = 200
                text = photostream_html
                url = "https://www.facebook.com/people/artist/61557058889808/?sk=photos_by"
            return _Resp()

    session = _MockPhotostreamSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    manifest = facebook_capture.fetch_facebook_manifest(
        "https://www.facebook.com/profile.php?id=61557058889808&sk=photos_by",
        browser="guest",
    )
    assert manifest is not None
    assert manifest["title"] == "Profile Photostream Title"
    assert len(manifest["photos"]) == 2
    photo_ids = [p["id"] for p in manifest["photos"]]
    assert "111222333" in photo_ids
    assert "444555666" in photo_ids


def test_fetch_facebook_manifest_reel_video_skips_og_image_thumbnail(monkeypatch):
    reel_html = (
        '<!doctype html><html><head>'
        '<title>Video Title | Facebook</title>'
        '<meta property="og:type" content="video.other" />'
        '<meta property="og:url" content="https://www.facebook.com/12345/videos/demo/1157651770295012/" />'
        '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/t15.5256-10/904746082_2611740956011353_4437720304501399706_n.jpg?_nc_cat=108" />'
        '</head><body></body></html>'
    )

    class _MockReelSession:
        def __init__(self):
            self.headers = {}
            self.cookies = type("MockCookies", (), {"set": lambda *args, **kwargs: None})()

        def get(self, url, headers=None, **kwargs):
            if headers and headers.get("User-Agent") == "facebookexternalhit/1.1" and kwargs.get("allow_redirects") is False:
                class _RedirectResp:
                    status_code = 302
                    headers = {"Location": "https://www.facebook.com/reel/1157651770295012?share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fv%2F1DuAvWDUy7%2F"}
                return _RedirectResp()
            if not headers or headers.get("User-Agent") != "facebookexternalhit/1.1":
                class _FailResp:
                    status_code = 400
                    text = ""
                    url = "https://www.facebook.com/reel/1157651770295012"
                return _FailResp()

            class _Resp:
                status_code = 200
                text = reel_html
                url = "https://www.facebook.com/reel/1157651770295012"
            return _Resp()

    session = _MockReelSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    manifest = facebook_capture.fetch_facebook_manifest(
        "https://www.facebook.com/share/v/1DuAvWDUy7/",
        browser="guest",
    )
    assert manifest is not None
    assert manifest["media_kind"] == "video"
    assert manifest["photos"] == []


def test_fetch_facebook_manifest_video_attachment_not_treated_as_photo(monkeypatch):
    video_post_html = (
        '<!doctype html><html><head>'
        '<title>Video Post Title</title>'
        '<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/t15.5256-10/thumb.jpg" />'
        '</head><body>'
        '<script type="application/json">{"attachment":{"media":{"__typename":"Video","is_playable":true,"id":"987654321","image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/v\\/t15.5256-10\\/thumb.jpg","width":1080,"height":1920}}}}</script>'
        '</body></html>'
    )

    class _MockVideoPostSession:
        def __init__(self):
            self.headers = {}
            self.cookies = type("MockCookies", (), {"set": lambda *args, **kwargs: None})()

        def get(self, url, **kwargs):
            class _Resp:
                status_code = 200
                text = video_post_html
                url = "https://www.facebook.com/permalink.php?story_fbid=pfbid123&id=456"
            return _Resp()

    session = _MockVideoPostSession()
    monkeypatch.setattr(facebook_capture.requests, "Session", lambda: session)

    manifest = facebook_capture.fetch_facebook_manifest(
        "https://www.facebook.com/permalink.php?story_fbid=pfbid123&id=456",
        browser="guest",
    )
    assert manifest is not None
    assert manifest["media_kind"] == "video"
    assert manifest["photos"] == []


def test_process_conversion_skips_facebook_photo_manifest_for_video_and_audio_targets(monkeypatch, tmp_path):
    from janeconverter import cli

    called = {"fb": 0, "stream": []}

    def _fail_if_called(*args, **kwargs):
        called["fb"] += 1
        raise AssertionError("fetch_facebook_manifest should not run for explicit video/audio targets")

    monkeypatch.setattr(cli, "fetch_facebook_manifest", _fail_if_called)
    monkeypatch.setattr(cli, "ensure_free_disk_space", lambda *args, **kwargs: None)

    def _fake_fetch_media_stream(*args, **kwargs):
        called["stream"].append(
            {
                "source": kwargs.get("source"),
                "audio_only": kwargs.get("audio_only"),
                "target_format": kwargs.get("target_format"),
            }
        )
        raise RuntimeError("reached stream extractor")

    monkeypatch.setattr(cli, "fetch_media_stream", _fake_fetch_media_stream)

    for fmt, cat in [("mp4", "Video"), ("mp3", "Audio"), ("source", "Video")]:
        with pytest.raises(RuntimeError, match="reached stream extractor"):
            cli.process_conversion(
                source="https://www.facebook.com/share/p/video-post/",
                output_dir=str(tmp_path),
                target_format=fmt,
                content_category=cat,
            )

    assert called["fb"] == 0
    assert called["stream"] == [
        {"source": "https://www.facebook.com/share/p/video-post/", "audio_only": False, "target_format": "mp4"},
        {"source": "https://www.facebook.com/share/p/video-post/", "audio_only": True, "target_format": "mp3"},
        {"source": "https://www.facebook.com/share/p/video-post/", "audio_only": False, "target_format": "source"},
    ]


def test_fetch_facebook_manifest_parallel_http_viewer_walker(monkeypatch):
    post_html = (
        '<html><head><title>Album Post - Facebook</title></head><body>'
        '<script>'
        '{"mediaset_token":"pcb.2156692884932580",'
        '"all_subattachments":{"count":4,"nodes":['
        '{"media":{"__typename":"Photo","id":"100001"}},'
        '{"media":{"__typename":"Photo","id":"100002"}}'
        ']}}'
        '</script></body></html>'
    )
    viewer_pages = {
        "100001": (
            '<script>{"currMedia":{"__typename":"Photo","id":"100001",'
            '"image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/p1.jpg","width":1080,"height":1080}},'
            '"nextMediaAfterNodeId":{"__typename":"Photo","id":"100002"}}</script>',
            "https://www.facebook.com/photo/?fbid=100001&set=pcb.2156692884932580",
        ),
        "100002": (
            '<script>{"currMedia":{"__typename":"Photo","id":"100002",'
            '"image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/p2.jpg","width":1080,"height":1080}},'
            '"nextMediaAfterNodeId":{"__typename":"Photo","id":"100003"}}</script>',
            "https://www.facebook.com/photo/?fbid=100002&set=pcb.2156692884932580",
        ),
        "100003": (
            '<script>{"currMedia":{"__typename":"Photo","id":"100003",'
            '"image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/p3.jpg","width":1080,"height":1080}},'
            '"nextMediaAfterNodeId":{"__typename":"Photo","id":"100004"}}</script>',
            "https://www.facebook.com/photo/?fbid=100003&set=pcb.2156692884932580",
        ),
        "100004": (
            '<script>{"currMedia":{"__typename":"Photo","id":"100004",'
            '"image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/p4.jpg","width":1080,"height":1080}}}</script>',
            "https://www.facebook.com/photo/?fbid=100004&set=pcb.2156692884932580",
        ),
    }

    class _MockSession:
        def __init__(self):
            self.headers = {}
            self.requested = []

        def get(self, url, **kwargs):
            self.requested.append(url)
            class _Resp:
                def __init__(self, text, resp_url):
                    self.status_code = 200
                    self.text = text
                    self.url = resp_url
            if "/media/set/" in url:
                raise AssertionError("guest post walk should skip wasted /media/set/?set=pcb. request")
            for pid, (html_body, resp_url) in viewer_pages.items():
                if f"fbid={pid}" in url:
                    return _Resp(html_body, resp_url)
            return _Resp(post_html, "https://www.facebook.com/groups/1/permalink/2156692884932580/")

    monkeypatch.setattr(facebook_capture.requests, "Session", _MockSession)
    progress_updates = []
    manifest = facebook_capture.fetch_facebook_manifest(
        "https://www.facebook.com/groups/1/permalink/2156692884932580/",
        browser="guest",
        progress_callback=lambda pct, msg: progress_updates.append((pct, msg)),
    )
    assert manifest is not None
    assert manifest["complete"] is True
    assert manifest["expected_count"] == 4
    assert [p["id"] for p in manifest["photos"]] == ["100001", "100002", "100003", "100004"]
    assert any("Found 4 of 4" in msg for _, msg in progress_updates)


def test_fetch_facebook_manifest_incomplete_viewer_walk_marks_incomplete(monkeypatch):
    post_html = (
        '<html><head><title>Album Post - Facebook</title></head><body>'
        '<script>'
        '{"mediaset_token":"pcb.555666",'
        '"all_subattachments":{"count":4,"nodes":['
        '{"media":{"__typename":"Photo","id":"200001"}},'
        '{"media":{"__typename":"Photo","id":"200002"}}'
        ']}}'
        '</script></body></html>'
    )

    class _MockSession:
        def __init__(self):
            self.headers = {}

        def get(self, url, **kwargs):
            class _Resp:
                def __init__(self, text, resp_url):
                    self.status_code = 200
                    self.text = text
                    self.url = resp_url
            if "fbid=200001" in url:
                return _Resp(
                    '<script>{"id":"200001","image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/p1.jpg","width":1080},"nextMediaAfterNodeId":{"__typename":"Photo","id":"200002"}}</script>',
                    url,
                )
            if "fbid=200002" in url:
                return _Resp(
                    '<script>{"id":"200002","image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/p2.jpg","width":1080},"nextMediaAfterNodeId":{"__typename":"Photo","id":"200003"}}</script>',
                    url,
                )
            if "fbid=200003" in url:
                return _Resp("<html>Log in</html>", "https://www.facebook.com/login/")
            return _Resp(post_html, "https://www.facebook.com/groups/1/permalink/555666/")

    monkeypatch.setattr(facebook_capture.requests, "Session", _MockSession)
    manifest = facebook_capture.fetch_facebook_manifest(
        "https://www.facebook.com/groups/1/permalink/555666/",
        browser="guest",
    )
    assert manifest is not None
    assert manifest["complete"] is False
    assert manifest["expected_count"] == 4


def test_fetch_facebook_manifest_single_photo_permalink_ignores_page_album_set(monkeypatch):
    post_html = (
        '<html><head><title>Single Page Photo - Facebook</title></head><body>'
        '<a href="https://www.facebook.com/photo/?fbid=1463914419286187&amp;set=a.1400784518932511">photo</a>'
        '<a href="https://www.facebook.com/photo.php?fbid=3274205172919118&amp;set=p.3274205172919118&amp;comment_id=99">comment</a>'
        '</body></html>'
    )

    class _MockSession:
        def __init__(self):
            self.headers = {}
            self.urls = []

        def get(self, url, **kwargs):
            self.urls.append(url)
            class _Resp:
                def __init__(self, text, resp_url):
                    self.status_code = 200
                    self.text = text
                    self.url = resp_url
            if "fbid=1463914419286187" in url:
                assert "set=a." not in url
                return _Resp(
                    '<script>{"currMedia":{"__typename":"Photo","id":"1463914419286187","image":{"uri":"https:\\/\\/scontent.xx.fbcdn.net\\/main.jpg","width":1529}}}</script>',
                    url,
                )
            return _Resp(post_html, "https://www.facebook.com/permalink.php?story_fbid=123&id=456")

    monkeypatch.setattr(facebook_capture.requests, "Session", _MockSession)
    manifest = facebook_capture.fetch_facebook_manifest(
        "https://www.facebook.com/permalink.php?story_fbid=123&id=456",
        browser="guest",
    )
    assert manifest is not None
    assert manifest["complete"] is True
    assert [p["id"] for p in manifest["photos"]] == ["1463914419286187"]


def test_cli_facebook_guest_probe_emits_progress_and_json(monkeypatch, capsys):
    import json
    import sys
    from janeconverter import cli

    def _fake_fetch(url, browser=None, progress_callback=None, **_kwargs):
        assert browser == "guest"
        if progress_callback:
            progress_callback(0.14, "Found 1 of 1 public Facebook photos...")
        return {
            "platform": "facebook",
            "title": "Probe Post",
            "media_kind": "photo",
            "complete": True,
            "photos": [{"id": "123456", "url": "https://scontent.xx.fbcdn.net/p1.jpg", "width": 1080, "alternates": []}],
        }

    monkeypatch.setattr(cli, "fetch_facebook_manifest", _fake_fetch)
    monkeypatch.setattr(sys, "argv", ["janeconverter", "--facebook-guest-probe", "https://www.facebook.com/share/p/abc/"])
    cli.main()
    captured = capsys.readouterr()
    assert "__JANE_CAPTURE_PROGRESS__\t0.1400\tFound 1 of 1 public Facebook photos..." in captured.err
    payload = json.loads(captured.out)
    assert payload["ok"] is True
    assert payload["media_kind"] == "photo"
    assert len(payload["photos"]) == 1
