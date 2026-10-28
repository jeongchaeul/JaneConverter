"""Automatic, temporary yt-dlp authentication after a public sign-in failure."""
from urllib.parse import urlparse

from .auth import (
    detect_default_browser_session,
    detect_installed_browser_sessions,
    detect_running_browsers,
    normalize_browser_session,
    yt_dlp_cookie_option,
)
from .cookie_unlocker import patch_yt_dlp_cookie_database_reader
from .instagram_patch import patch_instagram_story_extractor
from .facebook_patch import patch_facebook_story_extractor
from .extraction_recovery import extract_with_recovery


class BrowserSessionError(RuntimeError):
    """A browser session cannot help without changing the user's environment."""


# Known major platform domain groups for session isolation
PLATFORMS = (
    (("youtube.com", "youtu.be", "music.youtube.com"), ("youtube.com", "google.com")),
    (("facebook.com", "fb.watch"), ("facebook.com",)),
    (("instagram.com", "instagr.am"), ("instagram.com",)),
    (("x.com", "twitter.com", "t.co"), ("x.com", "twitter.com")),
    (("tiktok.com",), ("tiktok.com",)),
    (("reddit.com", "redd.it"), ("reddit.com",)),
    (("vimeo.com",), ("vimeo.com",)),
    (("streamable.com",), ("streamable.com",)),
    (("soundcloud.com",), ("soundcloud.com",)),
    (("twitch.tv",), ("twitch.tv",)),
    (("dailymotion.com", "dai.ly"), ("dailymotion.com",)),
    (("rumble.com",), ("rumble.com",)),
    (("pinterest.com", "pin.it"), ("pinterest.com",)),
    (("bilibili.com", "b23.tv"), ("bilibili.com",)),
    (("bandcamp.com",), ("bandcamp.com",)),
    (("patreon.com",), ("patreon.com",)),
    (("substack.com",), ("substack.com",)),
    (("nicovideo.jp", "nico.ms"), ("nicovideo.jp",)),
    (("naver.com",), ("naver.com",)),
    (("weverse.io",), ("weverse.io",)),
    (("threads.net",), ("threads.net",)),
    (("bsky.app",), ("bsky.app",)),
    (("spotify.com",), ("spotify.com",)),
    (("apple.com",), ("apple.com",)),
    (("mixcloud.com",), ("mixcloud.com",)),
    (("odysee.com",), ("odysee.com",)),
    (("vk.com",), ("vk.com",)),
)


def session_domains(source):
    try:
        s = str(source or "").strip()
        if s.startswith("ytsearch"):
            return ("youtube.com", "google.com")
        if s.startswith("scsearch"):
            return ("soundcloud.com",)
        parsed = urlparse(s)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            return ()
        for hosts, domains in PLATFORMS:
            if any(host == root or host.endswith("." + root) for root in hosts):
                return domains
    except (TypeError, ValueError):
        pass
    return ()


def needs_browser_session(error):
    message = str(error).casefold()
    if any(word in message for word in ("drm", "geo-restricted", "geo restricted", "not available in your country", "removed", "deleted")):
        return False
    return any(word in message for word in (
        "sign in", "login required", "log in", "age-restricted", "use --cookies", "cookies are required",
        "unexpected response from webpage request", "unable to extract challenge data", "unable to solve js challenge",
        "error code: 152", "code: 152", "152 - 18", "watch video on youtube", "confirm your age", "the page needs to be reloaded",
        "confirm you're not a bot", "not a bot", "bot detection", "use --cookies-from-browser",
        "members-only", "members only", "join this channel", "channel members",
        "private video", "this video is private", "video is private",
        "subscribers only", "subscriber-only", "subscription required",
        "account required", "you must be logged in", "requires login", "requires authentication",
        "401: unauthorized", "unauthorized", "captcha", "cf-turnstile", "cloudflare", "just a moment",
        "cannot parse data", "cannot parse json", "unable to extract", "this content is unreachable",
        "locked behind the login page", "this content isn't available", "this content is not available",
        "not available, facebook said", "you must log in",
        "premium", "vip", "login to view",
        "rate limit", "rate-limit", "too many requests", "429",
        "http error 404", "404: not found", "access denied", "permission denied",
        "restricted", "blocked",
    ))


class _PrivateLogger:
    # yt-dlp can log browser paths and request headers in diagnostics.
    def debug(self, _message): pass
    def warning(self, _message): pass
    def error(self, _message): pass


