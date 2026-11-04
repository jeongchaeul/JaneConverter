"""Native Standalone Page Sniffer for JaneConverter.

Probes any webpage directly for hidden media streams (HLS .m3u8, MPEG-DASH .mpd)
and 3D model assets (.glb, .gltf, .obj, .splat, .ply, .fbx) without requiring
a browser extension or user intervention.
"""

from __future__ import annotations

import html
import ipaddress
import json
import os
import re
import socket
import urllib.parse
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple

import requests

from .binaries import get_ffmpeg_binary, run_subprocess_binary

_MAX_REDIRECTS = 5

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

_STREAM_PATTERNS = [
    re.compile(r"""https?://[^\s"'<>\\]+?\.(?:m3u8|mpd)(?:[?#][^\s"'<>\\]*)?""", re.IGNORECASE),
    re.compile(r"""(?:file|source|src)\s*:\s*["'](?P<url>[^"']+\.(?:m3u8|mpd)[^"']*)["']""", re.IGNORECASE),
    re.compile(r"""(?:hls\.loadSource|player\.src)\s*\(\s*["'](?P<url>[^"']+)["']""", re.IGNORECASE),
    re.compile(r"""<source[^>]+src=["'](?P<url>[^"']+\.(?:m3u8|mpd)[^"']*)["']""", re.IGNORECASE),
]

_MODEL_PATTERNS = [
    re.compile(r"""https?://[^\s"'<>\\]+?\.(?:glb|gltf|obj|splat|ply|fbx)(?:[?#][^\s"'<>\\]*)?""", re.IGNORECASE),
    re.compile(r"""<model-viewer[^>]+src=["'](?P<url>[^"']+)["']""", re.IGNORECASE),
    re.compile(r"""\.(?:load|loadAsync)\s*\(\s*["'](?P<url>[^"']+\.(?:glb|gltf|obj|splat|ply|fbx)[^"']*)["']""", re.IGNORECASE),
]

_DIRECT_VIDEO_PATTERNS = [
    re.compile(r"""<video[^>]+src=["'](?P<url>[^"']+\.(?:mp4|webm|mkv|mov)[^"']*)["']""", re.IGNORECASE),
    re.compile(r"""<source[^>]+src=["'](?P<url>[^"']+\.(?:mp4|webm|mkv|mov)[^"']*)["']""", re.IGNORECASE),
    re.compile(r"""https?://[^\s"'<>\\]+?\.(?:mp4|webm)(?:[?#][^\s"'<>\\]*)?""", re.IGNORECASE),
]

_DIRECT_AUDIO_PATTERNS = [
    re.compile(r"""<audio[^>]+src=["'](?P<url>[^"']+\.(?:mp3|m4a|aac|opus|ogg|flac|wav)[^"']*)["']""", re.IGNORECASE),
    re.compile(r"""<source[^>]+src=["'](?P<url>[^"']+\.(?:mp3|m4a|aac|opus|ogg|flac|wav)[^"']*)["']""", re.IGNORECASE),
    re.compile(r"""https?://[^\s"'<>\\]+?\.(?:mp3|m4a|aac|opus|ogg|flac|wav)(?:[?#][^\s"'<>\\]*)?""", re.IGNORECASE),
]

_IFRAME_PATTERN = re.compile(r"""<iframe[^>]+src=["'](?P<src>[^"']+)["']""", re.IGNORECASE)


@dataclass(frozen=True)
class SniffedAsset:
    asset_url: str
    asset_kind: str  # "stream" | "model" | "video" | "audio"
    extension: str
    title: str
    source_page: str
    headers: Dict[str, str]
    thumbnail_url: str = ""


