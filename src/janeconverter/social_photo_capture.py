"""Download public photo URLs collected from isolated social collection pages."""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

import requests
from PIL import Image

from .cookie_unlocker import patch_yt_dlp_cookie_database_reader
from .extractor import clean_windows_path, sanitize_filename
from .image_format import convert_image_format
from .paths import get_temp_dir


MAX_PHOTOS = 500
MAX_IMAGE_BYTES = 100 * 1024 * 1024
MAX_ALBUM_BYTES = 2 * 1024 * 1024 * 1024
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
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
MAX_REDIRECTS = 5
MEDIA_HOSTS = {
    "instagram": ("cdninstagram.com", "fbcdn.net", "fbsbx.com"),
    "twitter": ("pbs.twimg.com",),
    "tiktok": ("tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "ibyteimg.com", "ibytedtos.com"),
    "reddit": ("redd.it", "redditmedia.com"),
    "tumblr": ("media.tumblr.com",),
    "pinterest": ("pinimg.com",),
}
PLATFORM_LABELS = {
    "instagram": "Instagram",
    "twitter": "X/Twitter",
    "tiktok": "TikTok",
    "reddit": "Reddit",
    "tumblr": "Tumblr",
    "pinterest": "Pinterest",
}


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


def _media_url(value: Any, platform: str) -> str:
    if not isinstance(value, str) or len(value) > 16_384:
        raise ValueError(f"{platform} returned an invalid photo link.")
    parsed = urllib.parse.urlsplit(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    allowed = MEDIA_HOSTS.get(platform, ())
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or not any(host == suffix or host.endswith("." + suffix) for suffix in allowed)
    ):
        raise ValueError(f"{platform} returned a photo link outside its public media CDN.")
    return value


def _photo_width(value: Any, platform: str) -> int:
    label = PLATFORM_LABELS[platform]
    if value is None:
        return 0
    if isinstance(value, bool):
        raise ValueError(f"{label} returned an invalid photo width.")
    if isinstance(value, int):
        width = value
    elif isinstance(value, str) and value.isdecimal():
        try:
            width = int(value)
        except ValueError as error:
            raise ValueError(f"{label} returned an invalid photo width.") from error
    else:
        raise ValueError(f"{label} returned an invalid photo width.")
    return max(0, min(width, 20_000))


def _pinterest_candidate_urls(url: str) -> list[str]:
    match = re.match(
        r"^(https://[a-zA-Z0-9.-]*pinimg\.com)/(?:originals|\d+x)/([^?#]+?)(?:\.([a-zA-Z0-9]+))?([?#].*)?$",
        url,
        re.IGNORECASE,
    )
    if not match:
        return [url]
    origin, path, ext = match.group(1), match.group(2), (match.group(3) or "").lower()
    candidates: list[str] = []

    def _add(cand: str) -> None:
        if cand not in candidates:
            candidates.append(cand)

    if ext:
        _add(f"{origin}/originals/{path}.{ext}")
        for alt_ext in ("png", "jpg", "gif", "webp"):
            _add(f"{origin}/originals/{path}.{alt_ext}")
    else:
        _add(f"{origin}/originals/{path}")
        for alt_ext in ("png", "jpg", "gif", "webp"):
            _add(f"{origin}/originals/{path}.{alt_ext}")

    ext_suffix = f".{ext}" if ext else ".jpg"
    for bucket in ("1200x", "736x", "564x", "474x"):
        _add(f"{origin}/{bucket}/{path}{ext_suffix}")

    _add(url)
    return candidates


def _fetch_single_photo(session: requests.Session, url: str, platform: str) -> requests.Response:
    current_url = url
    for redirect_count in range(MAX_REDIRECTS + 1):
        response = session.get(
            current_url,
            headers={"Referer": f"https://www.{platform}.com/"},
            stream=True,
            timeout=(10, 35),
            allow_redirects=False,
        )
        if response.status_code not in REDIRECT_STATUSES:
            return response
        location = response.headers.get("Location")
        response.close()
        if not location or redirect_count == MAX_REDIRECTS:
            raise RuntimeError(f"{platform} returned too many or invalid photo redirects.")
        try:
            current_url = _media_url(urllib.parse.urljoin(current_url, location), platform)
        except ValueError as error:
            raise RuntimeError(f"{platform} redirected a photo outside its public media CDN.") from error
    raise RuntimeError(f"{platform} returned too many photo redirects.")


def _get_photo(session: requests.Session, url: str, platform: str) -> requests.Response:
    if platform == "pinterest":
        candidates = _pinterest_candidate_urls(url)
        last_candidate = candidates[-1]
        for candidate in candidates[:-1]:
            try:
                response = _fetch_single_photo(session, candidate, platform)
                if response.status_code == 200:
                    return response
                response.close()
            except requests.RequestException:
                pass
        return _fetch_single_photo(session, last_candidate, platform)
    return _fetch_single_photo(session, url, platform)


def download_social_photo_manifest(
    manifest: Any,
    output_dir: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    abort_event: Optional[Any] = None,
    target_format: Optional[str] = None,
    quality: str = "best",
) -> dict[str, Any]:
    """Save every unique public photo in an Instagram or X browser manifest."""
    if not isinstance(manifest, dict):
        raise ValueError("The public photo list is missing or invalid.")
    platform_key = manifest.get("platform")
    if platform_key not in MEDIA_HOSTS:
        raise ValueError("The public photo list has an unsupported platform.")
    platform = PLATFORM_LABELS[platform_key]
    raw_photos = manifest.get("photos")
    if not isinstance(raw_photos, list) or not raw_photos:
        raise RuntimeError(f"No {platform} photos were available to download.")
    if len(raw_photos) > MAX_PHOTOS:
        raise RuntimeError(f"This {platform} post exposes more than {MAX_PHOTOS} photos; nothing was downloaded.")

    photos: dict[str, dict[str, Any]] = {}
    for item in raw_photos:
        if not isinstance(item, dict):
            raise ValueError(f"{platform} returned an invalid photo entry.")
        photo_id = item.get("id")
        if not isinstance(photo_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", photo_id):
            raise ValueError(f"{platform} returned an invalid photo identifier.")
        photo = {
            "url": _media_url(item.get("url"), platform_key),
            "width": _photo_width(item.get("width", 0), platform_key),
        }
        existing = photos.get(photo_id)
        if existing is None or photo["width"] > existing["width"]:
            photos[photo_id] = photo
    if not photos:
        raise RuntimeError(f"No {platform} photos were available to download.")

    raw_title = manifest.get("title")
    title = sanitize_filename(raw_title if isinstance(raw_title, str) else "", max_length=60)
    if title == "media_file":
        title = f"{platform} Post"
    parent = os.path.abspath(clean_windows_path(output_dir))
    os.makedirs(parent, exist_ok=True)
    target_dir = os.path.join(parent, title)
    suffix = 2
    while os.path.lexists(target_dir):
        target_dir = os.path.join(parent, f"{title} ({suffix})")
        suffix += 1

    print(f"Target Directory: {target_dir}", flush=True)
    print(f"[*] Found {len(photos)} photos in '{title}'", flush=True)
    for p_idx, p_obj in enumerate(photos.values(), start=1):
        if isinstance(p_obj, dict) and p_obj.get("url"):
            print(f"[*] Photo #{p_idx} Source: {p_obj['url']}", flush=True)

    session = requests.Session()
    if hasattr(session, "mount"):
        try:
            adapter = requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=16)
            session.mount("https://", adapter)
            session.mount("http://", adapter)
        except Exception:
            pass
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
        ),
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    })
    os.makedirs(target_dir, exist_ok=True)
    staging_base = os.path.join(get_temp_dir(), "staging")
    os.makedirs(staging_base, exist_ok=True)
    staging_dir = tempfile.mkdtemp(prefix=f".{platform_key}-photos-", dir=staging_base)
    total_bytes = 0
    completed_count = 0
    lock = threading.Lock()
    disk_write_lock = threading.Lock()
    stop_event = threading.Event()

    def report(progress: float, message: str) -> None:
        if progress_callback:
            progress_callback(progress, message)

    def download_and_process(item: tuple[int, dict[str, Any]]) -> None:
        nonlocal total_bytes, completed_count
        index, photo = item
        if stop_event.is_set() or (abort_event and abort_event.is_set()):
            raise KeyboardInterrupt(f"{platform} photo download aborted by user.")
        with _get_photo(session, photo["url"], platform_key) as response:
            response.raise_for_status()
            _media_url(response.url, platform_key)
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_IMAGE_BYTES:
                raise RuntimeError(f"{platform} photo {index} is larger than the 100 MB per-image limit.")
            download_path = os.path.join(staging_dir, f"{title}_{index:03d}.download")
            image_bytes = 0
            with open(download_path, "wb") as image_file:
                for chunk in response.iter_content(chunk_size=256 * 1024):
                    if stop_event.is_set() or (abort_event and abort_event.is_set()):
                        raise KeyboardInterrupt(f"{platform} photo download aborted by user.")
                    if not chunk:
                        continue
                    image_bytes += len(chunk)
                    with lock:
                        total_bytes += len(chunk)
                        if total_bytes > MAX_ALBUM_BYTES:
                            raise RuntimeError(f"The {platform} post exceeds the 2 GB total download limit.")
                    if image_bytes > MAX_IMAGE_BYTES:
                        raise RuntimeError(f"{platform} photo {index} is larger than the 100 MB per-image limit.")
                    image_file.write(chunk)
            try:
                with Image.open(download_path) as image:
                    extension = IMAGE_EXTENSIONS.get(image.format or "")
                    if not extension or image.width < 1 or image.height < 1 or image.width * image.height > 100_000_000:
                        raise RuntimeError(f"{platform} returned an unsupported image format for photo {index}.")
                    image.verify()
            except (OSError, ValueError) as error:
                raise RuntimeError(f"{platform} returned a non-image response for photo {index}.") from error
            image_path = os.path.join(staging_dir, f"{title}_{index:03d}{extension}")
            os.replace(download_path, image_path)
            final_path = convert_image_format(image_path, target_format, quality)
            final_filename = os.path.basename(final_path)
            final_target_path = os.path.join(target_dir, final_filename)
            with disk_write_lock:
                shutil.move(final_path, final_target_path)
            print(f"[+] Saved photo: {index}. {final_filename}", flush=True)
            print(f"[*] Photo #{index} Saved: {final_target_path}", flush=True)
            with lock:
                completed_count += 1
                report(0.05 + 0.9 * (completed_count / len(photos)), f"Downloading {platform} photo {completed_count} of {len(photos)}...")

    max_workers = min(4, len(photos))
    try:
        if max_workers <= 1:
            for item in enumerate(photos.values(), start=1):
                download_and_process(item)
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(download_and_process, item) for item in enumerate(photos.values(), start=1)]
                for future in concurrent.futures.as_completed(futures):
                    try:
                        future.result()
                    except Exception:
                        stop_event.set()
                        for f in futures:
                            f.cancel()
                        raise
    except KeyboardInterrupt:
        if completed_count > 0:
            print(f"[*] Partial album saved with {completed_count} photos: {target_dir}", flush=True)
        raise
    except requests.RequestException as error:
        if os.path.isdir(target_dir):
            shutil.rmtree(target_dir, ignore_errors=True)
        raise RuntimeError(f"Could not download a {platform} photo. The post may have changed or the link may have expired.") from error
    except (OSError, ValueError) as error:
        if os.path.isdir(target_dir):
            shutil.rmtree(target_dir, ignore_errors=True)
        raise RuntimeError(f"Could not save or validate one of the {platform} photos.") from error
    except Exception:
        if os.path.isdir(target_dir):
            shutil.rmtree(target_dir, ignore_errors=True)
        raise
    finally:
        session.close()
        if os.path.isdir(staging_dir):
            shutil.rmtree(staging_dir, ignore_errors=True)
        if completed_count == 0 and os.path.isdir(target_dir):
            try:
                if not os.listdir(target_dir):
                    os.rmdir(target_dir)
            except OSError:
                pass

    report(1.0, f"Saved all {len(photos)} {platform} photos.")
    return {
        "title": title,
        "folder_path": os.path.abspath(target_dir),
        "photo_count": len(photos),
        "total_bytes": total_bytes,
    }


