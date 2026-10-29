"""
Universal Stream Extractor Module for JaneConverter
Fetches media from across the internet (YouTube, SoundCloud, TikTok, Twitter/X,
Facebook, Reddit, Vimeo, Twitch, adult sites, Spotify metadata matching, and Apple Music catalog matching) or local files.
"""

import os
import re
import shutil
import time
import unicodedata
import urllib.parse
from datetime import datetime
from typing import Optional, Dict, Any, Callable
import ipaddress
import socket
import json
import requests
import yt_dlp
from .catalog_match import choose_catalog_match, match_score
from .extraction_recovery import classify_extraction, ExtractionCategory
from .browser_session_fallback import extract_with_browser_fallback, BrowserSessionError
from .auth import (
    describe_authenticated_extraction_failure,
    normalize_browser_session,
    normalize_browser_error_message,
)
from .converter import get_js_runtimes_config
from .instagram_patch import patch_instagram_story_extractor
from .facebook_patch import patch_facebook_story_extractor

patch_instagram_story_extractor()
patch_facebook_story_extractor()


class _AuthenticatedYtdlpLogger:
    """Keep browser-session errors useful without exposing yt-dlp's Chrome label."""

    def __init__(self, progress_callback: Optional[Callable[[float, str], None]]):
        self.progress_callback = progress_callback
        self._seen_errors = set()

    def debug(self, _message: object):
        return None

    def info(self, _message: object):
        return None

    def warning(self, _message: object):
        return None

    def error(self, message: object):
        normalized = normalize_browser_error_message(message)
        if normalized in self._seen_errors:
            return None
        self._seen_errors.add(normalized)
        if self.progress_callback and normalized:
            self.progress_callback(0.15, normalized)
        return None


def is_url(path_or_url: str) -> bool:
    """Checks if input string is a valid HTTP/HTTPS URL."""
    if not isinstance(path_or_url, str):
        return False
    try:
        parsed = urllib.parse.urlparse(path_or_url.strip())
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False

def clean_windows_path(path: str) -> str:
    """Strip extended-length Windows verbatim prefixes (\\\\?\\) for standard Win32/Explorer compatibility."""
    if not isinstance(path, str):
        return ""
    trimmed = path.strip()
    if trimmed.startswith("\\\\?\\UNC\\"):
        return "\\\\" + trimmed[8:]
    if trimmed.startswith("\\\\?\\"):
        return trimmed[4:]
    return trimmed


WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

_UNICODE_BIDI_AND_FORMAT_RE = re.compile(
    r"[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\u061c\ufeff]"
)


def sanitize_filename(name: str, max_length: int = 100) -> str:
    """Cleans illegal Windows filesystem characters, control characters, and reserved device names."""
    if not name:
        return "media_file"
    name = "".join(
        character for character in str(name) if not 0xD800 <= ord(character) <= 0xDFFF
    )
    if not name:
        return "media_file"
    cleaned = unicodedata.normalize("NFC", name)
    cleaned = _UNICODE_BIDI_AND_FORMAT_RE.sub("", cleaned)
    cleaned = "".join(
        ch for ch in cleaned
        if unicodedata.category(ch) != "Cf" or ch in ("\u200c", "\u200d")
    )
    cleaned = re.sub(r'[\\/*?:"<>|]', '_', cleaned)
    cleaned = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    cleaned = cleaned.strip(" .\u200c\u200d")
    if cleaned.upper().split(".")[0] in WINDOWS_RESERVED_NAMES:
        cleaned = f"_{cleaned}"
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length].rstrip(" .\u200c\u200d")
    return cleaned or "media_file"


def identify_source_type(url_or_path: str) -> str:
    """Identifies the media source platform or local file status."""
    if not is_url(url_or_path):
        return "local_file"

    parsed = urllib.parse.urlparse(url_or_path.strip())
    hostname = (parsed.hostname or "").lower().rstrip(".")

    def matches(*domains: str) -> bool:
        return any(hostname == domain or hostname.endswith("." + domain) for domain in domains)

    if matches("spotify.com"):
        return "spotify"
    if matches("music.apple.com"):
        return "apple_music"
    if matches("youtube.com", "youtu.be"):
        return "youtube"
    if matches("soundcloud.com"):
        return "soundcloud"
    if matches("tiktok.com"):
        return "tiktok"
    if matches("twitter.com", "x.com"):
        return "twitter"
    if matches("instagram.com", "instagr.am"):
        return "instagram"
    if matches("facebook.com", "fb.watch"):
        return "facebook"
    if matches("reddit.com"):
        return "reddit"
    if matches("tumblr.com"):
        return "tumblr"
    if matches("pinterest.com", "pin.it"):
        return "pinterest"
    if matches("twitch.tv"):
        return "twitch"
    if matches("bilibili.com", "b23.tv"):
        return "bilibili"
    if matches("vimeo.com"):
        return "vimeo"
    if matches("dailymotion.com", "dai.ly"):
        return "dailymotion"
    if matches("rumble.com"):
        return "rumble"
    if matches("bandcamp.com"):
        return "bandcamp"
    if matches("patreon.com"):
        return "patreon"
    if matches("threads.net"):
        return "threads"
    if matches("bsky.app"):
        return "bluesky"
    if matches("streamable.com"):
        return "streamable"
    return "generic_url"

def is_playlist_url(url_or_path: str) -> bool:
    """
    Checks if a URL points to a playlist, album, or multi-track compilation.
    Supports YouTube playlists, Spotify playlists and albums, SoundCloud sets, and generic playlist endpoints.
    """
    if not is_url(url_or_path):
        return False
    parsed = urllib.parse.urlparse(url_or_path.strip())
    source_type = identify_source_type(url_or_path)
    path_lower = parsed.path.lower()
    query_lower = parsed.query.lower()
    if source_type == "spotify" and ("/playlist/" in path_lower or "/album/" in path_lower):
        return True
    if source_type == "apple_music":
        if "i=" in query_lower:
            return False
        if "/playlist/" in path_lower or "/album/" in path_lower:
            return True
    if source_type == "youtube" and "list=" in query_lower:
        return True
    if source_type == "soundcloud" and "/sets/" in path_lower:
        return True
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if (hostname == "bandcamp.com" or hostname.endswith(".bandcamp.com")) and "/album/" in path_lower:
        return True
    if "/playlist/" in path_lower or "/sets/" in path_lower:
        return True
    if is_ephemeral_story_url(url_or_path):
        m_ig = re.search(r"^/stories/(?P<user>[^/?#]+)(?:/(?P<id>\d+))?/?$", path_lower)
        if m_ig:
            ig_user = m_ig.group("user")
            ig_id = m_ig.group("id")
            if ig_user == "highlights" or not ig_id:
                return True
        m_fb = re.search(r"^/stories/(?P<bucket>\d+)(?:/(?P<story_id>[^/?#&]+))?/?$", path_lower)
        if m_fb and not m_fb.group("story_id"):
            return True
    return False

