"""Exercise automatic authentication with synthetic cookies, never real profiles."""
import http.cookiejar
import threading
from unittest.mock import Mock

import pytest
import yt_dlp
import yt_dlp.cookies

from janeconverter import browser_session_fallback as fallback
from janeconverter import cli, extractor


URL = "https://www.youtube.com/watch?v=synthetic"


def synthetic_jar():
    jar = yt_dlp.cookies.YoutubeDLCookieJar()
    for domain in (".youtube.com", ".example.test", ".youtube.com.evil.test"):
        jar.set_cookie(http.cookiejar.Cookie(
            0, "SID", "synthetic-value", None, False, domain, True, True,
            "/", True, False, None, True, None, None, {}, False,
        ))
    return jar


@pytest.fixture
def browser(monkeypatch):
    detected = Mock(return_value="firefox")
    loaded = Mock(side_effect=lambda *args, **kwargs: synthetic_jar())
    monkeypatch.setattr(fallback, "detect_default_browser_session", detected)
    monkeypatch.setattr(yt_dlp.cookies, "extract_cookies_from_browser", loaded)
    return detected, loaded


def test_sign_in_failure_uses_real_yt_dlp_cookie_option_then_clears_jar(browser, monkeypatch, capsys):
    public = Mock(params={})
    public.extract_info.side_effect = RuntimeError("Please sign in. Use --cookies-from-browser")
    jars = []

    def authenticated_extract(self, query, download):
        jars.append(self.cookiejar)
        assert query == URL and download
        assert [cookie.domain for cookie in self.cookiejar] == [".youtube.com"]
        assert all(cookie.secure for cookie in self.cookiejar)
        assert "cookiefile" not in self.params
        assert "extractor_args" not in self.params
        self.params["logger"].error("synthetic-value must not appear in logs")
        return {"id": "recovered"}

    monkeypatch.setattr(yt_dlp.YoutubeDL, "extract_info", authenticated_extract)
    result = fallback.extract_with_browser_fallback(public, {"cookiefile": "must-not-write", "extractor_args": {"youtube": {}}}, URL, True)
    assert result["id"] == "recovered"
    assert public.extract_info.call_count == 1
    assert browser[0].call_count == browser[1].call_count == 1
    assert browser[1].call_args.args[0] == "firefox"
    assert all(len(jar) == 0 for jar in jars)
    captured = capsys.readouterr()
    assert "synthetic-value" not in captured.out + captured.err


@pytest.mark.parametrize("query,message", [
    ("https://example.test/private", "Please sign in"),
    ("https://youtube.com.evil.test/", "Please sign in"),
    ("http://youtube.com/", "Please sign in"),
    ("https://user@youtube.com/", "Please sign in"),
    ("https://youtube.com:8080/", "Please sign in"),
    ("ytsearch1:synthetic", "Please sign in"),
    (URL, "HTTP Error 403: Forbidden"),
    (URL, "DRM protected. Please sign in"),
    (URL, "Video deleted. Please sign in"),
    (URL, "Geo-restricted. Please sign in"),
])
def test_unrelated_urls_and_non_auth_failures_never_read_cookies(browser, query, message):
    public = Mock(params={})
    public.extract_info.side_effect = RuntimeError(message)
    with pytest.raises(RuntimeError):
        fallback.extract_with_browser_fallback(public, {}, query, True)
    browser[0].assert_not_called()
    browser[1].assert_not_called()


def test_successful_public_fetch_never_reads_cookies(browser):
    public = Mock(params={})
    public.extract_info.return_value = {"id": "public"}
    assert fallback.extract_with_browser_fallback(public, {}, URL, True)["id"] == "public"
    browser[0].assert_not_called()
    browser[1].assert_not_called()


def test_failed_authenticated_retry_is_terminal_and_does_not_leak_values(browser, monkeypatch):
    public = Mock(params={})
    public.extract_info.side_effect = RuntimeError("Please sign in")
    jars = []

    def refused(self, query, download):
        jars.append(self.cookiejar)
        raise RuntimeError("Please sign in: synthetic-value")

    monkeypatch.setattr(yt_dlp.YoutubeDL, "extract_info", refused)
    with pytest.raises(fallback.BrowserSessionError) as error:
        cli._retry_operation(lambda: fallback.extract_with_browser_fallback(public, {}, URL, True), "track", 2)
    assert "synthetic-value" not in str(error.value)
    assert browser[1].call_count == 1
    assert public.extract_info.call_count == 1
    assert all(len(jar) == 0 for jar in jars)


