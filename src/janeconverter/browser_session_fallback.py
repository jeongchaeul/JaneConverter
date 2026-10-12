"""Automatic, temporary yt-dlp authentication after a public sign-in failure."""
from urllib.parse import urlparse

from .auth import detect_default_browser_session, normalize_browser_session, yt_dlp_cookie_option
from .cookie_unlocker import patch_yt_dlp_cookie_database_reader
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
        "locked behind the login page", "this content isn't available", "not available, facebook said",
        "you must log in",
        "premium", "vip", "login to view",
    ))


class _PrivateLogger:
    # yt-dlp can log browser paths and request headers in diagnostics.
    def debug(self, _message): pass
    def warning(self, _message): pass
    def error(self, _message): pass


def extract_with_browser_fallback(ydl, options, query, download, browser=None,
                                  abort_event=None, report=None, deadline=None):
    patch_yt_dlp_cookie_database_reader()
    try:
        return extract_with_recovery(ydl, query, download, abort_event, report, deadline)
    except Exception as public_error:
        domains = session_domains(query)
        if not domains or not needs_browser_session(public_error):
            raise
        if abort_event and abort_event.is_set():
            raise KeyboardInterrupt("Stream extraction aborted by user.")

        target_browser = normalize_browser_session(browser) or detect_default_browser_session()
        if not target_browser:
            raise BrowserSessionError(
                "This source requires sign-in, but JaneConverter could not identify a supported default browser."
            ) from None

        opts = dict(options)
        opts.pop("extractor_args", None)
        opts.pop("cookiefile", None)
        opts.update(cookiesfrombrowser=yt_dlp_cookie_option(target_browser),
                    logger=_PrivateLogger(), verbose=False, cachedir=False,
                    quiet=True, no_warnings=True, noprogress=True)
        if "js_runtimes" not in opts or not opts["js_runtimes"] or opts["js_runtimes"].get("node", {}).get("path") is None:
            try:
                from .converter import get_js_runtimes_config
                opts["js_runtimes"] = get_js_runtimes_config()
            except ImportError:
                pass

        if report:
            report(0.15, f"Sign-in required. Temporarily using your {target_browser.title()} session to retry.", force=True)

        jar = None
        authenticated = None
        try:
            import yt_dlp
            with yt_dlp.YoutubeDL(opts) as authenticated:
                jar = getattr(authenticated, "_cookiejar", None) or authenticated.cookiejar
                if jar is not None:
                    for cookie in list(jar):
                        raw_domain = getattr(cookie, "domain", None) or ""
                        host = raw_domain.lstrip(".").lower()
                        if not host or not any(host == root or host.endswith("." + root) for root in domains):
                            jar.clear(getattr(cookie, "domain", None), getattr(cookie, "path", None), getattr(cookie, "name", None))
                        else:
                            cookie.secure = True
                if not jar or not len(jar):
                    raise BrowserSessionError(
                        f"No usable session for this site was found in {target_browser.title()}. Sign in there, then retry."
                    )
                if abort_event and abort_event.is_set():
                    raise KeyboardInterrupt("Stream extraction aborted by user.")

                return extract_with_recovery(authenticated, query, download, abort_event, report, deadline)
        except KeyboardInterrupt:
            raise
        except BrowserSessionError:
            raise
        except Exception as error:
            message = str(error).casefold()
            if any(word in message for word in ("cookie database", "decrypt", "dpapi", "keyring", "extract cookies", "cookies from", "load cookies")):
                detail = f"yt-dlp could not read the {target_browser.title()} session. The browser may be locked or its cookie encryption unsupported. Close it and retry."
            else:
                detail = f"Automatic browser-session retry did not succeed. Check that the source plays in {target_browser.title()}, then retry."
            raise BrowserSessionError(detail) from None
        finally:
            if jar is not None:
                try:
                    jar.clear()
                except Exception:
                    pass
            if authenticated is not None:
                try:
                    auth_jar = getattr(authenticated, "_cookiejar", None)
                    if auth_jar is not None:
                        auth_jar.clear()
                except Exception:
                    pass