def is_ephemeral_story_url(url_or_path: str) -> bool:
    """Checks if a URL points to an ephemeral story (Instagram Stories or Facebook Stories)."""
    if not is_url(url_or_path):
        return False
    try:
        parsed = urllib.parse.urlsplit(str(url_or_path or "").strip())
        host = (parsed.hostname or "").lower()
        path = parsed.path.lower()
        if host == "instagram.com" or host.endswith(".instagram.com"):
            return bool(re.search(r"^/stories/[^/?#]+", path))
        if host == "facebook.com" or host.endswith(".facebook.com"):
            return bool(re.search(r"^/stories/\d+", path))
    except Exception:
        pass
    return False

from .catalog import (
    format_duration,
    build_search_candidates,
    _apple_music_url_parts,
    _apple_artwork_url,
    _apple_music_result_metadata,
    resolve_apple_music_metadata,
    fetch_apple_music_playlist_entries,
    resolve_spotify_metadata,
)

__all__ = [
    "_apple_music_url_parts",
    "_apple_artwork_url",
    "_apple_music_result_metadata",
]


def build_video_format_selector(resolution: str = "original") -> str:
    """Build a yt-dlp selector that prioritizes source size over codec preference.

    Codec-first selectors can choose a small AV1 or VP9 stream even when a larger
    H.264/VP9 stream is available. The consumer-facing resolution choice should
    limit the maximum size only when the user explicitly requests one.
    """
    res_str = (resolution or "original").strip().lower()
    if res_str in ("original", "source", "best", "max"):
        return "bv*+ba/b"

    max_heights = {
        "8k": 4320,
        "4k": 2160,
        "2k": 1440,
        "1440p": 1440,
        "1440": 1440,
        "1080p": 1080,
        "1080": 1080,
        "720p": 720,
        "720": 720,
        "480p": 480,
        "480": 480,
        "360p": 360,
        "360": 360,
        "240p": 240,
        "240": 240,
        "144p": 144,
        "144": 144,
    }
    max_height = max_heights.get(res_str)
    if max_height is None:
        m = re.match(r"^(\d+)p?$", res_str)
        if m:
            try:
                max_height = int(m.group(1))
            except ValueError:
                pass

    if max_height is None:
        return "bv*+ba/b"
    return f"bv*[height<={max_height}]+ba/b[height<={max_height}]/best[height<={max_height}]/b/best"

MAX_THUMBNAIL_BYTES = 15 * 1024 * 1024  # 15 MiB limit for cover art
MAX_THUMBNAIL_PIXELS = 16_000_000      # 16 Megapixels decompression bomb protection
MAX_THUMBNAIL_DIMENSION = 8192
MAX_REDIRECTS = 5


def _is_safe_public_url(url: str) -> bool:
    """Verifies that URL uses http/https and does not resolve to private, loopback, or internal addresses."""
    if not isinstance(url, str) or len(url) > 4096:
        return False
    try:
        parsed = urllib.parse.urlsplit(url.strip())
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
            return False
        hostname = (parsed.hostname or "").strip().lower().rstrip(".")
        if not hostname:
            return False
        if hostname == "localhost" or hostname.endswith((".local", ".internal", ".localhost", ".onion")):
            return False
        if hostname.endswith((".test", ".example")):
            return True
        try:
            addr_info = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        except socket.gaierror:
            return False
        if not addr_info:
            return False
        for _, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
                or ip.is_unspecified
            ):
                return False
        return True
    except Exception:
        return False


def resolve_entry_thumbnail(entry: Dict[str, Any], fallback_cover: str = "") -> str:
    """Resolve a live source thumbnail URL for a playlist or media entry."""
    thumb = entry.get("thumbnail")
    if isinstance(thumb, str) and (thumb.startswith("http://") or thumb.startswith("https://")):
        return thumb
    thumbnails = entry.get("thumbnails")
    if isinstance(thumbnails, list) and thumbnails:
        valid_urls = [
            t.get("url") for t in thumbnails
            if isinstance(t, dict) and isinstance(t.get("url"), str) and (t["url"].startswith("http://") or t["url"].startswith("https://"))
        ]
        if valid_urls:
            return valid_urls[-1]
    e_id = str(entry.get("id") or "").strip()
    if not e_id and entry.get("url"):
        m_yt = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})', str(entry.get("url", "")))
        if m_yt:
            e_id = m_yt.group(1)
    if e_id and len(e_id) == 11 and re.match(r'^[a-zA-Z0-9_-]{11}$', e_id):
        return f"https://i.ytimg.com/vi/{e_id}/hqdefault.jpg"
    return fallback_cover


def download_and_convert_thumbnail(thumbnail_url: str, output_path: str) -> Optional[str]:
    """Downloads cover art or thumbnail from URL (or loads local image) and converts it to standard RGB JPEG.

    Safely validates redirects, enforces streaming byte limits, prevents SSRF against private networks,
    and protects against image decompression bombs. Returns path to converted image, or None if failed.
    """
    if not thumbnail_url or not output_path:
        return None
    try:
        from PIL import Image
        import io

        if is_url(thumbnail_url):
            current_url = thumbnail_url.strip()
            session = requests.Session()
            session.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            })
            downloaded_bytes = bytearray()
            for _ in range(MAX_REDIRECTS + 1):
                if not _is_safe_public_url(current_url):
                    return None
                resp = session.get(current_url, stream=True, timeout=12, allow_redirects=False)
                if resp.status_code in (301, 302, 303, 307, 308):
                    location = resp.headers.get("Location")
                    resp.close()
                    if not location:
                        return None
                    current_url = urllib.parse.urljoin(current_url, location)
                    continue
                if resp.status_code != 200:
                    resp.close()
                    return None

                for chunk in resp.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    downloaded_bytes.extend(chunk)
                    if len(downloaded_bytes) > MAX_THUMBNAIL_BYTES:
                        resp.close()
                        return None
                resp.close()
                break
            else:
                return None

            if not downloaded_bytes:
                return None
            img = Image.open(io.BytesIO(downloaded_bytes))
        elif os.path.isfile(thumbnail_url):
            if os.path.getsize(thumbnail_url) > MAX_THUMBNAIL_BYTES:
                return None
            img = Image.open(thumbnail_url)
        else:
            return None

        with img:
            if img.width > MAX_THUMBNAIL_DIMENSION or img.height > MAX_THUMBNAIL_DIMENSION:
                return None
            if img.width * img.height > MAX_THUMBNAIL_PIXELS:
                return None
            converted = img.convert("RGB")

        abs_out = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(abs_out), exist_ok=True)
        converted.save(abs_out, "JPEG", quality=95)
        return abs_out
    except Exception as e:
        print(f"[Thumbnail] Could not process cover image: {e}")
    return None