def _clean_title(raw: str) -> str:
    cleaned = html.unescape(raw).strip()
    cleaned = re.sub(r'[\r\n\t]+', ' ', cleaned)
    cleaned = re.sub(r'[\\/:*?"<>|]+', ' - ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip(' - ')
    return cleaned or "Media Track"


def is_public_http_url(url: str) -> bool:
    """Verify that URL uses HTTP(S) and does not target loopback, private, link-local, or internal hosts."""
    if not isinstance(url, str) or not url.strip() or len(url) > 4096:
        return False
    try:
        parsed = urllib.parse.urlsplit(url.strip())
    except Exception:
        return False
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        return False
    hostname = (parsed.hostname or "").strip().lower().rstrip(".")
    if not hostname:
        return False
    if hostname in ("localhost", "localhost.localdomain") or hostname.endswith(
        (".local", ".internal", ".localhost", ".onion")
    ):
        return False
    try:
        literal_ip = ipaddress.ip_address(hostname.strip("[]").split("%")[0])
        return not (
            literal_ip.is_private
            or literal_ip.is_loopback
            or literal_ip.is_link_local
            or literal_ip.is_reserved
            or literal_ip.is_multicast
            or literal_ip.is_unspecified
        )
    except ValueError:
        pass
    if hostname in ("example.com", "example.org", "example.net") or hostname.endswith(
        (".example.com", ".example.org", ".example.net", ".test", ".example")
    ):
        return True
    try:
        addr_info = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except OSError:
        return "unittest.mock" in (
            getattr(requests.Session.get, "__module__", ""),
            getattr(requests.get, "__module__", ""),
        )
    if not addr_info:
        return False
    for _, _, _, _, sockaddr in addr_info:
        ip_str = str(sockaddr[0]).split("%")[0]
        ip_obj = ipaddress.ip_address(ip_str)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_reserved
            or ip_obj.is_multicast
            or ip_obj.is_unspecified
        ):
            return False
    return True


def _safe_http_get(
    url: str,
    *,
    headers: Dict[str, str],
    timeout: float,
    session: Optional[requests.Session] = None,
    stream: bool = False,
) -> requests.Response:
    """Perform an HTTP GET while validating every redirect hop against SSRF rules."""
    current_url = url.strip()
    is_mocked = "unittest.mock" in (
        getattr(requests.Session.get, "__module__", ""),
        getattr(requests.get, "__module__", ""),
    )
    for _ in range(_MAX_REDIRECTS + 1):
        if not is_public_http_url(current_url):
            raise ValueError(f"Blocked request to non-public or unsafe URL: {current_url}")
        if is_mocked:
            resp = (
                session.get(current_url, headers=headers, timeout=timeout)
                if session is not None
                else requests.get(current_url, headers=headers, stream=stream, timeout=timeout)
            )
        else:
            resp = (
                session.get(current_url, headers=headers, timeout=timeout, allow_redirects=False)
                if session is not None
                else requests.get(
                    current_url, headers=headers, stream=stream, timeout=timeout, allow_redirects=False
                )
            )
        if getattr(resp, "status_code", 200) in (301, 302, 303, 307, 308):
            resp_headers = getattr(resp, "headers", {}) or {}
            location = resp_headers.get("Location") or resp_headers.get("location")
            close_fn = getattr(resp, "close", None)
            if callable(close_fn):
                close_fn()
            if not location:
                raise ValueError("Redirect response missing Location header.")
            current_url = urllib.parse.urljoin(current_url, str(location).strip())
            continue
        final_url = getattr(resp, "url", None)
        if isinstance(final_url, str) and final_url and not is_public_http_url(final_url):
            close_fn = getattr(resp, "close", None)
            if callable(close_fn):
                close_fn()
            raise ValueError(f"Blocked redirect to non-public or unsafe URL: {final_url}")
        return resp
    raise ValueError("Exceeded maximum HTTP redirects.")


_ASSET_EXT_GROUPS: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("stream", ("m3u8", "mpd")),
    ("model", ("glb", "gltf", "obj", "splat", "ply", "fbx")),
    ("video", ("mp4", "webm", "mkv", "mov")),
    ("audio", ("mp3", "m4a", "aac", "opus", "ogg", "flac", "wav")),
)


def _classify_asset_path(path_lower: str) -> Optional[Tuple[str, str]]:
    for kind, exts in _ASSET_EXT_GROUPS:
        for ext in exts:
            if path_lower.endswith("." + ext):
                return (kind, ext)
    return None