def extract_with_browser_fallback(ydl, options, query, download, browser=None,
                                  abort_event=None, report=None, deadline=None,
                                  allow_cookies=True):
    patch_yt_dlp_cookie_database_reader()
    patch_instagram_story_extractor()
    patch_facebook_story_extractor()
    try:
        return extract_with_recovery(ydl, query, download, abort_event, report, deadline)
    except Exception as public_error:
        domains = session_domains(query)
        if not domains or not needs_browser_session(public_error):
            raise
        if abort_event and abort_event.is_set():
            raise KeyboardInterrupt("Stream extraction aborted by user.")

        raw_browser = str(browser or "").strip().lower()
        if not allow_cookies or raw_browser in ("none", "disabled", "off", "false", "public", "public only"):
            raise BrowserSessionError(
                "This source requires sign-in or active session cookies, but 'Read Browser Cookies' is currently disabled in Settings. "
                "Enable it in Settings to allow JaneConverter to use your local browser session, or use the Browser Extension."
            ) from None

        target_browser = normalize_browser_session(browser)
        if target_browser and target_browser not in ("auto", "none"):
            candidate_browsers = [target_browser]
        else:
            default_b = detect_default_browser_session()
            if not default_b:
                raise BrowserSessionError(
                    "This source requires sign-in, but JaneConverter could not identify a supported default browser on your system."
                ) from None
            candidate_browsers = [default_b]
            for b in detect_running_browsers():
                if b not in candidate_browsers:
                    candidate_browsers.append(b)
            for b in detect_installed_browser_sessions():
                if b not in candidate_browsers:
                    candidate_browsers.append(b)

        last_error = None
        tried_browsers = []

        for b in candidate_browsers:
            opts = dict(options)
            opts.pop("extractor_args", None)
            opts.pop("cookiefile", None)
            opts.update(cookiesfrombrowser=yt_dlp_cookie_option(b),
                        logger=_PrivateLogger(), verbose=False, cachedir=False,
                        quiet=True, no_warnings=True, noprogress=True)
            if "js_runtimes" not in opts or not opts["js_runtimes"] or opts["js_runtimes"].get("node", {}).get("path") is None:
                try:
                    from .converter import get_js_runtimes_config
                    opts["js_runtimes"] = get_js_runtimes_config()
                except ImportError:
                    pass

            jar = None
            authenticated = None
            try:
                import yt_dlp
                with yt_dlp.YoutubeDL(opts) as authenticated:
                    jar = getattr(authenticated, "_cookiejar", None) or authenticated.cookiejar
                    matching_count = 0
                    if jar is not None:
                        for cookie in list(jar):
                            raw_domain = getattr(cookie, "domain", None) or ""
                            host = raw_domain.lstrip(".").lower()
                            if not host or not any(host == root or host.endswith("." + root) for root in domains):
                                jar.clear(getattr(cookie, "domain", None), getattr(cookie, "path", None), getattr(cookie, "name", None))
                            else:
                                cookie.secure = True
                                matching_count += 1

                    if not jar or matching_count == 0:
                        # No usable session for this site in this browser, try next candidate
                        continue

                    tried_browsers.append(b)
                    if report:
                        report(0.15, f"Sign-in required. Using your {b.title()} session to retry.", force=True)

                    if abort_event and abort_event.is_set():
                        raise KeyboardInterrupt("Stream extraction aborted by user.")

                    try:
                        return extract_with_recovery(authenticated, query, download, abort_event, report, deadline)
                    except Exception as extract_err:
                        message = str(extract_err).casefold()
                        if "drm" in message or "geo-restricted" in message:
                            raise
                        detail = f"Automatic browser-session retry did not succeed. Check that the source plays in {b.title()}, then retry."
                        if browser == "auto":
                            last_error = BrowserSessionError(detail)
                            continue
                        raise BrowserSessionError(detail) from None

            except KeyboardInterrupt:
                raise
            except BrowserSessionError:
                if browser == "auto":
                    continue
                raise
            except Exception as error:
                last_error = error
                message = str(error).casefold()
                if any(word in message for word in ("cookie database", "decrypt", "dpapi", "keyring", "extract cookies", "cookies from", "load cookies")):
                    detail = f"yt-dlp could not read the {b.title()} session. The browser may be locked or its cookie encryption unsupported. Close it and retry."
                    if browser == "auto":
                        last_error = BrowserSessionError(detail)
                        continue
                    raise BrowserSessionError(detail) from None
                continue
            finally:
                if jar is not None:
                    try:
                        jar.clear()
                    except (AttributeError, RuntimeError):
                        pass
                if authenticated is not None:
                    try:
                        auth_jar = getattr(authenticated, "_cookiejar", None)
                        if auth_jar is not None:
                            auth_jar.clear()
                    except (AttributeError, RuntimeError):
                        pass

        if tried_browsers:
            detail = f"Automatic browser-session retry did not succeed with {', '.join(b.title() for b in tried_browsers)}. Check that the source plays in your browser, then retry."
        else:
            detail = f"No usable session for this site was found in any detected browser ({', '.join(b.title() for b in candidate_browsers[:3])}). Sign in there, or use the Browser Extension."
        raise BrowserSessionError(detail) from last_error