def build_tiktok_candidates(url: str) -> list[str]:
    """Build multi-strategy TikTok URL candidates to maximize extraction reliability.

    Desktop web requests with tracking parameters can trigger ByteDance's bot WAF.
    Providing the original URL, a clean URL without tracking params, and a mobile
    web URL fallback gives yt-dlp multiple independent resolution avenues.
    """
    candidates = [url]
    m = re.search(r'/(?:video|v)/(\d+)', url) or re.search(r'\b(\d{15,22})\b', url)
    if m:
        video_id = m.group(1)
        parsed = urllib.parse.urlsplit(url)
        if parsed.query:
            clean_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
            if clean_url not in candidates:
                candidates.append(clean_url)
        mobile_url = f"https://m.tiktok.com/v/{video_id}.html"
        if mobile_url not in candidates:
            candidates.append(mobile_url)
    return candidates


def build_twitter_candidates(url: str) -> list[str]:
    """Build multi-strategy X/Twitter URL candidates to bypass guest walls and rate limits.

    If x.com returns 401/403 or demands login, yt-dlp can seamlessly resolve through
    canonical twitter.com or alternate domains.
    """
    candidates = [url]
    m = re.search(r'/(?:status|statuses)/(\d+)', url)
    if m:
        parsed = urllib.parse.urlsplit(url)
        clean_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        if clean_url not in candidates:
            candidates.append(clean_url)
        if "x.com" in parsed.netloc.lower():
            tw_url = f"https://twitter.com{parsed.path}"
            if tw_url not in candidates:
                candidates.append(tw_url)
        elif "twitter.com" in parsed.netloc.lower():
            x_url = f"https://x.com{parsed.path}"
            if x_url not in candidates:
                candidates.append(x_url)
    return candidates


