"""Automatic, temporary yt-dlp authentication after a public sign-in failure."""
from urllib.parse import urlparse

from .auth import detect_default_browser_session, normalize_browser_session, yt_dlp_cookie_option
from .extraction_recovery import extract_with_recovery


class BrowserSessionError(RuntimeError):
    """A browser session cannot help without changing the user's environment."""


# Credentials are never handed to a generic extractor or an arbitrary pasted URL.
PLATFORMS = (
    (("youtube.com", "youtu.be"), ("youtube.com",)),
    (("facebook.com", "fb.watch"), ("facebook.com",)),
    (("instagram.com",), ("instagram.com",)),
    (("x.com", "twitter.com", "t.co"), ("x.com", "twitter.com")),
    (("tiktok.com",), ("tiktok.com",)),
    (("reddit.com", "redd.it"), ("reddit.com",)),
    (("vimeo.com",), ("vimeo.com",)),
    (("soundcloud.com",), ("soundcloud.com",)),
    (("twitch.tv",), ("twitch.tv",)),
    (("dailymotion.com", "dai.ly"), ("dailymotion.com",)),
    (("rumble.com",), ("rumble.com",)),
    (("pinterest.com",), ("pinterest.com",)),
)


def session_domains(source):
    try:
        parsed = urlparse(source)
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
    # A request for authentication is required; ordinary 403s, DRM and removed
    # content must not trigger credential access.
    if any(word in message for word in ("drm", "geo-restricted", "geo restricted", "not available in your country", "removed", "deleted")):
        return False
    return any(word in message for word in (
        "sign in", "login required", "log in", "age-restricted", "use --cookies", "cookies are required",
        "unexpected response from webpage request", "unable to extract challenge data", "unable to solve js challenge",
        "error code: 152", "code: 152", "152 - 18", "watch video on youtube", "confirm your age", "the page needs to be reloaded",
    ))


class _PrivateLogger:
    # yt-dlp can log browser paths and request headers in diagnostics.
    def debug(self, _message): pass
    def warning(self, _message): pass
    def error(self, _message): pass


def extract_with_browser_fallback(ydl, options, query, download, browser=None,
                                  abort_event=None, report=None, deadline=None):
    try:
        return extract_with_recovery(ydl, query, download, abort_event, report, deadline)
    except Exception as public_error:
        domains = session_domains(query)
        if not domains or not needs_browser_session(public_error):
            raise
        if abort_event and abort_event.is_set():
            raise KeyboardInterrupt("Stream extraction aborted by user.")
        browser = normalize_browser_session(browser) if browser else detect_default_browser_session()
        if not browser:
            raise BrowserSessionError("This source requires sign-in, but JaneConverter could not identify a supported default browser.") from None
        options = dict(options)
        # Keep browser sessions away from pinned anonymous clients and prevent
        # caller options from writing an exported cookie file or debug headers.
        options.pop("extractor_args", None)
        options.pop("cookiefile", None)
        options.update(cookiesfrombrowser=yt_dlp_cookie_option(browser),
                       logger=_PrivateLogger(), verbose=False, cachedir=False,
                       quiet=True, no_warnings=True, noprogress=True)
        if "js_runtimes" not in options or not options["js_runtimes"] or options["js_runtimes"].get("node", {}).get("path") is None:
            try:
                from .converter import get_js_runtimes_config
                options["js_runtimes"] = get_js_runtimes_config()
            except ImportError:
                pass
        if report:
            report(0.15, f"Sign-in required. Temporarily using your {browser.title()} session to retry.", force=True)
        jar = None
        authenticated = None
        try:
            import yt_dlp
            with yt_dlp.YoutubeDL(options) as authenticated:
                # yt-dlp itself reads/decrypts the browser database. Its native
                # temporary database copy is cleaned by its context manager.
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
                    raise BrowserSessionError(f"No usable session for this site was found in {browser.title()}. Sign in there, then retry.")
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
                detail = f"yt-dlp could not read the {browser.title()} session. The browser may be locked or its cookie encryption unsupported. Close it and retry."
            else:
                detail = f"Automatic browser-session retry did not succeed. Check that the source plays in {browser.title()}, then retry."
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