def resolve_pinterest_shortlink(url: str, timeout: float = 8.0) -> str:
    """Expand pin.it shortlinks to their full Pinterest destination URL safely hop-by-hop."""
    try:
        raw = str(url or "").strip()
        parsed = urllib.parse.urlparse(raw)
        if (parsed.hostname or "").lower() == "pin.it":
            from .extractor import _is_safe_public_url

            current_url = raw
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
            }
            with requests.Session() as session:
                for _ in range(MAX_REDIRECTS):
                    if not _is_safe_public_url(current_url):
                        return url
                    resp = session.head(
                        current_url,
                        headers=headers,
                        timeout=timeout,
                        allow_redirects=False,
                    )
                    try:
                        if resp.status_code == 405:
                            resp.close()
                            resp = session.get(
                                current_url,
                                headers=headers,
                                timeout=timeout,
                                allow_redirects=False,
                                stream=True,
                            )
                        if resp.status_code in REDIRECT_STATUSES:
                            loc = resp.headers.get("Location")
                            if not loc:
                                break
                            current_url = urllib.parse.urljoin(current_url, loc)
                        else:
                            if _is_safe_public_url(current_url):
                                return current_url
                            return url
                    finally:
                        resp.close()
                if _is_safe_public_url(current_url):
                    return current_url
    except Exception:
        pass
    return url


