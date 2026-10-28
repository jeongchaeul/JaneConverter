"""Validate and save photo renditions discovered in an isolated Facebook guest page."""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import tempfile
import time
import urllib.parse
from typing import Any, Callable, Optional

import requests
from PIL import Image

from .auth import detect_running_browsers, get_ordered_browser_candidates
from .cookie_unlocker import patch_yt_dlp_cookie_database_reader
from .extractor import clean_windows_path, sanitize_filename
from .image_format import convert_image_format


MAX_PHOTOS = 500
MAX_IMAGE_BYTES = 100 * 1024 * 1024
MAX_ALBUM_BYTES = 2 * 1024 * 1024 * 1024
PHOTO_ID_RE = re.compile(r"^[0-9]{5,30}$")
IMAGE_EXTENSIONS = {
    "JPEG": ".jpg",
    "MPO": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
    "GIF": ".gif",
    "AVIF": ".avif",
    "BMP": ".bmp",
    "TIFF": ".tif",
}
MAX_RENDITIONS = 4
MAX_RENDITION_REFRESHES = 8
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
MAX_REDIRECTS = 5


def _public_photo_url(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 16_384:
        raise ValueError("Facebook returned an invalid photo link.")
    parsed = urllib.parse.urlsplit(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    path = parsed.path.lower()
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or not (host.endswith(".fbcdn.net") or host == "fbcdn.net" or host.endswith(".fbsbx.com") or host == "fbsbx.com")
        or "1997-6" in path
        or "/t45." in path
        or "/stickers/" in path
        or "/reactions/" in path
        or "emoji.php" in path
        or "rsrc.php" in path
    ):
        raise ValueError("Facebook returned a photo link outside its public media CDN.")
    return value


def _photo_width(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        raise ValueError("Facebook returned an invalid photo width.")
    if isinstance(value, int):
        width = value
    elif isinstance(value, str) and value.isdecimal():
        try:
            width = int(value)
        except ValueError as error:
            raise ValueError("Facebook returned an invalid photo width.") from error
    else:
        raise ValueError("Facebook returned an invalid photo width.")
    return max(0, min(width, 20_000))


def _get_public_photo(session: requests.Session, url: str) -> requests.Response:
    """Follow only redirects that stay on Facebook's public media CDN."""
    current_url = url
    for redirect_count in range(MAX_REDIRECTS + 1):
        response = session.get(
            current_url,
            headers={"Referer": "https://www.facebook.com/"},
            stream=True,
            timeout=(10, 35),
            allow_redirects=False,
        )
        if response.status_code not in REDIRECT_STATUSES:
            return response
        location = response.headers.get("Location")
        response.close()
        if not location or redirect_count == MAX_REDIRECTS:
            raise RuntimeError("Facebook returned too many or invalid photo redirects.")
        try:
            current_url = _public_photo_url(urllib.parse.urljoin(current_url, location))
        except ValueError as error:
            raise RuntimeError("Facebook redirected a photo outside its public media CDN.") from error
    raise RuntimeError("Facebook returned too many photo redirects.")


def _promote_staging_dir(staging_dir: str, target_dir: str, max_attempts: int = 5) -> None:
    """Atomically promote staging_dir to target_dir with exponential retry on Windows file locks."""
    for attempt in range(max_attempts):
        try:
            os.replace(staging_dir, target_dir)
            return
        except (PermissionError, FileExistsError, OSError) as error:
            winerr = getattr(error, "winerror", None)
            if attempt < max_attempts - 1 and (os.name != "nt" or winerr in (5, 32, 33, 183)):
                time.sleep(0.1 * (2 ** attempt))
                continue
            raise


def download_facebook_photo_manifest(
    manifest: Any,
    output_dir: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    abort_event: Optional[Any] = None,
    target_format: Optional[str] = None,
    quality: str = "best",
    refresh_candidates: Optional[Callable[[str], list[str]]] = None,
) -> dict[str, Any]:
    """Download every unique, guest-visible photo in a validated browser manifest."""
    if not isinstance(manifest, dict):
        raise ValueError("The Facebook photo list is missing or invalid.")
    raw_photos = manifest.get("photos")
    if not isinstance(raw_photos, list) or len(raw_photos) < 1:
        raise RuntimeError("This public Facebook post does not contain downloadable photos.")
    if len(raw_photos) > MAX_PHOTOS:
        raise RuntimeError(f"This Facebook post exposes more than {MAX_PHOTOS} photos; nothing was downloaded.")

    photos: dict[str, dict[str, Any]] = {}
    for item in raw_photos:
        if not isinstance(item, dict):
            raise ValueError("Facebook returned an invalid photo entry.")
        photo_id = item.get("id")
        if not isinstance(photo_id, str) or not PHOTO_ID_RE.fullmatch(photo_id):
            raise ValueError("Facebook returned an invalid photo identifier.")
        photo = {
            "url": _public_photo_url(item.get("url")),
            "width": _photo_width(item.get("width", 0)),
            "alternates": [
                _public_photo_url(url) for url in item.get("alternates", [])[:MAX_RENDITIONS - 1]
            ] if isinstance(item.get("alternates", []), list) else [],
        }
        existing = photos.get(photo_id)
        if existing is None:
            photos[photo_id] = photo
        else:
            candidates = [existing["url"], photo["url"], *existing["alternates"], *photo["alternates"]]
            if photo["width"] > existing["width"]:
                existing["url"], existing["width"] = photo["url"], photo["width"]
            existing["alternates"] = [
                url for url in dict.fromkeys(candidates) if url != existing["url"]
            ][:MAX_RENDITIONS - 1]

    if len(photos) < 1:
        raise RuntimeError("Facebook exposed no unique photos.")

    raw_title = manifest.get("title")
    title = sanitize_filename(raw_title if isinstance(raw_title, str) else "", max_length=60)
    if title == "media_file":
        title = "Facebook Post"
    parent = os.path.abspath(clean_windows_path(output_dir))
    os.makedirs(parent, exist_ok=True)
    target_dir = os.path.join(parent, title)
    suffix = 2
    while os.path.lexists(target_dir):
        target_dir = os.path.join(parent, f"{title} ({suffix})")
        suffix += 1

    supported_formats = set(Image.registered_extensions().values())
    accept = "image/webp,image/png,image/jpeg,image/gif"
    if "AVIF" in supported_formats:
        accept = "image/avif," + accept
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
        ),
        "Accept": accept,
    })
    staging_dir = tempfile.mkdtemp(prefix=".facebook-album-", dir=parent)
    total_bytes = 0
    remaining_refreshes = MAX_RENDITION_REFRESHES
    refreshed_photo_ids: set[str] = set()

    def report(progress: float, message: str) -> None:
        if progress_callback:
            progress_callback(progress, message)

    try:
        for index, (photo_id, photo) in enumerate(photos.items(), start=1):
            if abort_event and abort_event.is_set():
                raise KeyboardInterrupt("Facebook photo download aborted by user.")
            report(0.05 + 0.9 * ((index - 1) / len(photos)), f"Downloading Facebook photo {index} of {len(photos)}...")
            candidates = list(dict.fromkeys([photo["url"], *photo["alternates"]]))[:MAX_RENDITIONS]
            attempted: set[str] = set()
            last_error: Optional[BaseException] = None
            while True:
                candidate = next((url for url in candidates if url not in attempted), None)
                if candidate is None:
                    if (
                        refresh_candidates is not None
                        and remaining_refreshes > 0
                        and photo_id not in refreshed_photo_ids
                    ):
                        remaining_refreshes -= 1
                        refreshed_photo_ids.add(photo_id)
                        refreshed = refresh_candidates(photo_id)
                        if not isinstance(refreshed, list):
                            raise RuntimeError("Facebook returned an invalid rendition refresh response.")
                        fresh_urls = []
                        for url in refreshed[:MAX_RENDITIONS]:
                            try:
                                fresh_urls.append(_public_photo_url(url))
                            except (TypeError, ValueError):
                                continue
                        candidates.extend(url for url in fresh_urls if url not in candidates)
                        continue
                    raise RuntimeError(
                        f"Facebook photo {index} could not be downloaded or decoded from its available renditions. No partial album was saved."
                    ) from last_error
                attempted.add(candidate)
                image_path = os.path.join(staging_dir, f"{title}_{index:03d}.download")
                try:
                    with _get_public_photo(session, candidate) as response:
                        response.raise_for_status()
                        _public_photo_url(response.url)
                        length = response.headers.get("Content-Length")
                        if length and int(length) > MAX_IMAGE_BYTES:
                            raise RuntimeError(f"Facebook photo {index} is larger than the 100 MB per-image limit.")
                        image_bytes = 0
                        with open(image_path, "wb") as image_file:
                            for chunk in response.iter_content(chunk_size=256 * 1024):
                                if abort_event and abort_event.is_set():
                                    raise KeyboardInterrupt("Facebook photo download aborted by user.")
                                if not chunk:
                                    continue
                                image_bytes += len(chunk)
                                total_bytes += len(chunk)
                                if image_bytes > MAX_IMAGE_BYTES:
                                    raise RuntimeError(f"Facebook photo {index} is larger than the 100 MB per-image limit.")
                                if total_bytes > MAX_ALBUM_BYTES:
                                    raise RuntimeError("The Facebook album exceeds the 2 GB total download limit.")
                                image_file.write(chunk)
                    with Image.open(image_path) as image:
                        extension = IMAGE_EXTENSIONS.get(image.format or "")
                        if not extension or image.width < 1 or image.height < 1 or image.width * image.height > 100_000_000:
                            raise ValueError("unsupported image format")
                        image.verify()
                    verified_path = os.path.splitext(image_path)[0] + extension
                    os.replace(image_path, verified_path)
                    convert_image_format(verified_path, target_format, quality)
                    break
                except (requests.RequestException, OSError, ValueError) as error:
                    last_error = error
                    if os.path.exists(image_path):
                        os.remove(image_path)

        _promote_staging_dir(staging_dir, target_dir)
    except requests.RequestException as error:
        raise RuntimeError("Could not download a Facebook photo. The album may have changed or the link may have expired.") from error
    except (OSError, ValueError) as error:
        raise RuntimeError("Could not save or validate one of the Facebook photos.") from error
    finally:
        session.close()
        if os.path.isdir(staging_dir):
            shutil.rmtree(staging_dir, ignore_errors=True)

    report(1.0, f"Saved {'all ' if len(photos) > 1 else ''}{len(photos)} Facebook photo{'s' if len(photos) != 1 else ''}.")
    return {
        "title": title,
        "folder_path": os.path.abspath(target_dir),
        "photo_count": len(photos),
        "total_bytes": total_bytes,
    }


