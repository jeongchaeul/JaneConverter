"""Native Standalone Page Sniffer for JaneConverter.

Probes any webpage directly for hidden media streams (HLS .m3u8, MPEG-DASH .mpd)
and 3D model assets (.glb, .gltf, .obj, .splat, .ply, .fbx) without requiring
a browser extension or user intervention.
"""

from __future__ import annotations

import html
import os
import re
import urllib.parse
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple

import requests

from .binaries import get_ffmpeg_binary, run_subprocess_binary

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


def is_direct_asset_url(url: str) -> Optional[SniffedAsset]:
    """Check if the given URL is already a direct stream manifest or 3D asset."""
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urllib.parse.urlparse(url.strip())
    except Exception:
        return None
    if parsed.scheme not in ("http", "https"):
        return None

    path_lower = parsed.path.lower()
    headers = {"User-Agent": _DEFAULT_HEADERS["User-Agent"], "Referer": url}
    stem = os.path.splitext(os.path.basename(parsed.path))[0] or "Direct Media"

    if path_lower.endswith((".m3u8", ".mpd")):
        ext = "mpd" if path_lower.endswith(".mpd") else "m3u8"
        return SniffedAsset(
            asset_url=url,
            asset_kind="stream",
            extension=ext,
            title=_clean_title(stem),
            source_page=url,
            headers=headers,
        )

    for model_ext in ("glb", "gltf", "obj", "splat", "ply", "fbx"):
        if path_lower.endswith("." + model_ext):
            return SniffedAsset(
                asset_url=url,
                asset_kind="model",
                extension=model_ext,
                title=_clean_title(stem),
                source_page=url,
                headers=headers,
            )

    for video_ext in ("mp4", "webm", "mkv", "mov"):
        if path_lower.endswith("." + video_ext):
            return SniffedAsset(
                asset_url=url,
                asset_kind="video",
                extension=video_ext,
                title=_clean_title(stem),
                source_page=url,
                headers=headers,
            )

    return None


def _find_stream_in_html(html_text: str, base_url: str) -> Optional[str]:
    # Unescape escaped slashes JSON-encoded
    unescaped = html_text.replace(r"\/", "/")
    for pattern in _STREAM_PATTERNS:
        match = pattern.search(unescaped)
        if match:
            found = match.group("url") if "url" in match.groupdict() else match.group(0)
            if found:
                resolved = urllib.parse.urljoin(base_url, found.strip().strip("'\""))
                if resolved.startswith(("http://", "https://")):
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
                if resolved.startswith(("http://", "https://")):
                    return resolved
    return None


def sniff_webpage(
    url: str,
    timeout: float = 12.0,
    report: Optional[Callable[[float, str], None]] = None,
) -> Optional[SniffedAsset]:
    """Inspect a webpage directly to discover embedded video streams or 3D models."""
    direct = is_direct_asset_url(url)
    if direct:
        return direct

    if report:
        report(0.20, f"Probing webpage for media streams: {urllib.parse.urlparse(url).hostname}...")

    session = requests.Session()
    try:
        resp = session.get(url, headers=_DEFAULT_HEADERS, timeout=timeout)
        if resp.status_code >= 400:
            return None
        html_content = resp.text
        effective_url = resp.url
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
        if not resolved_iframe.startswith(("http://", "https://")):
            continue
        try:
            if report:
                report(0.30, f"Inspecting embedded player iframe: {urllib.parse.urlparse(resolved_iframe).hostname}...")
            iframe_resp = session.get(
                resolved_iframe,
                headers={"User-Agent": _DEFAULT_HEADERS["User-Agent"], "Referer": effective_url},
                timeout=8.0,
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

    return None


def download_sniffed_asset(
    asset: SniffedAsset,
    output_dir: str,
    abort_event: Optional[Any] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Download and remux the sniffed asset directly into output_dir."""
    os.makedirs(output_dir, exist_ok=True)

    def report(pct: float, msg: str) -> None:
        if progress_callback:
            progress_callback(max(0.0, min(1.0, pct)), msg)

    safe_title = _clean_title(asset.title) or "Captured Media"

    # --- Case 1: Adaptive HLS / DASH stream ---
    if asset.asset_kind == "stream":
        report(0.40, f"Connecting to stream manifest ({asset.extension.upper()})...")
        output_file = os.path.join(output_dir, f"{safe_title}.mp4")

        # Build FFmpeg command with protocol whitelist & stream headers
        header_lines = "".join(f"{k}: {v}\r\n" for k, v in asset.headers.items())
        cmd = [
            get_ffmpeg_binary(),
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
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
                "http_headers": asset.headers,
                "quiet": True,
                "no_warnings": True,
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

    # --- Case 2: 3D Model Asset ---
    if asset.asset_kind == "model":
        report(0.40, f"Downloading 3D model asset ({asset.extension.upper()})...")
        model_file = os.path.join(output_dir, f"{safe_title}.{asset.extension}")
        resp = requests.get(asset.asset_url, headers=asset.headers, stream=True, timeout=30)
        resp.raise_for_status()

        total = int(resp.headers.get("content-length") or 0)
        downloaded = 0
        with open(model_file, "wb") as f:
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if abort_event and abort_event.is_set():
                    raise KeyboardInterrupt("3D model download cancelled.")
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        report(0.40 + 0.45 * (downloaded / total), f"Downloaded {downloaded // 1024} KB of {total // 1024} KB...")

        report(0.90, f"3D model saved: {os.path.basename(model_file)}")
        return {
            "media_path": os.path.abspath(model_file),
            "title": safe_title,
            "artist": "3D Asset",
            "album": "",
            "year": "",
            "description": f"3D Model captured from {asset.source_page}",
            "tags": ["3d", asset.extension],
            "categories": ["3D Model"],
            "webpage_url": asset.source_page,
            "thumbnail_url": asset.thumbnail_url,
            "thumbnail_path": None,
            "duration": 0,
            "source_type": "model",
            "is_local": False,
        }

    # --- Case 3: Direct Video or Audio URL ---
    report(0.40, f"Downloading media file ({asset.extension.upper()})...")
    media_file = os.path.join(output_dir, f"{safe_title}.{asset.extension}")
    resp = requests.get(asset.asset_url, headers=asset.headers, stream=True, timeout=30)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length") or 0)
    downloaded = 0
    with open(media_file, "wb") as f:
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if abort_event and abort_event.is_set():
                raise KeyboardInterrupt("Media download cancelled.")
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if total > 0:
                    report(0.40 + 0.45 * (downloaded / total), f"Downloaded {downloaded // 1024} KB of {total // 1024} KB...")

    report(0.90, f"Media file saved: {os.path.basename(media_file)}")
    return {
        "media_path": os.path.abspath(media_file),
        "title": safe_title,
        "artist": "Web Media",
        "album": "",
        "year": "",
        "description": f"Captured from {asset.source_page}",
        "tags": [],
        "categories": [],
        "webpage_url": asset.source_page,
        "thumbnail_url": asset.thumbnail_url,
        "thumbnail_path": None,
        "duration": 0,
        "source_type": "generic_url",
        "is_local": False,
    }