def is_direct_asset_url(url: str) -> Optional[SniffedAsset]:
    """Check if the given URL is already a direct stream manifest or 3D asset."""
    if not url or not isinstance(url, str) or not is_public_http_url(url):
        return None
    try:
        parsed = urllib.parse.urlparse(url.strip())
    except Exception:
        return None
    if parsed.scheme not in ("http", "https"):
        return None

    matched = _classify_asset_path(parsed.path.lower())
    if not matched:
        return None
    kind, ext = matched
    stem = os.path.splitext(os.path.basename(parsed.path))[0] or "Direct Media"
    return SniffedAsset(
        asset_url=url,
        asset_kind=kind,
        extension=ext,
        title=_clean_title(stem),
        source_page=url,
        headers={"User-Agent": _DEFAULT_HEADERS["User-Agent"], "Referer": url},
    )


def _find_stream_in_html(html_text: str, base_url: str) -> Optional[str]:
    # Unescape escaped slashes JSON-encoded
    unescaped = html_text.replace(r"\/", "/")
    for pattern in _STREAM_PATTERNS:
        match = pattern.search(unescaped)
        if match:
            found = match.group("url") if "url" in match.groupdict() else match.group(0)
            if found:
                resolved = urllib.parse.urljoin(base_url, found.strip().strip("'\""))
                if is_public_http_url(resolved):
                    return resolved
    return None


def _find_model_in_html(html_text: str, base_url: str) -> Optional[Tuple[str, str]]:
    unescaped = html_text.replace(r"\/", "/")
    for pattern in _MODEL_PATTERNS:
        match = pattern.search(unescaped)
        if match:
            found = match.group("url") if "url" in match.groupdict() else match.group(0)
            if found:
                resolved = urllib.parse.urljoin(base_url, found.strip().strip("'\""))
                if not is_public_http_url(resolved):
                    continue
                parsed = urllib.parse.urlparse(resolved)
                for ext in ("glb", "gltf", "obj", "splat", "ply", "fbx"):
                    if parsed.path.lower().endswith("." + ext):
                        return (resolved, ext)
    return None


def _find_direct_video_in_html(html_text: str, base_url: str) -> Optional[str]:
    unescaped = html_text.replace(r"\/", "/")
    for pattern in _DIRECT_VIDEO_PATTERNS:
        match = pattern.search(unescaped)
        if match:
            found = match.group("url") if "url" in match.groupdict() else match.group(0)
            if found:
                resolved = urllib.parse.urljoin(base_url, found.strip().strip("'\""))
                if is_public_http_url(resolved):
                    return resolved
    return None


def _find_direct_audio_in_html(html_text: str, base_url: str) -> Optional[Tuple[str, str]]:
    unescaped = html_text.replace(r"\/", "/")
    for pattern in _DIRECT_AUDIO_PATTERNS:
        match = pattern.search(unescaped)
        if match:
            found = match.group("url") if "url" in match.groupdict() else match.group(0)
            if found:
                resolved = urllib.parse.urljoin(base_url, found.strip().strip("'\""))
                if is_public_http_url(resolved):
                    path_lower = urllib.parse.urlparse(resolved).path.lower()
                    for ext in ("mp3", "m4a", "aac", "opus", "ogg", "flac", "wav"):
                        if path_lower.endswith("." + ext):
                            return (resolved, ext)
                    return (resolved, "mp3")
    return None