def is_facebook_post_url(value: str) -> bool:
    """Identify if a URL is a Facebook post, share link, permalink, or album."""
    try:
        url = urllib.parse.urlsplit(str(value or "").strip())
        host = (url.hostname or "").lower()
        path = url.path.lower()
        if host in ("fb.watch", "www.fb.watch"):
            return True
        return (host == "facebook.com" or host.endswith(".facebook.com")) and (
            path.startswith("/share/p/")
            or "/permalink" in path
            or "/posts/" in path
            or path.endswith("/story.php")
            or "/photos/" in path
            or "/photo" in path
            or "/media/set" in path
        )
    except Exception:
        return False


def _extract_balanced_json(text: str, start_char: str = "{", end_char: str = "}") -> Optional[str]:
    """Extract a complete balanced JSON object or array from the start of text."""
    if not text or text[0] != start_char:
        return None
    depth = 0
    in_string = False
    escape = False
    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if not in_string:
            if ch == start_char:
                depth += 1
            elif ch == end_char:
                depth -= 1
                if depth == 0:
                    return text[:i + 1]
    return None


def _clean_fb_photo_url(uri: str) -> str:
    """Strip thumbnail / crop clamps (ctp=s...) from Facebook CDN URL to yield full original dimensions."""
    if not uri:
        return ""
    cleaned = re.sub(
        r'([?&])ctp=[^&]*(&)?',
        lambda m: '&' if m.group(1) == '&' and m.group(2) else ('?' if m.group(1) == '?' and m.group(2) else ''),
        uri,
    )
    return cleaned.rstrip('&').rstrip('?')