def is_pinterest_collection_url(url: str) -> bool:
    """Identify if a URL is a Pinterest notification, news_hub, or multi-pin-share collection."""
    try:
        raw = str(url or "").strip()
        parsed = urllib.parse.urlparse(raw)
        host = (parsed.hostname or "").lower()
        if host == "pin.it":
            resolved = resolve_pinterest_shortlink(raw)
            if resolved != raw:
                return is_pinterest_collection_url(resolved)
            return False
        if not (host == "pinterest.com" or host.endswith(".pinterest.com")):
            return False
        path = parsed.path.lower()
        return bool(re.search(r"^/(?:news_hub|notifications|multi-pin-share)/\d+", path))
    except Exception:
        return False


def is_pinterest_newshub_url(url: str) -> bool:
    """Backward-compatible alias for is_pinterest_collection_url."""
    return is_pinterest_collection_url(url)


def is_pinterest_pin_url(url: str) -> bool:
    """Identify if a URL is an individual Pinterest pin."""
    try:
        raw = str(url or "").strip()
        parsed = urllib.parse.urlparse(raw)
        host = (parsed.hostname or "").lower()
        if host == "pin.it":
            resolved = resolve_pinterest_shortlink(raw)
            if resolved != raw:
                return is_pinterest_pin_url(resolved)
            return False
        if not (host == "pinterest.com" or host.endswith(".pinterest.com")):
            return False
        path = parsed.path.lower()
        return bool(re.search(r"^/(?:[a-z]{2}/)?pin/\d+", path))
    except Exception:
        return False