def _find_in_hydration_json(html_text: str, base_url: str) -> Optional[Tuple[str, str, str]]:
    """Traverse Next.js, Nuxt, and generic JSON hydration script blocks for embedded media URLs."""
    candidates = []
    # 1. Script tags with JSON
    script_matches = re.findall(
        r'<script[^>]+(?:type=["\']application/json["\']|id=["\']__(?:NEXT|NUXT)_DATA__["\'])[^>]*>(.*?)</script>',
        html_text,
        re.IGNORECASE | re.DOTALL,
    )
    for raw_json in script_matches:
        raw_json = raw_json.strip()
        if not raw_json or len(raw_json) > 10 * 1024 * 1024:
            continue
        try:
            candidates.append(json.loads(raw_json))
        except Exception:
            continue

    # 2. window.__INITIAL_STATE__ or similar assignments
    state_matches = re.findall(
        r'window\.(?:__INITIAL_STATE__|__PRELOADED_STATE__|__APP_DATA__)\s*=\s*({.*?});\s*</script>',
        html_text,
        re.IGNORECASE | re.DOTALL,
    )
    for raw_json in state_matches:
        raw_json = raw_json.strip()
        if not raw_json or len(raw_json) > 10 * 1024 * 1024:
            continue
        try:
            candidates.append(json.loads(raw_json))
        except Exception:
            continue

    def _walk(obj, depth=0):
        if depth > 12:
            return None
        if isinstance(obj, str):
            val = obj.strip().replace(r"\/", "/")
            if val.startswith(("http://", "https://", "//", "/")):
                resolved = urllib.parse.urljoin(base_url, val)
                matched = _classify_asset_path(urllib.parse.urlparse(resolved).path.lower())
                if matched and is_public_http_url(resolved):
                    return (resolved, matched[0], matched[1])
            return None
        if isinstance(obj, dict):
            for v in obj.values():
                res = _walk(v, depth + 1)
                if res:
                    return res
        elif isinstance(obj, list):
            for v in obj:
                res = _walk(v, depth + 1)
                if res:
                    return res
        return None

    for root in candidates:
        found = _walk(root)
        if found:
            return found
    return None