def test_cookie_database_failure_reports_reason_without_private_paths(browser, capsys):
    browser[1].side_effect = PermissionError("Could not copy cookie database C:/synthetic-private-profile")
    public = Mock(params={})
    public.extract_info.side_effect = RuntimeError("Please sign in")
    with pytest.raises(fallback.BrowserSessionError, match="locked or its cookie encryption") as error:
        fallback.extract_with_browser_fallback(public, {}, URL, True)
    assert "synthetic-private-profile" not in str(error.value)
    assert browser[1].call_count == 1
    captured = capsys.readouterr()
    assert "synthetic-private-profile" not in captured.out + captured.err


def test_cancellation_clears_loaded_credentials_before_any_authenticated_request(browser, monkeypatch):
    cancel = threading.Event()
    jars = []
    original_merge = yt_dlp.cookies._merge_cookie_jars
    def track_merge(inputs):
        jar = original_merge(inputs)
        jars.append(jar)
        return jar
    monkeypatch.setattr(yt_dlp.cookies, "_merge_cookie_jars", track_merge)
    def cancelled_load(*args, **kwargs):
        cancel.set()
        return synthetic_jar()
    browser[1].side_effect = cancelled_load
    public = Mock(params={})
    public.extract_info.side_effect = RuntimeError("Please sign in")
    authenticated = Mock()
    monkeypatch.setattr(yt_dlp.YoutubeDL, "extract_info", authenticated)
    with pytest.raises(KeyboardInterrupt):
        fallback.extract_with_browser_fallback(public, {}, URL, True, abort_event=cancel)
    authenticated.assert_not_called()
    assert all(len(jar) == 0 for jar in jars)


def test_missing_default_browser_does_not_scan_other_profiles(browser):
    browser[0].return_value = None
    public = Mock(params={})
    public.extract_info.side_effect = RuntimeError("Please sign in")
    with pytest.raises(fallback.BrowserSessionError, match="supported default browser"):
        fallback.extract_with_browser_fallback(public, {}, URL, True)
    browser[1].assert_not_called()


def test_converter_invokes_fallback_after_its_public_fetch_fails(browser, monkeypatch, tmp_path):
    output = tmp_path / "synthetic.mp3"
    calls = []
    def extract(self, query, download):
        calls.append(bool(self.params.get("cookiesfrombrowser")))
        if not calls[-1]:
            raise RuntimeError("Please sign in")
        assert len(self.cookiejar) == 1
        output.write_bytes(b"synthetic-media")
        return {"id": "synthetic", "title": "Synthetic", "ext": "mp3", "webpage_url": URL,
                "requested_downloads": [{"filepath": str(output)}]}
    monkeypatch.setattr(yt_dlp.YoutubeDL, "extract_info", extract)
    result = extractor.fetch_media_stream(URL, str(tmp_path), audio_only=True)
    assert result["media_path"] == str(output)
    assert calls == [False, True]


def test_terminal_access_failures_are_not_repeated_by_playlist_retry():
    operation = Mock(side_effect=RuntimeError("Please sign in"))
    with pytest.raises(RuntimeError):
        cli._retry_operation(operation, "track", 2)
    assert operation.call_count == 1


def test_no_site_cookies_produces_actionable_failure_without_an_auth_request(monkeypatch):
    monkeypatch.setattr(fallback, "detect_default_browser_session", lambda: "firefox")
    monkeypatch.setattr(yt_dlp.cookies, "extract_cookies_from_browser", lambda *a, **kw: yt_dlp.cookies.YoutubeDLCookieJar())
    public = Mock(params={})
    public.extract_info.side_effect = RuntimeError("Please sign in")
    with pytest.raises(fallback.BrowserSessionError, match="No usable session"):
        fallback.extract_with_browser_fallback(public, {}, "https://www.youtube.com/watch?v=synthetic", True)


def test_tiktok_challenge_triggers_browser_session_fallback():
    assert fallback.needs_browser_session("ERROR: [TikTok] Unexpected response from webpage request")
    assert fallback.needs_browser_session("ERROR: [TikTok] Unable to extract challenge data")
    assert fallback.needs_browser_session("ERROR: [TikTok] Unable to solve JS challenge")


def test_youtube_age_restricted_error_152_triggers_browser_session_fallback():
    assert fallback.needs_browser_session("ERROR: [youtube] aZwbwk4EDGE: This video is unavailable. Error code: 152 - 18 Watch video on YouTube")
    assert fallback.needs_browser_session("ERROR: [youtube] aZwbwk4EDGE: Sign in to confirm your age. Use --cookies-from-browser")
    assert fallback.needs_browser_session("ERROR: [youtube] aZwbwk4EDGE: The page needs to be reloaded.")