_CACHED_FB_PAGINATION: dict[str, tuple[str, str]] = {}


def _resolve_facebook_pagination_query(html: str, session: requests.Session) -> tuple[str, str]:
    """Dynamically resolve the current Comet album pagination query name and doc_id.

    Adapts automatically when Facebook rotates frontend Relay query hashes or changes query names.
    Returns (query_name, doc_id).
    """
    cached = _CACHED_FB_PAGINATION.get("resolved")
    if cached:
        return cached

    # 1. Direct match in HTML if rendered inline
    candidate_queries = (
        "CometAlbumPhotoCollagePaginationQuery",
        "ProfileCometLegacyAlbumGridViewPaginationQuery",
        "ProfileCometLegacyAlbumFeedViewPaginationQuery",
    )
    for q_name in candidate_queries:
        m = re.search(
            rf'"{re.escape(q_name)}_facebookRelayOperation"\s*,\s*\[\]\s*,\s*\(function\([^)]*\)\s*\{{[^}}]*"(\d{{15,}})"',
            html,
        )
        if m:
            _CACHED_FB_PAGINATION["resolved"] = (q_name, m.group(1))
            return q_name, m.group(1)

    # 2. Inspect referenced JS bundles for the Relay operation export
    bundle_matches = re.findall(
        r'"url"\s*:\s*"(https:[^"]+)"\s*,\s*"refs"\s*:\s*\[[^\]]*CometPhotoAlbumQueryRelayPreloader[^\]]*\]',
        html,
    ) + re.findall(
        r'"refs"\s*:\s*\[[^\]]*CometPhotoAlbumQueryRelayPreloader[^\]]*\]\s*,\s*"url"\s*:\s*"(https:[^"]+)"',
        html,
    )
    for raw_url in bundle_matches:
        bundle_url = raw_url.replace(r"\/", "/")
        if not (".js" in bundle_url):
            continue
        try:
            resp = session.get(bundle_url, timeout=(5, 10))
            if resp.status_code == 200:
                for q_name in candidate_queries:
                    m = re.search(
                        rf'{re.escape(q_name)}_facebookRelayOperation[^{{]*?\{{a\.exports="(\d{{15,}})"\}}',
                        resp.text,
                    )
                    if m:
                        _CACHED_FB_PAGINATION["resolved"] = (q_name, m.group(1))
                        return q_name, m.group(1)
        except Exception:
            continue

    # 3. Fallback to resilient default
    return "CometAlbumPhotoCollagePaginationQuery", "28559589567041913"