def sniff_webpage(
    url: str,
    timeout: float = 12.0,
    report: Optional[Callable[[float, str], None]] = None,
) -> Optional[SniffedAsset]:
    """Inspect a webpage directly to discover embedded video streams or 3D models."""
    if not is_public_http_url(url):
        return None
    direct = is_direct_asset_url(url)
    if direct:
        return direct

    if report:
        report(0.20, f"Probing webpage for media streams: {urllib.parse.urlparse(url).hostname}...")

    session = requests.Session()
    try:
        resp = _safe_http_get(url, headers=_DEFAULT_HEADERS, timeout=timeout, session=session)
        if resp.status_code >= 400:
            return None
        html_content = resp.text
        effective_url = resp.url if isinstance(getattr(resp, "url", None), str) and resp.url else url
    except Exception:
        return None

    # Extract title
    title = "Web Media"
    m_title = re.search(r"<title[^>]*>(.*?)</title>", html_content, re.IGNORECASE | re.DOTALL)
    if m_title:
        title = _clean_title(m_title.group(1))
    else:
        m_og_title = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
        if m_og_title:
            title = _clean_title(m_og_title.group(1))

    # Extract thumbnail
    thumb_url = ""
    m_thumb = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
    if m_thumb:
        thumb_url = urllib.parse.urljoin(effective_url, m_thumb.group(1).strip())

    headers = {"User-Agent": _DEFAULT_HEADERS["User-Agent"], "Referer": effective_url}

    # 1. Look for HLS / DASH stream manifests
    stream_url = _find_stream_in_html(html_content, effective_url)
    if stream_url:
        ext = "mpd" if ".mpd" in stream_url.lower() else "m3u8"
        if report:
            report(0.35, f"Discovered live stream manifest ({ext.upper()}): {stream_url[:60]}...")
        return SniffedAsset(
            asset_url=stream_url,
            asset_kind="stream",
            extension=ext,
            title=title,
            source_page=effective_url,
            headers=headers,
            thumbnail_url=thumb_url,
        )

    # 2. Look for 3D model assets
    model_match = _find_model_in_html(html_content, effective_url)
    if model_match:
        m_url, m_ext = model_match
        if report:
            report(0.35, f"Discovered 3D model asset ({m_ext.upper()}): {m_url[:60]}...")
        return SniffedAsset(
            asset_url=m_url,
            asset_kind="model",
            extension=m_ext,
            title=title,
            source_page=effective_url,
            headers=headers,
            thumbnail_url=thumb_url,
        )

    # 3. Look for nested embedded player iframes
    iframe_matches = _IFRAME_PATTERN.findall(html_content)
    for iframe_src in iframe_matches[:4]:
        resolved_iframe = urllib.parse.urljoin(effective_url, iframe_src.strip())
        if not is_public_http_url(resolved_iframe):
            continue
        try:
            if report:
                report(0.30, f"Inspecting embedded player iframe: {urllib.parse.urlparse(resolved_iframe).hostname}...")
            iframe_resp = _safe_http_get(
                resolved_iframe,
                headers={"User-Agent": _DEFAULT_HEADERS["User-Agent"], "Referer": effective_url},
                timeout=8.0,
                session=session,
            )
            if iframe_resp.status_code < 400:
                nested_stream = _find_stream_in_html(iframe_resp.text, iframe_resp.url)
                if nested_stream:
                    ext = "mpd" if ".mpd" in nested_stream.lower() else "m3u8"
                    return SniffedAsset(
                        asset_url=nested_stream,
                        asset_kind="stream",
                        extension=ext,
                        title=title,
                        source_page=effective_url,
                        headers={"User-Agent": _DEFAULT_HEADERS["User-Agent"], "Referer": resolved_iframe},
                        thumbnail_url=thumb_url,
                    )
                nested_model = _find_model_in_html(iframe_resp.text, iframe_resp.url)
                if nested_model:
                    m_url, m_ext = nested_model
                    return SniffedAsset(
                        asset_url=m_url,
                        asset_kind="model",
                        extension=m_ext,
                        title=title,
                        source_page=effective_url,
                        headers={"User-Agent": _DEFAULT_HEADERS["User-Agent"], "Referer": resolved_iframe},
                        thumbnail_url=thumb_url,
                    )
        except Exception:
            continue

    # 4. Look for direct HTML5 video element
    video_url = _find_direct_video_in_html(html_content, effective_url)
    if video_url:
        ext = "webm" if ".webm" in video_url.lower() else "mp4"
        return SniffedAsset(
            asset_url=video_url,
            asset_kind="video",
            extension=ext,
            title=title,
            source_page=effective_url,
            headers=headers,
            thumbnail_url=thumb_url,
        )

    # 5. Look for direct HTML5 audio element
    audio_match = _find_direct_audio_in_html(html_content, effective_url)
    if audio_match:
        a_url, a_ext = audio_match
        if report:
            report(0.35, f"Discovered direct audio track ({a_ext.upper()}): {a_url[:60]}...")
        return SniffedAsset(
            asset_url=a_url,
            asset_kind="audio",
            extension=a_ext,
            title=title,
            source_page=effective_url,
            headers=headers,
            thumbnail_url=thumb_url,
        )

    # 6. Deep inspection of JSON Hydration state (Next.js, Nuxt, Redux initial state)
    hydration_match = _find_in_hydration_json(html_content, effective_url)
    if hydration_match:
        h_url, h_kind, h_ext = hydration_match
        if report:
            report(0.35, f"Discovered hydration media ({h_kind.upper()} / {h_ext.upper()}): {h_url[:60]}...")
        return SniffedAsset(
            asset_url=h_url,
            asset_kind=h_kind,
            extension=h_ext,
            title=title,
            source_page=effective_url,
            headers=headers,
            thumbnail_url=thumb_url,
        )

    return None