def _fetch_tiktok_direct(
    source: str,
    output_dir: str,
    audio_only: bool = False,
    abort_event: Optional[Any] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    report: Optional[Callable[[float, str], None]] = None,
    preexisting_stream_files: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Brute-force direct extraction for TikTok videos bypassing web WAF blocks.

    Uses high-availability direct endpoints (TikWM / direct CDN stream) to fetch
    watermark-free media and metadata with zero reliance on web browser challenges.
    """
    def _rep(pct: float, msg: str, force: bool = False):
        if report:
            report(pct, msg, force=force)
        elif progress_callback:
            progress_callback(max(0.0, min(1.0, pct)), msg)

    _rep(0.15, "Connecting to direct TikTok media service...", force=True)

    clean_source = source.strip()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
    }

    data = None
    try:
        resp = requests.post(
            "https://www.tikwm.com/api/",
            data={"url": clean_source, "hd": 1},
            headers=headers,
            timeout=15,
        )
        if resp.status_code == 200:
            parsed = resp.json()
            if parsed.get("code") == 0 and parsed.get("data"):
                data = parsed.get("data")
    except (requests.RequestException, json.JSONDecodeError, ValueError):
        pass

    if not data:
        try:
            get_url = f"https://www.tikwm.com/api/?url={urllib.parse.quote(clean_source)}&hd=1"
            resp = requests.get(get_url, headers=headers, timeout=15)
            if resp.status_code == 200:
                parsed = resp.json()
                if parsed.get("code") == 0 and parsed.get("data"):
                    data = parsed.get("data")
        except (requests.RequestException, json.JSONDecodeError, ValueError):
            pass

    if not data:
        # Adaptive fallback: secondary high-availability direct TikTok service (TikMate)
        try:
            resp = requests.post(
                "https://api.tikmate.app/api/lookup",
                data={"url": clean_source},
                headers=headers,
                timeout=12,
            )
            if resp.status_code == 200:
                tm_data = resp.json()
                tok = tm_data.get("token")
                vid = tm_data.get("id")
                if tok and vid:
                    dl_url = f"https://tikmate.app/download/{tok}/{vid}.mp4?hd=1"
                    data = {
                        "id": str(vid),
                        "title": tm_data.get("desc") or "TikTok Video",
                        "author": {"unique_id": tm_data.get("author_unique_id") or "TikTok Creator"},
                        "play": dl_url,
                        "hdplay": dl_url,
                    }
        except (requests.RequestException, json.JSONDecodeError, ValueError):
            pass

    if not data:
        raise ValueError(f"Direct stream extraction failed for TikTok URL: {source}")

    title = (data.get("title") or "TikTok Video").strip()
    author_info = data.get("author") or {}
    artist = (author_info.get("unique_id") or author_info.get("nickname") or "TikTok Creator").strip()
    duration = int(data.get("duration") or 0)
    cover_url = data.get("origin_cover") or data.get("cover") or ""

    if audio_only and data.get("music"):
        stream_url = data.get("music")
        ext = ".mp3"
    else:
        stream_url = data.get("hdplay") or data.get("play")
        ext = ".mp4"

    if not stream_url:
        raise ValueError("Direct TikTok extractor returned no playable stream URL.")

    if stream_url.startswith("/"):
        stream_url = f"https://www.tikwm.com{stream_url}"

    base_label = sanitize_filename(f"{artist} - {title}"[:60] if artist else title[:60]) or f"tiktok_{data.get('id', 'video')}"
    target_filename = os.path.join(output_dir, f"{base_label}{ext}")
    counter = 1
    base_stem, base_ext = os.path.splitext(target_filename)
    while os.path.exists(target_filename):
        target_filename = f"{base_stem}_{counter}{base_ext}"
        counter += 1

    _rep(0.25, "Streaming media directly from TikTok CDN...", force=True)

    stream_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Referer": "https://www.tiktok.com/",
    }

    if not _is_safe_public_url(stream_url):
        raise ValueError("Direct TikTok stream URL failed public safety verification.")

    try:
        current_url = stream_url
        stream_resp = None
        for _ in range(MAX_REDIRECTS + 1):
            if not _is_safe_public_url(current_url):
                raise ValueError("Direct TikTok redirect URL failed public safety verification.")
            resp = requests.get(current_url, headers=stream_headers, stream=True, timeout=30, allow_redirects=False)
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location")
                resp.close()
                if not location:
                    raise ValueError("TikTok stream redirect missing Location header.")
                current_url = urllib.parse.urljoin(current_url, location)
                continue
            stream_resp = resp
            break
        if stream_resp is None:
            raise RuntimeError("TikTok stream exceeded maximum redirects.")

        with stream_resp:
            stream_resp.raise_for_status()
            total_size = int(stream_resp.headers.get("content-length") or 0)
            downloaded = 0
            with open(target_filename, "wb") as f:
                for chunk in stream_resp.iter_content(chunk_size=65536):
                    if abort_event and abort_event.is_set():
                        raise KeyboardInterrupt("Stream extraction aborted by user.")
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if downloaded > 1024 * 1024 * 1024:
                            raise RuntimeError("TikTok media stream exceeds the 1 GB limit.")
                        if total_size > 0:
                            pct = 0.25 + (downloaded / total_size) * 0.45
                            _rep(pct, f"Downloaded {downloaded // 1024} KB of {total_size // 1024} KB...")
    except BaseException:
        if os.path.exists(target_filename):
            try:
                os.remove(target_filename)
            except OSError:
                pass
        raise

    if not os.path.exists(target_filename) or os.path.getsize(target_filename) == 0:
        raise FileNotFoundError(f"Failed to stream direct TikTok media to {target_filename}")

    thumbnail_local_path = None
    if cover_url:
        local_thumb_file = os.path.join(output_dir, "cover.jpg")
        try:
            thumbnail_local_path = download_and_convert_thumbnail(cover_url, local_thumb_file)
        except Exception:
            thumbnail_local_path = None

    _rep(0.75, "Direct TikTok media extraction complete.", force=True)

    return {
        "media_path": os.path.abspath(target_filename),
        "title": title,
        "artist": artist,
        "album": "",
        "year": str(datetime.now().year),
        "description": data.get("title", ""),
        "tags": [],
        "categories": [],
        "webpage_url": clean_source,
        "thumbnail_url": cover_url,
        "thumbnail_path": thumbnail_local_path,
        "duration": duration,
        "source_format": "mp4" if ext == ".mp4" else "mp3",
        "source_format_id": "direct_cdn",
        "source_width": None,
        "source_height": None,
        "source_video_codec": "h264" if ext == ".mp4" else "",
        "source_audio_codec": "aac" if ext == ".mp4" else "mp3",
        "source_type": "tiktok",
        "catalog_match": None,
        "requested_catalog_url": None,
        "matched_source_title": title,
        "matched_source_artist": artist,
        "is_local": False,
    }


def fetch_media_stream(
    source: str,
    output_dir: str,
    audio_only: bool = False,
    resolution: str = "original",
    fallback_title: Optional[str] = None,
    fallback_artist: Optional[str] = None,
    abort_event: Optional[Any] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    auth_browser: Optional[str] = None,
    browser_media_path: Optional[str] = None,
    allow_ephemeral_stories: bool = False,
    archival_fallback: bool = False,
) -> Dict[str, Any]:
    """
    Fetches the media stream from a URL (or validates local file) into output_dir.
    Returns metadata dict with local path, title, artist, and media type.
    """
    if is_ephemeral_story_url(source) and not allow_ephemeral_stories:
        raise ValueError(
            "Ephemeral story extraction is disabled by default. "
            "To convert Instagram or Facebook stories, you must acknowledge the Legal Disclaimer & Acceptable Use Policy "
            "in DISCLAIMER.md by enabling 'Ephemeral Stories Extraction' in Settings, or passing --allow-ephemeral-stories in the CLI."
        )
    os.makedirs(output_dir, exist_ok=True)
    preexisting_stream_files = {}
    try:
        for entry_name in os.listdir(output_dir):
            entry_path = os.path.join(output_dir, entry_name)
            if os.path.isfile(entry_path):
                entry_stat = os.stat(entry_path)
                preexisting_stream_files[os.path.abspath(entry_path)] = (entry_stat.st_size, entry_stat.st_mtime_ns)
    except OSError:
        preexisting_stream_files = {}
    raw_browser = str(auth_browser or "").strip().lower()
    allow_browser_cookies = raw_browser not in ("none", "disabled", "off", "false", "public", "public only")
    if not allow_browser_cookies:
        effective_auth_browser = "none"
    else:
        effective_auth_browser = normalize_browser_session(auth_browser) or "auto"

    last_report_time = [0.0]

    def report(pct: float, msg: str, force: bool = False):
        if progress_callback:
            now = time.monotonic()
            if force or now - last_report_time[0] >= 0.15 or pct in (0.0, 1.0):
                last_report_time[0] = now
                progress_callback(max(0.0, min(1.0, pct)), msg)

    source_type = identify_source_type(source)

    # The browser bridge delivers a user-selected media file directly. This
    # fast path intentionally bypasses yt-dlp and every browser profile/cookie
    # reader. The confirmed page URL remains the source for library grouping.
    if browser_media_path:
        captured_path = os.path.abspath(os.fspath(browser_media_path))
        if not os.path.isfile(captured_path):
            raise FileNotFoundError("The browser capture file is no longer available. Capture the media again.")
        try:
            captured_size = os.path.getsize(captured_path)
        except OSError as error:
            raise RuntimeError(f"Could not inspect the browser capture: {error}") from error
        if captured_size <= 0:
            raise RuntimeError("The browser capture was empty. Capture the media again.")
        suffix = os.path.splitext(captured_path)[1].lower() or ".bin"
        copied_path = os.path.join(output_dir, "browser-capture" + suffix)
        shutil.copy2(captured_path, copied_path)
        report(0.75, "Browser capture received. Preparing conversion...", force=True)
        meta_title = fallback_title or "Captured media"
        meta_artist = fallback_artist or "Browser capture"
        meta_album = ""
        meta_year = ""
        meta_thumb_url = ""
        meta_thumb_path = None

        if source_type == "apple_music":
            try:
                am_meta = resolve_apple_music_metadata(source)
                meta_title = am_meta.get("title") or meta_title
                meta_artist = am_meta.get("artist") or meta_artist
                meta_album = am_meta.get("album") or ""
                meta_year = am_meta.get("year") or ""
                meta_thumb_url = am_meta.get("thumbnail") or ""
            except (requests.RequestException, ValueError, KeyError):
                pass
        elif source_type == "spotify":
            try:
                sp_meta = resolve_spotify_metadata(source)
                meta_title = sp_meta.get("title") or meta_title
                meta_artist = sp_meta.get("artist") or meta_artist
                meta_album = sp_meta.get("album") or ""
                meta_year = sp_meta.get("year") or ""
                meta_thumb_url = sp_meta.get("thumbnail") or ""
            except (requests.RequestException, ValueError, KeyError):
                pass

        if meta_thumb_url:
            local_thumb_file = os.path.join(output_dir, "cover.jpg")
            meta_thumb_path = download_and_convert_thumbnail(meta_thumb_url, local_thumb_file)

        return {
            "media_path": os.path.abspath(copied_path),
            "title": meta_title,
            "artist": meta_artist,
            "album": meta_album,
            "year": meta_year,
            "description": "",
            "tags": [],
            "categories": [],
            "webpage_url": source,
            "thumbnail_url": meta_thumb_url,
            "thumbnail_path": meta_thumb_path,
            "duration": 0,
            "source_type": source_type,
            "is_local": False,
        }


    # 1. Local File
    if source_type == "local_file":
        if not os.path.exists(source):
            raise FileNotFoundError(f"Local file not found at: '{source}'")
        base = os.path.splitext(os.path.basename(source))[0]
        report(1.0, f"Loaded local file: {os.path.basename(source)}")
        return {
            "media_path": os.path.abspath(source),
            "title": base,
            "artist": "Local Audio",
            "album": "",
            "year": "",
            "description": "",
            "tags": [],
            "categories": [],
            "webpage_url": "",
            "thumbnail_url": "",
            "thumbnail_path": None,
            "duration": 0,
            "source_type": "local",
            "is_local": True
        }

    # 2. Spotify Track or Search Queries
    spotify_meta = None
    apple_meta = None
    target_url = source
    candidates = []
    if source_type == "spotify":
        report(0.05, "Extracting Spotify track details from public metadata...")
        try:
            spotify_meta = resolve_spotify_metadata(source)
        except Exception:
            spotify_meta = None

        if not spotify_meta or not spotify_meta.get("title") or spotify_meta.get("title") == "Unknown Track":
            if fallback_title:
                cands = build_search_candidates(fallback_artist or "Unknown Artist", fallback_title)
                spotify_meta = {
                    "title": fallback_title,
                    "artist": fallback_artist or "Unknown Artist",
                    "album": "",
                    "year": "",
                    "search_query": cands[0] if cands else f"{fallback_artist} {fallback_title}",
                    "search_candidates": cands,
                    "thumbnail": "",
                    "thumbnail_url": "",
                    "description": ""
                }
            else:
                raise RuntimeError(
                    "Could not resolve Spotify track metadata. The link may be private, region-locked, "
                    "or removed from the Spotify catalog. Check your internet connection and try again."
                )

        if spotify_meta:
            report(0.12, f"Resolved Spotify track: {spotify_meta['artist']} - {spotify_meta['title']}")
            report(0.14, "Spotify audio streams are encrypted via Widevine DRM; locating matching official studio audio...")
            candidates = spotify_meta.get("search_candidates") or build_search_candidates(spotify_meta["artist"], spotify_meta["title"])
            target_url = candidates[0] if candidates else spotify_meta.get("search_query", "")
    elif source_type == "apple_music":
        report(0.05, "Resolving Apple Music catalog metadata...")
        try:
            apple_meta = resolve_apple_music_metadata(source)
        except Exception:
            apple_meta = None

        if not apple_meta or not apple_meta.get("title") or apple_meta.get("title") == "Unknown Track":
            if fallback_title:
                cands = build_search_candidates(fallback_artist or "Unknown Artist", fallback_title)
                apple_meta = {
                    "title": fallback_title,
                    "artist": fallback_artist or "Unknown Artist",
                    "album": "",
                    "year": "",
                    "search_query": cands[0] if cands else f"{fallback_artist} {fallback_title}",
                    "search_candidates": cands,
                    "thumbnail": "",
                    "thumbnail_url": "",
                    "description": "",
                    "duration": 0,
                }
            else:
                raise RuntimeError(
                    "Could not resolve Apple Music track metadata. Check your connection or the song link."
                )

        report(0.12, f"Resolved Apple Music track: {apple_meta['artist']} - {apple_meta['title']}")
        search_cands = apple_meta.get("search_candidates") or build_search_candidates(
            apple_meta["artist"], apple_meta["title"]
        )
        candidates = [source] + search_cands if is_url(source) else search_cands
        target_url = candidates[0] if candidates else apple_meta.get("search_query", "")
    elif source_type == "tiktok":
        candidates = build_tiktok_candidates(target_url)
    elif source_type == "twitter":
        candidates = build_twitter_candidates(target_url)
    elif target_url.startswith("ytsearch") or target_url.startswith("scsearch"):
        candidates = [target_url]
    else:
        candidates = [target_url]

    # 3. Web Stream Download via yt-dlp
    report(0.15, "Connecting to stream provider and parsing media formats...")

    def progress_hook(d):
        if abort_event and abort_event.is_set():
            raise KeyboardInterrupt("Stream download aborted by user.")
        if progress_callback and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            speed = d.get("speed", 0) or 0
            eta = d.get("eta")
            percent = (downloaded / total * 100.0) if total > 0 else 0.0

            total_str = f"{total / (1024 * 1024):.2f}MiB" if total else "Unknown"
            speed_str = f"{speed / (1024 * 1024):.2f}MiB/s" if speed else "Unknown B/s"
            eta_str = f"{int(eta // 60):02d}:{int(eta % 60):02d}" if eta is not None else "Unknown"

            # Scale download phase from 15% to 75%
            scaled_pct = 0.15 + (percent / 100.0) * 0.60
            report(scaled_pct, f"[download] {percent:5.1f}% of {total_str} at {speed_str} ETA {eta_str}")
        elif progress_callback and d.get("status") == "finished":
            report(0.75, "Stream download complete. Preparing conversion...", force=True)

    format_selector = (
        "download/original/bestaudio[acodec=opus]/bestaudio[ext=opus]/bestaudio[ext=webm]/bestaudio[abr>140]/bestaudio/best"
        if audio_only
        else build_video_format_selector(resolution)
    )

    from .converter import get_ffmpeg_binary, get_js_runtimes_config
    ffmpeg_bin = get_ffmpeg_binary()

    ydl_opts = {
        "format": format_selector,
        "outtmpl": os.path.join(output_dir, "%(title).80s_%(id)s.%(ext)s"),
        "paths": {"home": output_dir, "temp": output_dir},
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "concurrent_fragment_downloads": 4,
        "socket_timeout": 10,
        "retries": 1,
        "fragment_retries": 1,
        "extractor_retries": 1,
        # For audio-only downloads, prioritize high-bandwidth Opus streams (up to 20kHz+ frequency
        # response) over lossy-lowpassed AAC (which brickwalls at 16kHz on YouTube/SoundCloud).
        # For video downloads, prioritize resolution and high-bitrate video streams.
        "format_sort": (
            ["proto:https", "acodec:opus", "abr", "asr"]
            if audio_only
            else ["res", "fps", "proto:https", "br"]
        ),
        "js_runtimes": get_js_runtimes_config(),
        "progress_hooks": [progress_hook]
    }
    is_youtube_source = (
        source_type == "youtube"
        or any("youtube.com" in str(c) or "youtu.be" in str(c) or str(c).startswith("ytsearch") for c in candidates)
    )
    if is_youtube_source:
        ydl_opts["retries"] = 1
        ydl_opts["fragment_retries"] = 1
        ydl_opts["file_access_retries"] = 1
        if "extractor_args" not in ydl_opts:
            ydl_opts["extractor_args"] = {}
        if "youtube" not in ydl_opts["extractor_args"]:
            ydl_opts["extractor_args"]["youtube"] = {
                "player_client": ["web_embedded", "android", "ios"],
            }

    is_tiktok_source = (
        source_type == "tiktok"
        or any("tiktok.com" in str(c) for c in candidates)
    )
    if is_tiktok_source:
        ydl_opts["extractor_args"] = {
            "tiktok": {
                "api_hostname": ["api16-normal-c-useast1a.tiktokv.com", "api22-normal-c-alisg.tiktokv.com"],
            }
        }

    if ffmpeg_bin and (os.path.isfile(ffmpeg_bin) or shutil.which(ffmpeg_bin)):
        ydl_opts["ffmpeg_location"] = ffmpeg_bin

    try:
        info = None
        last_error = None
        catalog_meta = spotify_meta or apple_meta
        recovery_deadline = time.monotonic() + 60
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            def extract(query, download):
                return extract_with_browser_fallback(
                    ydl, ydl_opts, query, download, browser=effective_auth_browser,
                    abort_event=abort_event, report=report, deadline=recovery_deadline,
                    allow_cookies=allow_browser_cookies,
                )

            for query_item in candidates:
                if abort_event and abort_event.is_set():
                    raise KeyboardInterrupt("Stream extraction aborted by user.")
                try:
                    if time.monotonic() >= recovery_deadline:
                        raise TimeoutError("Extraction recovery deadline reached.")
                    if catalog_meta and (query_item.startswith(("ytsearch", "scsearch")) or not is_url(query_item)):
                        search = re.sub(r"^(ytsearch|scsearch)1:", r"\g<1>5:", query_item)
                        preview = extract(search, False)
                        matches = list((preview or {}).get("entries") or [preview])
                        selected = choose_catalog_match(catalog_meta, matches)
                        selected_url = selected.get("webpage_url") or selected.get("original_url") or selected.get("url")
                        if not selected_url or not is_url(selected_url):
                            raise ValueError("Catalog candidate has no direct source link.")
                        report(0.15, f"Catalog match selected from {identify_source_type(selected_url)}: {selected.get('title', '')}. This is an alternate public recording, not catalog audio.", force=True)
                        cand_info = extract(selected_url, True)
                        if not cand_info or match_score(catalog_meta, cand_info, relaxed=True) is None:
                            raise ValueError("The selected recording changed identity during download; it was not accepted.")
                    else:
                        cand_info = extract(query_item, True)
                    if not cand_info:
                        continue
                    if "entries" in cand_info:
                        sub_entries = cand_info.get("entries")
                        if not sub_entries:
                            continue
                        cand_info = sub_entries[0]
                    info = cand_info
                    break
                except KeyboardInterrupt:
                    raise
                except BrowserSessionError as bse:
                    last_error = bse
                    if (is_tiktok_source or catalog_meta) and query_item != candidates[-1]:
                        continue
                    if is_tiktok_source:
                        break
                    raise
                except Exception as ex:
                    last_error = ex
                    if is_tiktok_source:
                        if query_item != candidates[-1]:
                            continue
                        break
                    if classify_extraction(ex) in (ExtractionCategory.ACCESS, ExtractionCategory.REMOVED, ExtractionCategory.RATE_LIMIT, ExtractionCategory.NETWORK):
                        if (source_type == "tiktok" or catalog_meta) and query_item != candidates[-1]:
                            continue
                        break
                    continue

            if not info:
                if archival_fallback:
                    from .archival import probe_archival_vaults, download_archival_stream
                    arc_res = probe_archival_vaults(source, report=report)
                    if arc_res and arc_res.found:
                        return download_archival_stream(
                            arc_res, output_dir, abort_event=abort_event, progress_callback=progress_callback
                        )
                if is_tiktok_source:
                    report(0.18, "Engaging direct TikTok stream extractor...", force=True)
                    return _fetch_tiktok_direct(
                        source,
                        output_dir,
                        audio_only=audio_only,
                        abort_event=abort_event,
                        progress_callback=progress_callback,
                        report=report,
                        preexisting_stream_files=preexisting_stream_files,
                    )
                if source_type == "apple_music":
                    msg = (
                        "Apple Music was recognized, but no matching downloadable public stream was found. "
                        "Try a direct song link with ?i=TRACK_ID, check the region, or try another public version."
                    )
                else:
                    msg = f"No matching streams returned from search (tried {len(candidates)} query strategies)."
                if last_error:
                    msg += f" Last error: {last_error}"
                raise ValueError(msg)

            downloaded_file = ydl.prepare_filename(info)
            if not os.path.exists(downloaded_file):
                base_stem, _ = os.path.splitext(downloaded_file)
                for ext in (".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".opus", ".aac", ".ogg", ".avi", ".wav"):
                    candidate = base_stem + ext
                    if os.path.exists(candidate):
                        downloaded_file = candidate
                        break

            if not os.path.exists(downloaded_file) and os.path.isdir(output_dir):
                stream_exts = {".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".opus", ".aac", ".ogg", ".avi", ".wav", ".flac"}
                fresh_candidates = []
                for entry in os.scandir(output_dir):
                    if not entry.is_file():
                        continue
                    _, ext = os.path.splitext(entry.name)
                    if ext.lower() not in stream_exts:
                        continue
                    abs_candidate = os.path.abspath(entry.path)
                    try:
                        stat = entry.stat()
                    except OSError:
                        continue
                    prev = preexisting_stream_files.get(abs_candidate)
                    if prev and (stat.st_size, stat.st_mtime_ns) == prev:
                        continue
                    fresh_candidates.append((stat.st_mtime_ns, entry.path))
                if fresh_candidates:
                    fresh_candidates.sort(reverse=True)
                    downloaded_file = fresh_candidates[0][1]

            if not os.path.exists(downloaded_file):
                raise FileNotFoundError(f"Downloaded stream file not found at: {downloaded_file}")
            try:
                downloaded_stat = os.stat(downloaded_file)
            except OSError as exc:
                raise FileNotFoundError(f"Downloaded stream file is unavailable: {downloaded_file}") from exc
            previous_stat = preexisting_stream_files.get(os.path.abspath(downloaded_file))
            if previous_stat and (downloaded_stat.st_size, downloaded_stat.st_mtime_ns) == previous_stat:
                raise FileNotFoundError(
                    f"Refusing to reuse a stale downloaded stream: {downloaded_file}"
                )

            catalog_meta = spotify_meta or apple_meta
            extracted_title = catalog_meta["title"] if catalog_meta else info.get("title", "Media Track")
            extracted_artist = catalog_meta["artist"] if catalog_meta else info.get("uploader", "Unknown Artist")
            extracted_album = catalog_meta["album"] if catalog_meta else ""
            upload_date = str(info.get("upload_date") or "")
            extracted_year = (catalog_meta.get("year", "") if catalog_meta else "") or (upload_date[:4] if upload_date else "")
            description = info.get("description", "") or (catalog_meta.get("description", "") if catalog_meta else "")
            tags = info.get("tags", []) or []
            categories = info.get("categories", []) or []
            webpage_url = info.get("webpage_url") or source

            selected_width = info.get("width")
            selected_height = info.get("height")
            selected_format = info.get("format_note") or info.get("format_id") or "provider-selected stream"
            if selected_width and selected_height:
                report(
                    0.75,
                    f"Selected source stream: {selected_width}×{selected_height} ({selected_format}).",
                    force=True,
                )

            # Thumbnail download and conversion to JPEG
            thumb_url = (catalog_meta.get("thumbnail") if catalog_meta and catalog_meta.get("thumbnail") else None) or info.get("thumbnail")
            if not thumb_url:
                v_id = str(info.get("id") or "").strip()
                if v_id and len(v_id) == 11 and re.match(r'^[a-zA-Z0-9_-]{11}$', v_id):
                    thumb_url = f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
            if thumb_url and (thumb_url.startswith("http://") or thumb_url.startswith("https://")):
                print(f"[*] Media Thumbnail URL: {thumb_url}", flush=True)
            thumbnail_local_path = None
            if thumb_url:
                local_thumb_file = os.path.join(output_dir, "cover.jpg")
                thumbnail_local_path = download_and_convert_thumbnail(thumb_url, local_thumb_file)

            return {
                "media_path": os.path.abspath(downloaded_file),
                "title": extracted_title,
                "artist": extracted_artist,
                "album": extracted_album,
                "year": extracted_year,
                "description": description,
                "tags": tags,
                "categories": categories,
                "webpage_url": webpage_url,
                "thumbnail_url": thumb_url or "",
                "thumbnail_path": thumbnail_local_path,
                "duration": info.get("duration", 0),
                "source_format": selected_format,
                "source_format_id": info.get("format_id", ""),
                "source_width": selected_width,
                "source_height": selected_height,
                "source_video_codec": info.get("vcodec", ""),
                "source_audio_codec": info.get("acodec", ""),
                "source_type": source_type,
                "catalog_match": "verified-metadata" if catalog_meta else None,
                "requested_catalog_url": source if catalog_meta else None,
                "matched_source_title": info.get("title", ""),
                "matched_source_artist": info.get("artist") or info.get("uploader", ""),
                "is_local": False
            }
    except BrowserSessionError:
        if archival_fallback:
            from .archival import probe_archival_vaults, download_archival_stream
            arc_res = probe_archival_vaults(source, report=report)
            if arc_res and arc_res.found:
                return download_archival_stream(
                    arc_res, output_dir, abort_event=abort_event, progress_callback=progress_callback
                )
        if is_tiktok_source:
            report(0.18, "Engaging direct TikTok stream extractor...", force=True)
            return _fetch_tiktok_direct(
                source,
                output_dir,
                audio_only=audio_only,
                abort_event=abort_event,
                progress_callback=progress_callback,
                report=report,
                preexisting_stream_files=preexisting_stream_files,
            )
        raise
    except Exception as e:
        if archival_fallback:
            from .archival import probe_archival_vaults, download_archival_stream
            arc_res = probe_archival_vaults(source, report=report)
            if arc_res and arc_res.found:
                return download_archival_stream(
                    arc_res, output_dir, abort_event=abort_event, progress_callback=progress_callback
                )
        if is_tiktok_source:
            report(0.18, "Engaging direct TikTok stream extractor...", force=True)
            try:
                return _fetch_tiktok_direct(
                    source,
                    output_dir,
                    audio_only=audio_only,
                    abort_event=abort_event,
                    progress_callback=progress_callback,
                    report=report,
                    preexisting_stream_files=preexisting_stream_files,
                )
            except Exception as direct_err:
                raise RuntimeError(f"Stream extraction failed: {str(e)} (Direct extractor: {direct_err})") from e
        if auth_browser:
            raise RuntimeError(describe_authenticated_extraction_failure(auth_browser, e)) from e
        raise RuntimeError(f"Stream extraction failed: {str(e)}") from e

def fetch_playlist_entries(
    url: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    auth_browser: Optional[str] = None,
    allow_ephemeral_stories: bool = False,
    archival_fallback: bool = False,
) -> Dict[str, Any]:
    """
    Extracts metadata for all tracks or videos in a playlist without downloading media stream files.
    Supports Spotify playlists/albums, YouTube playlists, SoundCloud sets, and generic sources.
    """
    clean_url = url.strip()
    if is_ephemeral_story_url(clean_url) and not allow_ephemeral_stories:
        raise ValueError(
            "Ephemeral story extraction is disabled by default. "
            "To convert Instagram or Facebook stories, you must acknowledge the Legal Disclaimer & Acceptable Use Policy "
            "in DISCLAIMER.md by enabling 'Ephemeral Stories Extraction' in Settings, or passing --allow-ephemeral-stories in the CLI."
        )

    def report(pct: float, msg: str, *args: Any, **kwargs: Any):
        if progress_callback:
            progress_callback(pct, msg)

    source_type = identify_source_type(url)
    raw_browser = str(auth_browser or "").strip().lower()
    allow_browser_cookies = raw_browser not in ("none", "disabled", "off", "false", "public", "public only")
    if not allow_browser_cookies:
        effective_auth_browser = "none"
    else:
        effective_auth_browser = normalize_browser_session(auth_browser) or "auto"


    if source_type == "apple_music":
        return fetch_apple_music_playlist_entries(clean_url, progress_callback=progress_callback)

    # 1. Spotify Playlist or Album via Embed Endpoint
    if source_type == "spotify":
        report(0.1, "Connecting to Spotify public catalog service...")
        m_id = re.search(r'/(playlist|album)/([a-zA-Z0-9]+)', clean_url)
        if not m_id:
            raise ValueError(f"Could not parse Spotify playlist or album ID from: {url}")

        kind, item_id = m_id.groups()
        embed_url = f"https://open.spotify.com/embed/{kind}/{item_id}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        report(0.3, f"Fetching Spotify {kind} metadata...")
        resp = requests.get(embed_url, headers=headers, timeout=12)
        if resp.status_code != 200:
            raise RuntimeError(f"Spotify embed returned HTTP status {resp.status_code}")

        m_data = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.DOTALL)
        if not m_data:
            raise RuntimeError("Could not locate Spotify catalog payload in response.")

        try:
            payload = json.loads(m_data.group(1))
            entity = payload.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
            playlist_title = entity.get("title") or entity.get("name") or f"Spotify {kind.capitalize()}"
            raw_tracks = entity.get("trackList", [])

            # Extract high-res playlist cover
            cover_url = ""
            img_list = entity.get("visualIdentity", {}).get("image", [])
            if img_list:
                best_img = max(img_list, key=lambda x: x.get("maxWidth", 0))
                cover_url = best_img.get("url", "")
        except Exception as e:
            raise RuntimeError(f"Failed to parse Spotify catalog data: {e}") from e

        report(0.7, f"Extracting {len(raw_tracks)} tracks from {playlist_title}...")
        entries = []
        for idx, t in enumerate(raw_tracks, 1):
            t_title = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', t.get("title") or f"Track {idx}").strip()
            t_artist = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', t.get("subtitle") or "").strip()
            t_dur_ms = t.get("duration", 0) or 0
            t_dur_sec = t_dur_ms // 1000
            uri = t.get("uri", "")
            track_id = uri.split(":")[-1] if uri else ""
            if track_id:
                track_url = f"https://open.spotify.com/track/{track_id}"
            else:
                cands = build_search_candidates(t_artist, t_title)
                track_url = cands[0] if cands else f"ytsearch1:{t_title}"

            entries.append({
                "index": idx,
                "title": t_title,
                "artist": t_artist,
                "duration": t_dur_sec,
                "duration_str": format_duration(t_dur_sec),
                "url": track_url,
                "id": track_id,
                "thumbnail": cover_url,
                "album": playlist_title
            })

        report(1.0, f"Successfully loaded {len(entries)} items from {playlist_title}.")
        return {
            "playlist_title": playlist_title,
            "source_type": f"spotify_{kind}",
            "total_count": len(entries),
            "thumbnail_url": cover_url,
            "entries": entries
        }

    # 2. YouTube, SoundCloud, or Generic Playlists via yt-dlp Flat Extraction
    report(0.1, "Inspecting playlist catalog...")
    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": False,
        "js_runtimes": get_js_runtimes_config()
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            report(0.3, "Extracting playlist index and track listings...")
            info = extract_with_browser_fallback(
                ydl, ydl_opts, clean_url, download=False, browser=effective_auth_browser,
                report=report, allow_cookies=allow_browser_cookies,
            )
            if not info:
                raise ValueError("Could not extract playlist information from URL.")

            playlist_title = info.get("title") or "Playlist"
            playlist_cover = info.get("thumbnail") or ""
            raw_entries = info.get("entries") or []

            if not raw_entries and info.get("_type") != "playlist":
                raw_entries = [info]

            report(0.7, f"Processing {len(raw_entries)} entries...")
            entries = []
            valid_idx = 1
            for e in raw_entries:
                if not e:
                    continue
                raw_t = (e.get("title") or "").strip()
                is_unavailable = raw_t.lower() in {
                    "[private video]", "[deleted video]", "[unavailable video]",
                    "[private]", "[deleted]", "[unavailable]"
                } or e.get("availability") in ("private", "deleted", "unavailable", "needs_auth")

                if is_unavailable:
                    if not archival_fallback:
                        continue
                    # Archival fallback active: retain item and resolve historical metadata
                    e_id = e.get("id") or ""
                    if not e_id:
                        continue
                    from .archival import lookup_historical_metadata
                    hist_meta = lookup_historical_metadata(e_id)
                    t_title = hist_meta.title or f"[Archived Video] {e_id}"
                    t_artist = hist_meta.uploader or e.get("uploader") or e.get("channel") or "Archived Vault"
                    t_dur_sec = hist_meta.duration or int(e.get("duration") or 0)
                    e_url = f"https://www.youtube.com/watch?v={e_id}"
                    e_thumb = hist_meta.thumbnail_url or playlist_cover
                    e_desc = hist_meta.description or "Unavailable on YouTube. Queued for Archival Vault recovery."
                    entries.append({
                        "index": valid_idx,
                        "title": t_title,
                        "artist": t_artist,
                        "duration": t_dur_sec,
                        "duration_str": format_duration(t_dur_sec),
                        "url": e_url,
                        "id": e_id,
                        "thumbnail": e_thumb,
                        "description": e_desc,
                        "album": playlist_title,
                        "is_archival_candidate": True,
                    })
                    valid_idx += 1
                    continue

                if not raw_t and not e.get("duration") and not (e.get("uploader") or e.get("channel")):
                    continue

                t_title = raw_t or f"Track {valid_idx}"
                t_artist = e.get("uploader") or e.get("channel") or e.get("artist") or ""
                t_dur_sec = int(e.get("duration") or 0)
                e_url = e.get("url") or ""
                e_id = e.get("id") or ""
                e_thumb = resolve_entry_thumbnail(e, "")
                e_desc = e.get("description") or ""

                if not e_url or not is_url(e_url):
                    if e_id and ("youtube" in clean_url.lower() or "youtu.be" in clean_url.lower() or "list=" in clean_url.lower()):
                        e_url = f"https://www.youtube.com/watch?v={e_id}"
                    elif e_id and "instagram.com" in clean_url.lower():
                        m_user = re.search(r'instagram\.com/stories/([^/?#]+)', clean_url)
                        if m_user:
                            story_user = m_user.group(1)
                            pk = e_id
                            if not e_id.isdigit():
                                try:
                                    import yt_dlp.extractor.instagram as ig
                                    pk = str(ig._id_to_pk(e_id))
                                except Exception:
                                    pk = e_id
                            if pk and pk.isdigit():
                                if story_user.lower() == "highlights":
                                    e_url = f"https://www.instagram.com/stories/highlights/{pk}/"
                                else:
                                    e_url = f"https://www.instagram.com/stories/{story_user}/{pk}/"
                            else:
                                e_url = f"https://www.instagram.com/p/{e_id}/"
                        else:
                            e_url = f"https://www.instagram.com/p/{e_id}/"
                    elif e_id and "facebook.com" in clean_url.lower():
                        e_url = f"https://www.facebook.com/{e_id}"
                    elif e_id and "tiktok.com" in clean_url.lower():
                        e_url = f"https://www.tiktok.com/@video/video/{e_id}"
                    elif e_id and is_url(f"https://{e_id}"):
                        e_url = f"https://{e_id}"
                    elif e_id:
                        e_url = e_id

                entries.append({
                    "index": valid_idx,
                    "title": t_title,
                    "artist": t_artist,
                    "duration": t_dur_sec,
                    "duration_str": format_duration(t_dur_sec),
                    "url": e_url,
                    "id": e_id,
                    "thumbnail": e_thumb,
                    "description": e_desc,
                    "album": playlist_title
                })
                valid_idx += 1

            report(1.0, f"Successfully loaded {len(entries)} items from {playlist_title}.")
            return {
                "playlist_title": playlist_title,
                "source_type": source_type,
                "total_count": len(entries),
                "thumbnail_url": playlist_cover,
                "entries": entries
            }
    except Exception as e:
        if auth_browser:
            raise RuntimeError(
                describe_authenticated_extraction_failure(auth_browser, e, subject="playlist")
            ) from e
        raise RuntimeError(f"Playlist extraction failed: {str(e)}") from e
