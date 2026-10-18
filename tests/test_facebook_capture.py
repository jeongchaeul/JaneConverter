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
    assert session.requested[:2] == [
        "https://scontent-1.xx.fbcdn.net/high.jpg",
        "https://scontent-1.xx.fbcdn.net/low.jpg",
    ]


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
    assert session.requested[:3] == [
        "https://scontent-1.xx.fbcdn.net/high.jpg",
        "https://scontent-1.xx.fbcdn.net/low.jpg",
        "https://scontent-1.xx.fbcdn.net/123456-refreshed.jpg",
    ]


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