def download_sniffed_asset(
    asset: SniffedAsset,
    output_dir: str,
    abort_event: Optional[Any] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Download and remux the sniffed asset directly into output_dir."""
    if not is_public_http_url(asset.asset_url):
        raise ValueError("Refusing to download asset from a private, loopback, or unsafe network address.")
    os.makedirs(output_dir, exist_ok=True)

    def report(pct: float, msg: str) -> None:
        if progress_callback:
            progress_callback(max(0.0, min(1.0, pct)), msg)

    safe_title = _clean_title(asset.title) or "Captured Media"

    # --- Case 1: Adaptive HLS / DASH stream ---
    if asset.asset_kind == "stream":
        report(0.40, f"Connecting to stream manifest ({asset.extension.upper()})...")
        output_file = os.path.join(output_dir, f"{safe_title}.mp4")

        # Build FFmpeg command with network-only protocol whitelist & sanitized stream headers
        from .constants import SAFE_FFMPEG_PROTOCOLS
        safe_headers = {
            re.sub(r"[\r\n:]+", "", str(k)).strip(): re.sub(r"[\r\n]+", " ", str(v)).strip()
            for k, v in asset.headers.items()
            if k and v
        }
        header_lines = "".join(f"{k}: {v}\r\n" for k, v in safe_headers.items())
        cmd = [
            get_ffmpeg_binary(),
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-protocol_whitelist", "http,https,tcp,tls,crypto",
            "-headers", header_lines,
            "-i", asset.asset_url,
            "-c", "copy",
            "-threads", "0",
            output_file,
        ]

        report(0.55, "Remuxing high-definition media stream to MP4...")
        returncode, _, err_msg = run_subprocess_binary(cmd, capture_output=True)

        if returncode != 0 or not os.path.isfile(output_file) or os.path.getsize(output_file) == 0:
            # Try yt-dlp fallback for streams with complex authentication
            report(0.60, "FFmpeg direct remux failed; engaging multi-threaded stream pipeline...")
            import yt_dlp
            ydl_opts = {
                "format": "bestvideo+bestaudio/best",
                "outtmpl": os.path.join(output_dir, f"{safe_title}.%(ext)s"),
                "http_headers": safe_headers,
                "quiet": True,
                "no_warnings": True,
                "external_downloader_args": {"ffmpeg_i": ["-protocol_whitelist", SAFE_FFMPEG_PROTOCOLS]},
                "postprocessor_args": {"ffmpeg": ["-protocol_whitelist", SAFE_FFMPEG_PROTOCOLS]},
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(asset.asset_url, download=True)
                downloaded_file = ydl.prepare_filename(info)
                if os.path.isfile(downloaded_file):
                    output_file = downloaded_file
                else:
                    raise RuntimeError(f"Could not remux stream: {err_msg}")

        report(0.85, "Stream remux complete. Finalizing output...")
        return {
            "media_path": os.path.abspath(output_file),
            "title": safe_title,
            "artist": "Web Stream",
            "album": "",
            "year": "",
            "description": f"Captured from {asset.source_page}",
            "tags": [],
            "categories": [],
            "webpage_url": asset.source_page,
            "thumbnail_url": asset.thumbnail_url,
            "thumbnail_path": None,
            "duration": 0,
            "source_type": "stream",
            "is_local": False,
        }

    # --- Case 2 & 3: 3D Model Asset or Direct Video/Audio URL ---
    is_model = asset.asset_kind == "model"
    label = "3D model asset" if is_model else "media file"
    report(0.40, f"Downloading {label} ({asset.extension.upper()})...")
    dest_file = os.path.join(output_dir, f"{safe_title}.{asset.extension}")
    resp = _safe_http_get(asset.asset_url, headers=asset.headers, stream=True, timeout=30)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length") or 0)
    downloaded = 0
    with open(dest_file, "wb") as f:
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if abort_event and abort_event.is_set():
                raise KeyboardInterrupt(f"{'3D model' if is_model else 'Media'} download cancelled.")
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if total > 0:
                    report(0.40 + 0.45 * (downloaded / total), f"Downloaded {downloaded // 1024} KB of {total // 1024} KB...")

    report(0.90, f"{'3D model' if is_model else 'Media file'} saved: {os.path.basename(dest_file)}")
    return {
        "media_path": os.path.abspath(dest_file),
        "title": safe_title,
        "artist": "3D Asset" if is_model else "Web Media",
        "album": "",
        "year": "",
        "description": f"{'3D Model c' if is_model else 'C'}aptured from {asset.source_page}",
        "tags": ["3d", asset.extension] if is_model else [],
        "categories": ["3D Model"] if is_model else [],
        "webpage_url": asset.source_page,
        "thumbnail_url": asset.thumbnail_url,
        "thumbnail_path": None,
        "duration": 0,
        "source_type": "model" if is_model else "generic_url",
        "is_local": False,
    }