def _fetch_public_pinterest_pin(
    pin_id: str,
    report: Optional[Callable[[float, str], None]] = None,
) -> Optional[dict[str, Any]]:
    """Fast guest probe for a single Pinterest pin without opening or decrypting local browser databases."""
    if report:
        report(0.04, "Reading public Pinterest pin metadata...")
    req = urllib.request.Request(
        f"https://www.pinterest.com/pin/{pin_id}/",
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        if re.search(r'property=["\']og:type["\'][^>]+content=["\']video', html) or re.search(r'content=["\']video[^"\']*["\'][^>]+property=["\']og:type["\']', html):
            return {"platform": "pinterest", "media_kind": "video", "title": f"Pinterest Pin {pin_id}"}
        m_img = re.search(r'id=["\']pin-image-preload["\'][^>]+href=["\']([^"\']+)["\']', html)
        if not m_img:
            m_img = re.search(r'content=["\'](https://i\.pinimg\.com/[^"\']+)["\'][^>]+(?:name|property)=["\']og:image["\']', html)
        if not m_img:
            m_img = re.search(r'(?:name|property)=["\']og:image["\'][^>]+content=["\'](https://i\.pinimg\.com/[^"\']+)["\']', html)
        if m_img:
            img_url = m_img.group(1)
            orig_url = re.sub(r"/\d+x(?:\d+|_RS)?/", "/originals/", img_url)
            m_title = re.search(r'content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\']og:title["\']', html)
            if not m_title:
                m_title = re.search(r'(?:name|property)=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html)
            raw_title = m_title.group(1) if m_title else f"Pinterest Pin {pin_id}"
            clean_title = sanitize_filename(raw_title[:60], max_length=60) or f"Pinterest Pin {pin_id}"
            if report:
                report(0.08, f"Found photo in '{clean_title}'. Starting download...")
            return {
                "platform": "pinterest",
                "title": clean_title,
                "photos": [{
                    "id": pin_id,
                    "url": orig_url,
                    "title": raw_title[:80],
                    "width": 1200,
                }],
                "media_kind": "photo",
            }
    except Exception:
        pass
    return None


def fetch_pinterest_collection_manifest(
    url: str,
    browser: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> dict[str, Any]:
    """Extract photos from a signed-in Pinterest collection (news_hub, notifications, or multi-pin-share) or single pin."""
    patch_yt_dlp_cookie_database_reader()
    import yt_dlp

    def report(pct: float, msg: str):
        if progress_callback:
            progress_callback(pct, msg)

    expanded_url = resolve_pinterest_shortlink(url)
    parsed = urllib.parse.urlparse(expanded_url)
    host = (parsed.hostname or "").lower()
    if not (host == "pinterest.com" or host.endswith(".pinterest.com")):
        raise ValueError(f"Invalid Pinterest media URL: {url}")
    domain = host if host != "pinterest.com" else "www.pinterest.com"

    mps_match = re.search(r"/multi-pin-share/(\d+)", expanded_url)
    news_match = re.search(r"/(?:news_hub|notifications)/(\d+)", expanded_url)
    pin_match = re.search(r"/(?:[a-z]{2}/)?pin/(\d+)", expanded_url)

    if not mps_match and not news_match and not pin_match:
        raise ValueError(f"Invalid Pinterest media URL: {url}")

    preferred = [browser] if browser and browser.lower() not in ("none", "auto", "public", "public only") else []

    # Fast guest path: single Pinterest pins are public and resolve in ~200ms without inspecting local browser databases
    if pin_match and not preferred:
        fast_manifest = _fetch_public_pinterest_pin(pin_match.group(1), report=report)
        if fast_manifest:
            return fast_manifest

    report(0.04, "Searching desktop browsers for an active Pinterest session...")
    preferred = [browser] if browser and browser.lower() not in ("none", "auto", "public", "public only") else []
    candidates = preferred + [b for b in ("vivaldi", "firefox", "chrome", "edge", "brave", "opera") if b not in preferred]

    jar = None
    found_browser = None
    for b in candidates:
        try:
            ydl = yt_dlp.YoutubeDL({"cookiesfrombrowser": (b, None, None, None), "quiet": True})
            candidate_jar = ydl.cookiejar
            p_cookies = [c for c in candidate_jar if "pinterest" in getattr(c, "domain", "")]
            if p_cookies and any(getattr(c, "name", None) in ("_pinterest_sess", "_auth") for c in p_cookies):
                jar = candidate_jar
                found_browser = b
                break
        except Exception:
            continue

    opener = None
    csrf = ""
    headers_base = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": expanded_url,
        "Accept": "application/json, text/javascript, */*, q=0.01",
    }

    if jar:
        report(0.06, f"Connected to Pinterest session via {found_browser.title()}. Requesting media...")
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        for c in jar:
            if getattr(c, "name", None) == "csrftoken" and "pinterest" in getattr(c, "domain", ""):
                csrf = c.value
        headers_base.update({
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRFToken": csrf,
        })
    elif not pin_match:
        raise RuntimeError(
            "Could not read an active Pinterest session from your desktop browsers. "
            "Ensure you are logged into Pinterest in Vivaldi, Firefox, or Chrome."
        )

    if pin_match:
        pin_id = pin_match.group(1)
        if jar and opener:
            try:
                payload_pins = {
                    "options": {
                        "url": "/v3/pins/",
                        "data": {"pin_ids": [pin_id]},
                    },
                    "context": {},
                }
                api_url_pins = f"https://{domain}/resource/ApiResource/get/?data={urllib.parse.quote(json.dumps(payload_pins))}"
                req_pins = urllib.request.Request(
                    api_url_pins,
                    headers={**headers_base, "X-Pinterest-PWS-Handler": "www/multi-pin-share/[id].js"},
                )
                resp = opener.open(req_pins)
                data_pins = json.loads(resp.read().decode("utf-8"))
                pins_data = data_pins.get("resource_response", {}).get("data", [])
                if pins_data:
                    p = pins_data[0]
                    if p.get("videos"):
                        return {"platform": "pinterest", "media_kind": "video", "title": f"Pinterest Pin {pin_id}"}
                    img = p.get("image_large_url") or p.get("image_medium_url") or p.get("image_square_url")
                    if img:
                        orig_url = re.sub(r"/\d+x(?:\d+|_RS)?/", "/originals/", img)
                        title = (p.get("title") or p.get("description") or f"Pinterest Pin {pin_id}").strip()
                        clean_title = sanitize_filename(title[:60], max_length=60) or f"Pinterest Pin {pin_id}"
                        report(0.08, f"Found photo in '{clean_title}'. Starting download...")
                        return {
                            "platform": "pinterest",
                            "title": clean_title,
                            "photos": [{
                                "id": pin_id,
                                "url": orig_url,
                                "title": title[:80],
                                "width": 1200,
                            }],
                            "media_kind": "photo",
                        }
            except Exception:
                pass

        # Public HTML fallback for single pin
        report(0.06, "Reading public Pinterest pin metadata...")
        req = urllib.request.Request(
            f"https://www.pinterest.com/pin/{pin_id}/",
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
            if re.search(r'property=["\']og:type["\'][^>]+content=["\']video', html) or re.search(r'content=["\']video[^"\']*["\'][^>]+property=["\']og:type["\']', html):
                return {"platform": "pinterest", "media_kind": "video", "title": f"Pinterest Pin {pin_id}"}
            m_img = re.search(r'id=["\']pin-image-preload["\'][^>]+href=["\']([^"\']+)["\']', html)
            if not m_img:
                m_img = re.search(r'content=["\'](https://i\.pinimg\.com/[^"\']+)["\'][^>]+(?:name|property)=["\']og:image["\']', html)
            if not m_img:
                m_img = re.search(r'(?:name|property)=["\']og:image["\'][^>]+content=["\'](https://i\.pinimg\.com/[^"\']+)["\']', html)
            if m_img:
                img_url = m_img.group(1)
                orig_url = re.sub(r"/\d+x(?:\d+|_RS)?/", "/originals/", img_url)
                m_title = re.search(r'content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\']og:title["\']', html)
                if not m_title:
                    m_title = re.search(r'(?:name|property)=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html)
                raw_title = m_title.group(1) if m_title else f"Pinterest Pin {pin_id}"
                clean_title = sanitize_filename(raw_title[:60], max_length=60) or f"Pinterest Pin {pin_id}"
                report(0.08, f"Found photo in '{clean_title}'. Starting download...")
                return {
                    "platform": "pinterest",
                    "title": clean_title,
                    "photos": [{
                        "id": pin_id,
                        "url": orig_url,
                        "title": raw_title[:80],
                        "width": 1200,
                    }],
                    "media_kind": "photo",
                }
        except Exception as exc:
            raise RuntimeError(f"Could not load Pinterest pin: {exc}") from exc

        raise RuntimeError(f"No photos or videos found for Pinterest pin {pin_id}.")

    if mps_match:
        mps_id = mps_match.group(1)
        # 1. Get multi-pin-share object to obtain pin_ids
        payload_mps = {
            "options": {
                "url": f"/v3/multipinshare/{mps_id}/",
                "params": {"mps_id": mps_id},
            },
            "context": {}
        }
        api_url_mps = f"https://{domain}/resource/ApiResource/get/?source_url={urllib.parse.quote(f'/multi-pin-share/{mps_id}/')}&data={urllib.parse.quote(json.dumps(payload_mps))}"
        req_mps = urllib.request.Request(
            api_url_mps,
            headers={**headers_base, "X-Pinterest-PWS-Handler": "www/multi-pin-share/[id].js"}
        )
        try:
            resp = opener.open(req_mps)
            data_mps = json.loads(resp.read().decode("utf-8"))
            pin_ids = data_mps.get("resource_response", {}).get("data", {}).get("pin_ids", [])
        except Exception as exc:
            raise RuntimeError(f"Pinterest multi-pin-share request failed: {exc}") from exc

        if not pin_ids:
            raise RuntimeError("Pinterest returned no items for this share collection.")

        report(0.07, f"Discovered {len(pin_ids)} pins in share collection. Fetching details...")

        # 2. Batch request pin details
        payload_pins = {
            "options": {
                "url": "/v3/pins/",
                "data": {"pin_ids": pin_ids},
            },
            "context": {}
        }
        api_url_pins = f"https://{domain}/resource/ApiResource/get/?data={urllib.parse.quote(json.dumps(payload_pins))}"
        req_pins = urllib.request.Request(
            api_url_pins,
            headers={**headers_base, "X-Pinterest-PWS-Handler": "www/multi-pin-share/[id].js"}
        )
        try:
            resp = opener.open(req_pins)
            data_pins = json.loads(resp.read().decode("utf-8"))
            pins_data = data_pins.get("resource_response", {}).get("data", [])
        except Exception as exc:
            raise RuntimeError(f"Pinterest batch pins request failed: {exc}") from exc

        photos = []
        seen_ids = set()
        for p in pins_data:
            img = p.get("image_large_url") or p.get("image_medium_url") or p.get("image_square_url")
            if not img:
                continue
            orig_url = re.sub(r"/\d+x(?:\d+|_RS)?/", "/originals/", img)
            name = orig_url.split("/")[-1]
            photo_id = str(p.get("id") or re.sub(r"\.[a-zA-Z0-9]+$", "", name).replace("-", "_"))
            if not photo_id or photo_id in seen_ids:
                continue
            seen_ids.add(photo_id)
            pin_title = (p.get("title") or p.get("description") or f"Pin {photo_id}").strip()
            photos.append({
                "id": photo_id,
                "url": orig_url,
                "title": pin_title[:80],
                "width": 1200
            })

        collection_title = f"Pinterest Share {mps_id}"
        report(0.08, f"Found {len(photos)} photos in '{collection_title}'. Starting download...")
        return {
            "platform": "pinterest",
            "title": collection_title,
            "photos": photos
        }

    # news_hub / notifications branch
    news_id = news_match.group(1)
    path_prefix = "notifications" if "/notifications/" in expanded_url else "news_hub"
    candidate_resources = [
        ("NewsHubDetailsResource", f"/{path_prefix}/{news_id}/"),
        ("NotificationFeedResource", f"/{path_prefix}/{news_id}/"),
        ("NewsHubDetailsResource", f"/news_hub/{news_id}/"),
    ]

    res_data = None
    last_exc = None
    for res_name, source_path in candidate_resources:
        data_payload = {
            "options": {
                "news_id": news_id
            },
            "context": {}
        }
        api_url = f"https://{domain}/resource/{res_name}/get/?source_url={urllib.parse.quote(source_path)}&data=" + urllib.parse.quote(json.dumps(data_payload))
        req = urllib.request.Request(
            api_url,
            headers={
                **headers_base,
                "X-Pinterest-PWS-Handler": f"www/{path_prefix}/[id].js",
            }
        )
        try:
            resp = opener.open(req)
            parsed_json = json.loads(resp.read().decode("utf-8"))
            if parsed_json.get("resource_response", {}).get("data"):
                res_data = parsed_json
                break
        except Exception as exc:
            last_exc = exc
            continue

    if not res_data:
        raise RuntimeError(f"Pinterest collection request failed or returned empty: {last_exc or 'no data'}")

    items = res_data.get("resource_response", {}).get("data", [])
    if not items:
        raise RuntimeError("Pinterest returned no items for this notification collection.")
    item0 = items[0]
    detail_header = item0.get("detail_header") or "Pinterest Collection"
    content_items = item0.get("content_items", [])
    if not content_items:
        raise RuntimeError("No photo items found in this Pinterest notification collection.")

    photos = []
    seen_ids = set()
    for ci in content_items:
        ao = ci.get("action_object", {})
        image_url = ao.get("image_square_url") or ao.get("image_url") or ""
        if not image_url:
            continue
        orig_url = re.sub(r"/\d+x(?:\d+|_RS)?/", "/originals/", image_url)
        name = orig_url.split("/")[-1]
        photo_id = re.sub(r"\.[a-zA-Z0-9]+$", "", name).replace("-", "_")
        if not photo_id or photo_id in seen_ids:
            continue
        seen_ids.add(photo_id)
        photos.append({
            "id": photo_id,
            "url": orig_url,
            "width": 1200
        })

    report(0.08, f"Found {len(photos)} photos in '{detail_header}'. Starting download...")
    return {
        "platform": "pinterest",
        "title": detail_header,
        "photos": photos
    }


def fetch_pinterest_newshub_manifest(
    url: str,
    browser: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> dict[str, Any]:
    """Backward-compatible alias for fetch_pinterest_collection_manifest."""
    return fetch_pinterest_collection_manifest(url, browser=browser, progress_callback=progress_callback)


def _shortcode_to_pk(shortcode: str) -> int:
    """Convert an Instagram alphanumeric shortcode to its numeric media PK."""
    clean = shortcode.split("?")[0].split("#")[0].strip()
    if len(clean) > 28:
        clean = clean[:28]
    table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    n = 0
    for char in clean:
        idx = table.find(char)
        if idx >= 0:
            n = n * 64 + idx
    return n


def is_instagram_post_url(url: str) -> bool:
    """Identify if a URL is an Instagram post, photo, reel, or story link."""
    try:
        parsed = urllib.parse.urlparse(str(url or "").strip())
        host = (parsed.hostname or "").lower()
        if not (host == "instagram.com" or host.endswith(".instagram.com") or host == "instagr.am"):
            return False
        path = parsed.path.lower()
        return bool(
            re.search(r"^/(?:[^/]+/)?(?:p|reel|reels)/([A-Za-z0-9_-]+)", path)
            or re.search(r"^/stories/[^/?#]+/(\d+)", path)
        )
    except Exception:
        return False


def _query_instagram_media_endpoints(
    opener: urllib.request.OpenerDirector,
    media_pk: int,
    shortcode: str,
) -> Optional[dict[str, Any]]:
    """Internal helper to query Instagram mobile info API endpoints with candidate app IDs."""
    candidate_endpoints = [
        f"https://i.instagram.com/api/v1/media/{media_pk}/info/",
        f"https://www.instagram.com/api/v1/media/{media_pk}/info/",
    ]
    candidate_app_ids = [
        "936619743392459",
        "1217981644879628",
        "567067343352427",
    ]
    for api_url in candidate_endpoints:
        for app_id in candidate_app_ids:
            req = urllib.request.Request(
                api_url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
                    ),
                    "X-IG-App-ID": app_id,
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"https://www.instagram.com/p/{shortcode}/",
                    "Accept": "*/*",
                }
            )
            try:
                resp = opener.open(req)
                parsed = json.loads(resp.read().decode("utf-8"))
                if parsed.get("items"):
                    return parsed
            except Exception:
                continue
    return None


def fetch_instagram_manifest(
    url: str,
    browser: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Optional[dict[str, Any]]:
    """Extract photos from an Instagram post or story using browser session cookies and internal media API."""
    patch_yt_dlp_cookie_database_reader()
    import yt_dlp

    def report(pct: float, msg: str):
        if progress_callback:
            progress_callback(pct, msg)

    match_post = re.search(r"/(?:p|reel|reels)/([A-Za-z0-9_-]+)", url)
    match_story = re.search(r"/stories/[^/?#]+/(\d+)", url)
    if not match_post and not match_story:
        raise ValueError(f"Invalid Instagram URL: {url}")
    if match_story:
        shortcode = match_story.group(1)
        try:
            media_pk = int(shortcode)
        except ValueError:
            return None
    else:
        assert match_post is not None
        shortcode = match_post.group(1)
        media_pk = _shortcode_to_pk(shortcode)
    if media_pk <= 0:
        return None

    preferred = [browser] if browser and browser.lower() not in ("none", "auto", "public", "public only") else []

    res_data = None
    # Fast guest path: probe public mobile API directly
    if not preferred:
        report(0.04, "Connecting to Instagram via public mobile API...")
        guest_opener = urllib.request.build_opener()
        res_data = _query_instagram_media_endpoints(guest_opener, media_pk, shortcode)

    if not res_data:
        report(0.05, "Searching desktop browsers for an active Instagram session...")
        candidates = preferred + [b for b in ("vivaldi", "firefox", "chrome", "edge", "brave", "opera") if b not in preferred]

        jar = None
        found_browser = None
        for b in candidates:
            try:
                ydl = yt_dlp.YoutubeDL({"cookiesfrombrowser": (b, None, None, None), "quiet": True})
                candidate_jar = ydl.cookiejar
                ig_cookies = [c for c in candidate_jar if "instagram" in getattr(c, "domain", "")]
                if ig_cookies and any(getattr(c, "name", None) in ("sessionid", "ds_user_id") for c in ig_cookies):
                    jar = candidate_jar
                    found_browser = b
                    break
            except Exception:
                continue

        if found_browser:
            report(0.06, f"Connected to Instagram session via {found_browser.title()}. Requesting post info...")
        if jar:
            auth_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
            res_data = _query_instagram_media_endpoints(auth_opener, media_pk, shortcode)

    if not res_data:
        report(0.08, "Instagram direct API request unavailable. Falling back to standard extractor...")
        return None

    items = res_data.get("items", [])
    if not items:
        return None
    item = items[0]
    media_type = item.get("media_type")

    # If it is purely a video/reel (media_type == 2) and has no carousel_media, signal video handoff
    if media_type == 2 and not item.get("carousel_media"):
        return {"platform": "instagram", "media_kind": "video", "title": shortcode}

    user = (item.get("user") or {}).get("username") or "instagram_post"
    caption_obj = item.get("caption") or {}
    caption_text = caption_obj.get("text") or ""
    clean_caption = sanitize_filename(caption_text.split("\n")[0][:60], max_length=60)
    title = clean_caption if clean_caption and clean_caption != "media_file" else f"Instagram Post by @{user}"

    photos = []
    carousel = item.get("carousel_media") or []
    if carousel:
        for idx, sub in enumerate(carousel, start=1):
            candidates = (sub.get("image_versions2") or {}).get("candidates") or []
            if not candidates:
                continue
            best = max(candidates, key=lambda c: c.get("width", 0))
            photo_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(sub.get("pk") or f"{media_pk}_{idx}"))[:200]
            photos.append({
                "id": photo_id,
                "url": best["url"],
                "width": best.get("width", 1080),
            })
    else:
        candidates = (item.get("image_versions2") or {}).get("candidates") or []
        if candidates:
            best = max(candidates, key=lambda c: c.get("width", 0))
            photo_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(item.get("pk") or media_pk))[:200]
            photos.append({
                "id": photo_id,
                "url": best["url"],
                "width": best.get("width", 1080),
            })

    if not photos:
        return None

    report(0.08, f"Found {len(photos)} photos in '{title}'. Starting download...")
    return {
        "platform": "instagram",
        "title": title,
        "photos": photos,
        "media_kind": "photo",
    }
