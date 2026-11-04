"""Automatic, temporary yt-dlp authentication after a public sign-in failure."""
import threading
from urllib.parse import urlparse

from .auth import (
    filter_cookie_jar_for_domains,
    detect_browser_profiles,
    detect_default_browser_session,
    detect_installed_browser_sessions,
    detect_running_browsers,
    normalize_browser_session,
    yt_dlp_cookie_option,
)
from .paths import get_ytdlp_cache_dir
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


_COOKIE_EXTRACT_LOCK = threading.Lock()


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
            detected_profs = detect_browser_profiles(b)
            profile_list = detected_profs if detected_profs else [None]
            session_found = False
            for prof in profile_list:
                opts = dict(options)
                opts.pop("extractor_args", None)
                opts.pop("cookiefile", None)
                prof_arg = None if prof == "Default" else prof
                opts.update(cookiesfrombrowser=yt_dlp_cookie_option(b, prof_arg),
                            logger=_PrivateLogger(), verbose=False, cachedir=get_ytdlp_cache_dir(),
                            quiet=True, no_warnings=True, noprogress=True)
                if "js_runtimes" not in opts or not opts["js_runtimes"] or opts["js_runtimes"].get("node", {}).get("path") is None:
                    try:
                        from .converter import get_js_runtimes_config
                        opts["js_runtimes"] = get_js_runtimes_config()
                    except ImportError:
                        pass

                jar = None
                raw_jar = None
                authenticated = None
                try:
                    import yt_dlp
                    with _COOKIE_EXTRACT_LOCK:
                        authenticated = yt_dlp.YoutubeDL(opts)
                        raw_jar = getattr(authenticated, "_cookiejar", None) or authenticated.cookiejar
                        jar = filter_cookie_jar_for_domains(raw_jar, domains)
                        if hasattr(authenticated, "_cookiejar"):
                            authenticated._cookiejar = jar
                        if hasattr(authenticated, "cookiejar"):
                            authenticated.cookiejar = jar
                        matching_count = len(list(jar))

                    if not jar or matching_count == 0:
                        # No usable session for this profile, try next
                        if authenticated is not None:
                            try:
                                authenticated.close()
                            except Exception:
                                pass
                            authenticated = None
                        continue

                    session_found = True
                    b_label = f"{b.title()} ({prof})" if prof and prof != "Default" else b.title()
                    tried_browsers.append(b_label)
                    if report:
                        report(0.15, f"Sign-in required. Using your {b_label} session to retry.", force=True)

                    if abort_event and abort_event.is_set():
                        raise KeyboardInterrupt("Stream extraction aborted by user.")

                    with authenticated:
                        try:
                            return extract_with_recovery(authenticated, query, download, abort_event, report, deadline)
                        except Exception as extract_err:
                            message = str(extract_err).casefold()
                            if "drm" in message or "geo-restricted" in message or "music premium" in message or "premium members" in message or "members-only" in message:
                                raise
                            detail = f"Automatic browser-session retry did not succeed. Check that the source plays in {b_label}, then retry."
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
                        b_label = f"{b.title()} ({prof})" if prof and prof != "Default" else b.title()
                        detail = f"yt-dlp could not read the {b_label} session. The browser may be locked or its cookie encryption unsupported. Close it and retry."
                        if browser == "auto":
                            last_error = BrowserSessionError(detail)
                            continue
                        raise BrowserSessionError(detail) from None
                    continue
                finally:
                    if raw_jar is not None:
                        try:
                            raw_jar.clear()
                        except (AttributeError, RuntimeError):
                            pass
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
            if session_found:
                break

        if tried_browsers:
            detail = f"Automatic browser-session retry did not succeed with {', '.join(b.title() for b in tried_browsers)}. Check that the source plays in your browser, then retry."
        else:
            detail = f"No usable session for this site was found in any detected browser ({', '.join(b.title() for b in candidate_browsers[:3])}). Sign in there, or use the Browser Extension."
        raise BrowserSessionError(detail) from last_error