def fetch_facebook_manifest(
    url: str,
    browser: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Optional[dict[str, Any]]:
    """Extract photo metadata from a Facebook post using local browser session cookies."""
    patch_yt_dlp_cookie_database_reader()
    import yt_dlp

    def report(pct: float, msg: str):
        if progress_callback:
            progress_callback(pct, msg)

    raw_browser = str(browser or "").strip().lower()
    if raw_browser in ("none", "disabled", "off", "false", "public", "public only"):
        return None

    report(0.04, "Searching desktop browsers for an active Facebook session...")
    running = detect_running_browsers()
    candidates = get_ordered_browser_candidates(preferred=raw_browser)

    scored_candidates = []
    app_bound_noted = False
    now = time.time()

    for b in candidates:
        try:
            ydl = yt_dlp.YoutubeDL({"cookiesfrombrowser": (b, None, None, None), "quiet": True})
            cand_jar = ydl.cookiejar
            fb_cookies = [c for c in cand_jar if "facebook.com" in getattr(c, "domain", "")]
            auth_cookies = [c for c in fb_cookies if getattr(c, "name", None) in ("c_user", "xs")]
            has_auth = len(auth_cookies) >= 2
            unexpired_auth = [c for c in auth_cookies if getattr(c, "expires", None) is None or c.expires > now]

            score = 0
            if has_auth and len(unexpired_auth) >= 2:
                score += 1000
            elif has_auth:
                score += 500
            elif fb_cookies:
                score += 50

            if fb_cookies and b in running:
                score += 200

            if score > 0:
                scored_candidates.append((score, b, cand_jar))
            elif b in running and b in ("edge", "chrome", "brave"):
                if not app_bound_noted:
                    report(0.05, f"{b.title()} is active, but its session database is protected by Windows App-Bound Encryption.")
                    app_bound_noted = True
        except Exception:
            continue

    jar = None
    found_browser = None
    if scored_candidates:
        scored_candidates.sort(key=lambda x: x[0], reverse=True)
        _, found_browser, jar = scored_candidates[0]

    if not jar or not found_browser:
        report(0.06, "No logged-in Facebook session found in desktop browsers.")
        return None

    report(0.06, f"Connected to Facebook session via {found_browser.title()}. Loading post...")

    session = requests.Session()
    for c in jar:
        if "facebook.com" in getattr(c, "domain", ""):
            session.cookies.set(c.name, c.value, domain=c.domain, path=c.path)

    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    })

    try:
        response = session.get(url, allow_redirects=True, timeout=(10, 25))
    except Exception as exc:
        report(0.08, f"Facebook request failed: {exc}")
        return None

    if response.status_code != 200:
        return None

    final_url = response.url
    if "/login" in final_url.lower():
        report(0.08, f"Facebook redirected to login despite {found_browser.title()} session.")
        return None

    html = response.text
    title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE)
    raw_title = title_match.group(1) if title_match else ""
    raw_title = re.sub(r"\s*[\-\|]\s*Facebook.*$", "", raw_title, flags=re.IGNORECASE).strip()
    title = sanitize_filename(raw_title, max_length=60)
    if not title or title == "media_file":
        og_match = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
        if og_match:
            title = sanitize_filename(og_match.group(1), max_length=60)
    if not title or title == "media_file":
        title = "Facebook Post"

    photos: dict[str, dict[str, Any]] = {}
    has_video = False

    def _add_photo(p_id: str, raw_uri: str, w: int = 0, h: int = 0):
        if not p_id or not p_id.isdigit():
            return
        if not raw_uri or not ("fbcdn.net" in raw_uri or "fbsbx.com" in raw_uri):
            return
        if "/t45." in raw_uri or "1997-6" in raw_uri or "emoji.php" in raw_uri:
            return
        raw_uri = raw_uri.replace("\\/", "/")
        full_uri = _clean_fb_photo_url(raw_uri)
        alts = [raw_uri] if raw_uri != full_uri else []
        width_val = max(w, 1080)
        existing = photos.get(p_id)
        if existing is None:
            photos[p_id] = {
                "id": p_id,
                "url": full_uri,
                "width": width_val,
                "alternates": alts,
            }
        else:
            if width_val > existing["width"]:
                existing["url"] = full_uri
                existing["width"] = width_val
            existing_alts = existing.setdefault("alternates", [])
            for cand in [raw_uri, full_uri]:
                if cand and cand != existing["url"] and cand not in existing_alts:
                    existing_alts.append(cand)

    # Resolve target post identifiers from final_url and original url
    target_post_id = None
    target_fbid = None
    target_mediaset = None

    for candidate_url in (final_url, url):
        if not candidate_url:
            continue
        parsed_cand = urllib.parse.urlsplit(candidate_url)
        cand_qs = urllib.parse.parse_qs(parsed_cand.query)

        m_group = re.search(r'/groups/[^/]+/(?:permalink|posts)/(\d+)', parsed_cand.path)
        if m_group and not target_post_id:
            target_post_id = m_group.group(1)
        m_posts = re.search(r'/posts/([^/?&#]+)', parsed_cand.path)
        if m_posts and not target_post_id:
            target_post_id = m_posts.group(1)
        if "story_fbid" in cand_qs and not target_post_id:
            target_post_id = cand_qs["story_fbid"][0]
        if "fbid" in cand_qs and not target_fbid:
            target_fbid = cand_qs["fbid"][0]
        if "set" in cand_qs and not target_mediaset:
            target_mediaset = cand_qs["set"][0]

    if not target_post_id:
        st_match = re.search(r'"story_token"\s*:\s*"([^"]+)"', html)
        if st_match:
            target_post_id = st_match.group(1)
        else:
            share_token_m = re.search(r'/share/[pv]/([^/?&#]+)', url)
            if share_token_m:
                tok = share_token_m.group(1)
                idx = html.find(tok)
                if idx != -1:
                    ctx = html[max(0, idx - 1000):min(len(html), idx + 1000)]
                    p_m = re.search(r'posts[\\/]+([^/?&#"\\]+)', ctx)
                    if p_m:
                        target_post_id = p_m.group(1)

    # Find scoped JSON blocks belonging specifically to the target post
    target_blocks: list[str] = []
    if target_post_id:
        for m in re.finditer(re.escape(target_post_id), html, re.IGNORECASE):
            pos = m.start()
            chunk_back = html[max(0, pos - 15000):pos]
            story_start = -1
            for marker in (
                '"__typename":"Story"',
                'adp_CometSinglePostDialogContentQuery',
                'adp_CometGroupPermalinkFeedRoot',
                'CometFeedStoryDefaultContentStrategy',
            ):
                idx = chunk_back.rfind(marker)
                if idx != -1:
                    story_start = max(0, pos - 15000 + idx)
                    break
            if story_start != -1:
                brace_pos = html.rfind('{', max(0, story_start - 200), story_start + 1)
                if brace_pos != -1:
                    json_str = _extract_balanced_json(html[brace_pos:], '{', '}')
                    if json_str and (target_post_id in json_str or target_post_id.lower() in json_str.lower()) and json_str not in target_blocks:
                        target_blocks.append(json_str)

    # Refine title if target post has a specific author or message
    for b in target_blocks:
        author_m = re.search(r'"(?:owning_profile|actors)"\s*:\s*(?:\[\s*)?\{[^{}]*?"name"\s*:\s*"([^"]+)"', b)
        if author_m:
            try:
                author_name = sanitize_filename(author_m.group(1).encode().decode('unicode-escape'), max_length=50)
                if author_name and author_name not in title:
                    title = f"{title} - {author_name}" if title != "Facebook Post" else author_name
            except Exception:
                pass
            break

    # Determine valid mediaset_token scoped strictly to target post
    valid_mediaset = None
    if target_mediaset:
        valid_mediaset = target_mediaset
    elif target_post_id:
        for b in target_blocks:
            m_token = re.search(r'"mediaset_token"\s*:\s*"([^"]+)"', b)
            if m_token:
                valid_mediaset = m_token.group(1)
                break
        if not valid_mediaset:
            for m in re.finditer(re.escape(target_post_id), html, re.IGNORECASE):
                window = html[max(0, m.start() - 2500):min(len(html), m.start() + 2500)]
                m_tok = re.search(r'"mediaset_token"\s*:\s*"([^"]+)"', window)
                if m_tok:
                    valid_mediaset = m_tok.group(1)
                    break
        if not valid_mediaset:
            m_set = re.search(rf'set=((?:gm|pcb)\.{re.escape(target_post_id)})', html, re.IGNORECASE)
            if m_set:
                valid_mediaset = m_set.group(1)
    elif not target_post_id:
        m_token = re.search(r'"mediaset_token"\s*:\s*"([^"]+)"', html)
        if m_token:
            valid_mediaset = m_token.group(1)

    # 1. Check for complete album via valid_mediaset
    if valid_mediaset:
        target_album_url = f"https://www.facebook.com/media/set/?set={valid_mediaset}"
        album_html = html if final_url.lower().startswith(target_album_url.lower()) else None
        if album_html is None:
            try:
                report(0.07, "Loading complete Facebook album...")
                a_resp = session.get(target_album_url, allow_redirects=True, timeout=(10, 25))
                if a_resp.status_code == 200 and len(a_resp.text) > 100:
                    album_html = a_resp.text
            except Exception:
                pass
        if album_html:
            edges_match = re.search(r'"media"\s*:\s*\{"edges"\s*:\s*(\[)', album_html)
            if edges_match:
                start_pos = edges_match.start(1)
                arr_str = _extract_balanced_json(album_html[start_pos:], "[", "]")
                if arr_str:
                    try:
                        edges = json.loads(arr_str)
                        for edge in edges:
                            node = edge.get("node") or {}
                            if node.get("is_playable") or node.get("__typename") == "Video":
                                has_video = True
                            p_id = str(node.get("id") or "").strip()
                            img = node.get("image") or {}
                            raw_uri = img.get("uri") or ""
                            w = int(img.get("width") or 0)
                            h = int(img.get("height") or 0)
                            _add_photo(p_id, raw_uri, w, h)
                    except Exception:
                        pass

                    # Paginate remaining album photos via Comet GraphQL
                    try:
                        end_of_arr = start_pos + len(arr_str)
                        trailing_chunk = album_html[end_of_arr : end_of_arr + 1000]
                        page_info_match = re.search(r'"page_info"\s*:\s*\{([^}]+)\}', trailing_chunk)
                        cursor = None
                        has_next = False
                        if page_info_match:
                            pi = json.loads("{" + page_info_match.group(1) + "}")
                            cursor = pi.get("end_cursor")
                            has_next = bool(pi.get("has_next_page"))

                        id_m = re.search(r'"id"\s*:\s*"([^"]+)"', trailing_chunk)
                        album_node_id = id_m.group(1) if id_m else None
                        if not album_node_id and valid_mediaset:
                            album_node_id = base64.b64encode(f"mediaset:{valid_mediaset}".encode()).decode()

                        dtsg_m = (
                            re.search(r'"DTSGInitialData"[^>]*?\{"token"\s*:\s*"([^"]+)"', album_html)
                            or re.search(r'"DTSGInitialData"[^>]*?\{"token"\s*:\s*"([^"]+)"', html)
                            or re.search(r'"token":"([a-zA-Z0-9_\-:]+)"', album_html)
                            or re.search(r'"token":"([a-zA-Z0-9_\-:]+)"', html)
                        )
                        fb_dtsg = dtsg_m.group(1) if dtsg_m else None

                        user_m = (
                            re.search(r'__user=(\d+)', album_html)
                            or re.search(r'"USER_ID":"(\d+)"', album_html)
                            or re.search(r'"actorID":"(\d+)"', album_html)
                        )
                        user_id = user_m.group(1) if user_m else "0"
                        jazoest = f"2{sum(ord(c) for c in fb_dtsg)}" if fb_dtsg else "25474"

                        query_name, doc_id = _resolve_facebook_pagination_query(album_html, session)

                        hs_m = re.search(r'"haste_session"\s*:\s*"([^"]+)"', album_html) or re.search(r'__hs=([^&"\']+)', album_html)
                        haste_session = hs_m.group(1) if hs_m else "19738.HYP:comet_pkg.2.1..0.0"
                        rev_m = re.search(r'"server_revision"\s*:\s*(\d+)', album_html) or re.search(r'"__spin_r"\s*:\s*(\d+)', album_html)
                        server_rev = str(rev_m.group(1)) if rev_m else "1019000000"
                        hsi_m = re.search(r'"hsi"\s*:\s*"([^"]+)"', album_html) or re.search(r'"__hsi"\s*:\s*"([^"]+)"', album_html)
                        hsi_val = hsi_m.group(1) if hsi_m else None

                        page = 1
                        while has_next and cursor and album_node_id and fb_dtsg and len(photos) < MAX_PHOTOS and page <= 50:
                            page += 1
                            report(0.07, f"Loading Facebook album photos (found {len(photos)} so far)...")
                            payload = {
                                "av": user_id,
                                "__user": user_id,
                                "__a": "1",
                                "__req": str(page),
                                "__hs": haste_session,
                                "dpr": "1",
                                "__ccg": "EXCELLENT",
                                "__rev": server_rev,
                                "__comet_req": "15",
                                "fb_dtsg": fb_dtsg,
                                "jazoest": jazoest,
                                "fb_api_caller_class": "RelayModern",
                                "fb_api_req_friendly_name": query_name,
                                "variables": json.dumps({
                                    "count": 50,
                                    "cursor": cursor,
                                    "id": album_node_id,
                                    "renderLocation": "permalink",
                                    "scale": 1,
                                    "__relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider": True,
                                }),
                                "doc_id": doc_id,
                            }
                            if hsi_val:
                                payload["__hsi"] = hsi_val

                            graphql_resp = session.post(
                                "https://www.facebook.com/api/graphql/",
                                data=payload,
                                timeout=(10, 25),
                                headers={
                                    "Origin": "https://www.facebook.com",
                                    "Referer": target_album_url,
                                    "Sec-Fetch-Dest": "empty",
                                    "Sec-Fetch-Mode": "cors",
                                    "Sec-Fetch-Site": "same-origin",
                                },
                            )
                            if graphql_resp.status_code != 200:
                                break
                            res_data = graphql_resp.json()
                            node = res_data.get("data", {}).get("node", {}) if isinstance(res_data, dict) else {}
                            media = node.get("media", {}) if isinstance(node, dict) else {}
                            edges = media.get("edges", []) if isinstance(media, dict) else []
                            if not edges:
                                # Invalidate cache if query was rejected
                                if isinstance(res_data, dict) and res_data.get("errors"):
                                    _CACHED_FB_PAGINATION.clear()
                                break
                            new_count = 0
                            for edge in edges:
                                edge_node = edge.get("node") or {}
                                if edge_node.get("is_playable") or edge_node.get("__typename") == "Video":
                                    has_video = True
                                p_id = str(edge_node.get("id") or "").strip()
                                img = edge_node.get("image") or {}
                                raw_uri = img.get("uri") or ""
                                w = int(img.get("width") or 0)
                                h = int(img.get("height") or 0)
                                if p_id and p_id not in photos:
                                    new_count += 1
                                _add_photo(p_id, raw_uri, w, h)
                            if new_count == 0:
                                break
                            pi = media.get("page_info", {}) if isinstance(media, dict) else {}
                            has_next = bool(pi.get("has_next_page"))
                            cursor = pi.get("end_cursor")
                    except Exception:
                        pass

    # 2. Inspect subattachments and attachments inside scoped target blocks (or fallback to global)
    if not photos:
        scoped_search_blocks = target_blocks if target_blocks else [html]

        for b in scoped_search_blocks:
            for m in re.finditer(r'"all_subattachments"\s*:\s*(\{)', b):
                start_pos = m.start(1)
                obj_str = _extract_balanced_json(b[start_pos:], "{", "}")
                if obj_str:
                    try:
                        data = json.loads(obj_str)
                        nodes = data.get("nodes") or []
                        for n in nodes:
                            media = n.get("media") or {}
                            if media.get("is_playable") or media.get("__typename") == "Video":
                                has_video = True
                            p_id = str(media.get("id") or n.get("deduplication_key") or "").strip()
                            viewer_img = media.get("viewer_image") or {}
                            img = media.get("image") or media.get("photo_image") or {}
                            raw_uri = viewer_img.get("uri") or img.get("uri") or ""
                            w = int(viewer_img.get("width") or img.get("width") or 0)
                            h = int(viewer_img.get("height") or img.get("height") or 0)
                            _add_photo(p_id, raw_uri, w, h)
                        if photos and target_blocks:
                            break
                    except Exception:
                        pass

    if not photos:
        for b in scoped_search_blocks:
            for m in re.finditer(r'"attachments"\s*:\s*(\[)', b):
                start_pos = m.start(1)
                arr_str = _extract_balanced_json(b[start_pos:], "[", "]")
                if arr_str:
                    try:
                        attachments = json.loads(arr_str)
                        for att in attachments:
                            media_candidates = [
                                att.get("media") or {},
                                att.get("styles", {}).get("attachment", {}).get("media") or {},
                            ]
                            for media in media_candidates:
                                if media.get("is_playable") or media.get("__typename") == "Video":
                                    has_video = True
                                p_id = str(media.get("id") or att.get("target", {}).get("id") or "").strip()
                                viewer_img = media.get("viewer_image") or {}
                                img = media.get("image") or media.get("photo_image") or {}
                                raw_uri = viewer_img.get("uri") or img.get("uri") or ""
                                w = int(viewer_img.get("width") or img.get("width") or 0)
                                h = int(viewer_img.get("height") or img.get("height") or 0)
                                if p_id and raw_uri:
                                    _add_photo(p_id, raw_uri, w, h)
                        if photos and target_blocks:
                            break
                    except Exception:
                        pass

    # 4. If URL requested a specific fbid (e.g. photo.php?fbid=...)
    if target_fbid and target_fbid in photos:
        photos = {target_fbid: photos[target_fbid]}
    elif target_fbid and not photos:
        try:
            pattern = rf'"id"\s*:\s*"{target_fbid}"'
            for m in re.finditer(pattern, html):
                context = html[max(0, m.start() - 500):min(len(html), m.end() + 1500)]
                uri_m = re.search(r'"(?:viewer_image|image|photo_image)"\s*:\s*\{[^}]*?"uri"\s*:\s*"(https:[^"]*?(?:fbcdn\.net|fbsbx\.com)[^"]*?)"', context)
                if uri_m:
                    raw_uri = uri_m.group(1).encode().decode("unicode-escape").replace("\\/", "/")
                    w_m = re.search(r'"width"\s*:\s*(\d+)', context)
                    w = int(w_m.group(1)) if w_m else 1080
                    _add_photo(target_fbid, raw_uri, w)
                    if photos:
                        break
        except Exception:
            pass

    if not photos:
        if has_video or '"playable_url"' in html or '"video_id"' in html:
            return {"platform": "facebook", "title": title, "photos": [], "media_kind": "video"}
        return None

    report(0.08, f"Found {len(photos)} photos in '{title}'. Starting download...")
    return {
        "platform": "facebook",
        "title": title,
        "photos": list(photos.values()),
        "media_kind": "photo",
    }

