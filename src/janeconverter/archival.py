"""
Archival Vault Indexing & Recovery Module for JaneConverter.

When a media source (especially YouTube) is deleted, private, or hidden, this module
provides a multi-stage archival recovery pipeline:
  Phase 1: Metadata Fingerprinting (Filmot index, Wayback Machine CDX, Archive.today)
  Phase 2: Stream & Media Recovery (Archive.org collections, Ghostarchive, Wayback CDX streams)
"""

from dataclasses import dataclass
import json
import logging
import os
import re
import urllib.parse
from typing import Any, Callable, Dict, Optional
import requests

logger = logging.getLogger(__name__)

# Common timeout for archival HTTP queries to avoid hanging
ARCHIVE_TIMEOUT = 12

# Standard browser User-Agent for archival queries
ARCHIVE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 JaneConverter/2.3"
    ),
    "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass
class ArchivalMetadata:
    video_id: str
    title: Optional[str] = None
    uploader: Optional[str] = None
    description: Optional[str] = None
    duration: Optional[int] = None
    upload_date: Optional[str] = None
    thumbnail_url: Optional[str] = None
    source_service: Optional[str] = None


@dataclass
class ArchivalStreamResult:
    found: bool
    source_name: str
    stream_url: str
    title: str
    uploader: str
    description: str
    ext: str
    duration: Optional[int] = None
    thumbnail_url: Optional[str] = None
    is_direct_media: bool = True
    item_identifier: Optional[str] = None


def extract_youtube_id(url_or_id: str) -> Optional[str]:
    """Extract standard 11-character YouTube video ID from various URL formats or raw ID."""
    if not url_or_id:
        return None
    raw = str(url_or_id).strip()

    # Raw 11-char ID check (alphanumeric, -, _)
    if re.fullmatch(r"[a-zA-Z0-9_-]{11}", raw):
        return raw

    patterns = (
        r"(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:[^&]+&)*v=([a-zA-Z0-9_-]{11})",
        r"(?:https?://)?(?:www\.|m\.)?youtu\.be/([a-zA-Z0-9_-]{11})",
        r"(?:https?://)?(?:www\.|m\.)?youtube\.com/shorts/([a-zA-Z0-9_-]{11})",
        r"(?:https?://)?(?:www\.|m\.)?youtube\.com/embed/([a-zA-Z0-9_-]{11})",
        r"(?:https?://)?(?:www\.|m\.)?youtube\.com/v/([a-zA-Z0-9_-]{11})",
        r"(?:https?://)?(?:www\.|m\.)?youtube\.com/live/([a-zA-Z0-9_-]{11})",
    )
    for p in patterns:
        m = re.search(p, raw)
        if m:
            return m.group(1)
    return None


def lookup_historical_metadata(
    video_id: str,
    report: Optional[Callable[[float, str], None]] = None,
) -> ArchivalMetadata:
    """
    Probe public archival metadata indexes (Filmot, Wayback Machine CDX)
    to uncover the original title, channel, description, and upload date.
    """
    meta = ArchivalMetadata(video_id=video_id)

    # 1. Filmot Index (tracks over 1B+ videos including deleted/private videos and captions)
    if report:
        report(0.18, "Probing Filmot historical index for original metadata...")
    try:
        filmot_url = f"https://filmot.com/api/getvideo?key=&id={video_id}"
        resp = requests.get(filmot_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
        if resp.status_code == 200:
            try:
                data = resp.json()
                if isinstance(data, dict) and data.get("title"):
                    meta.title = data.get("title")
                    meta.uploader = data.get("channel_name") or data.get("channel_title")
                    meta.description = data.get("description")
                    meta.duration = data.get("duration")
                    meta.upload_date = data.get("upload_date")
                    meta.source_service = "Filmot"
                    return meta
            except json.JSONDecodeError:
                pass
    except Exception as exc:
        logger.debug(f"Filmot metadata lookup failed: {exc}")

    # 2. Wayback Machine CDX API (lookup last 200 OK snapshot of the watch page)
    if report:
        report(0.20, "Querying Wayback Machine CDX for watch page snapshots...")
    try:
        cdx_url = (
            f"https://web.archive.org/cdx/search/cdx?"
            f"url=youtube.com/watch?v={video_id}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=5"
        )
        resp = requests.get(cdx_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
        if resp.status_code == 200:
            rows = resp.json()
            if len(rows) > 1:  # row 0 is header ["timestamp", "original", "statuscode"]
                latest = rows[-1]
                ts = latest[0]
                snapshot_url = f"https://web.archive.org/web/{ts}id_/https://www.youtube.com/watch?v={video_id}"
                snap_resp = requests.get(snapshot_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
                if snap_resp.status_code == 200:
                    html = snap_resp.text
                    # Extract title
                    m_title = re.search(r'<meta\s+name="title"\s+content="([^"]+)"', html) or \
                              re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', html) or \
                              re.search(r'<title>([^<]+)</title>', html)
                    if m_title:
                        title_clean = m_title.group(1).replace(" - YouTube", "").strip()
                        if title_clean and title_clean.lower() != "youtube":
                            meta.title = title_clean

                    # Extract uploader/channel
                    m_chan = re.search(r'<link\s+itemprop="name"\s+content="([^"]+)"', html) or \
                             re.search(r'"ownerChannelName"\s*:\s*"([^"]+)"', html) or \
                             re.search(r'"author"\s*:\s*"([^"]+)"', html)
                    if m_chan:
                        meta.uploader = m_chan.group(1).strip()

                    # Extract description
                    m_desc = re.search(r'<meta\s+property="og:description"\s+content="([^"]+)"', html) or \
                             re.search(r'<meta\s+name="description"\s+content="([^"]+)"', html)
                    if m_desc:
                        meta.description = m_desc.group(1).strip()

                    meta.source_service = "Wayback Machine"
                    if meta.title:
                        return meta
    except Exception as exc:
        logger.debug(f"Wayback CDX metadata lookup failed: {exc}")

    return meta


def _safe_request(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = ARCHIVE_TIMEOUT,
    stream: bool = False,
    max_redirects: int = 5,
) -> requests.Response:
    from .extractor import _is_safe_public_url

    current_url = url
    resp = None
    for _ in range(max(1, max_redirects + 1)):
        if not _is_safe_public_url(current_url):
            raise ValueError(f"Unsafe target URL: {current_url}")
        if method.upper() == "HEAD":
            resp = requests.head(current_url, headers=headers, timeout=timeout, allow_redirects=False)
        else:
            resp = requests.get(current_url, headers=headers, timeout=timeout, stream=stream, allow_redirects=False)

        is_redirect = getattr(resp, "is_redirect", False)
        status = getattr(resp, "status_code", 200)
        if (is_redirect or status in (301, 302, 303, 307, 308)) and hasattr(resp, "headers") and "Location" in resp.headers:
            location = resp.headers["Location"]
            current_url = urllib.parse.urljoin(current_url, location)
            if hasattr(resp, "close"):
                resp.close()
            continue
        return resp
    if hasattr(resp, "close"):
        resp.close()
    raise ValueError(f"Too many redirects ({max_redirects}) for URL: {url}")


def _is_safe_response_target(response: Any) -> bool:
    from .extractor import _is_safe_public_url
    target_url = getattr(response, "url", None)
    if isinstance(target_url, str) and not _is_safe_public_url(target_url):
        return False
    history = getattr(response, "history", None)
    if isinstance(history, (list, tuple)):
        for item in history:
            item_url = getattr(item, "url", None)
            if isinstance(item_url, str) and not _is_safe_public_url(item_url):
                return False
    return True


def query_archive_org_collections(
    video_id: str,
    metadata: ArchivalMetadata,
    report: Optional[Callable[[float, str], None]] = None,
) -> Optional[ArchivalStreamResult]:
    """
    Search Internet Archive (archive.org) collections (e.g. archiveteam_youtube, youtube-archive)
    for raw media files (.mp4, .mkv, .webm, .m4a) preserved under the video ID.
    """
    if report:
        report(0.25, f"Searching Internet Archive collections for '{video_id}'...")

    search_query = (
        f'identifier:(*{video_id}*) OR title:("{video_id}") OR description:("{video_id}") '
        f'OR external-identifier:("urn:youtube:{video_id}")'
    )
    search_url = (
        f"https://archive.org/advancedsearch.php?"
        f"q={urllib.parse.quote(search_query)}&fl[]=identifier,title,mediatype,collection&rows=10&output=json"
    )

    try:
        resp = requests.get(search_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
        if resp.status_code != 200:
            return None
        data = resp.json()
        docs = data.get("response", {}).get("docs", [])
        if not docs:
            return None

        for doc in docs:
            item_id = doc.get("identifier")
            if not item_id:
                continue

            # Query files metadata for this item
            meta_url = f"https://archive.org/metadata/{urllib.parse.quote(item_id)}/files"
            m_resp = requests.get(meta_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
            if m_resp.status_code != 200:
                continue

            files_data = m_resp.json()
            file_list = files_data.get("result", [])
            if not file_list:
                continue

            # Find matching video/audio files
            media_files = []
            for f in file_list:
                fname = f.get("name", "")
                fext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
                if fext in ("mp4", "mkv", "webm", "m4a", "opus", "mp3"):
                    fsize = int(f.get("size") or 0)
                    media_files.append((fname, fext, fsize))

            if not media_files:
                continue

            # Prefer file explicitly matching video_id, then largest file
            matching_files = [mf for mf in media_files if video_id in mf[0]]
            chosen_file = (
                max(matching_files, key=lambda x: x[2])
                if matching_files
                else max(media_files, key=lambda x: x[2])
            )

            fname, fext, fsize = chosen_file
            stream_url = f"https://archive.org/download/{urllib.parse.quote(item_id)}/{urllib.parse.quote(fname)}"

            # Verify accessibility
            head_resp = _safe_request("HEAD", stream_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
            try:
                if head_resp.status_code in (200, 206, 302):
                    if not _is_safe_response_target(head_resp):
                        return None
                    resolved_title = (
                        metadata.title
                        or doc.get("title")
                        or f"Archived YouTube Video ({video_id})"
                    )
                    resolved_uploader = (
                        metadata.uploader
                        or doc.get("collection", ["Internet Archive"])[0]
                    )
                    return ArchivalStreamResult(
                        found=True,
                        source_name="Internet Archive",
                        stream_url=stream_url,
                        title=resolved_title,
                        uploader=resolved_uploader,
                        description=metadata.description or f"Recovered from Internet Archive item {item_id}",
                        ext=fext,
                        duration=metadata.duration,
                        thumbnail_url=metadata.thumbnail_url,
                        is_direct_media=True,
                        item_identifier=item_id,
                    )
            finally:
                if hasattr(head_resp, "close"):
                    head_resp.close()
    except Exception as exc:
        logger.debug(f"Archive.org search error: {exc}")

    return None


def query_ghostarchive(
    video_id: str,
    metadata: ArchivalMetadata,
    report: Optional[Callable[[float, str], None]] = None,
) -> Optional[ArchivalStreamResult]:
    """
    Search Ghostarchive (ghostarchive.org) for preserved YouTube video streams.
    """
    if report:
        report(0.32, "Searching Ghostarchive varchive index...")

    url = f"https://ghostarchive.org/varchive/{video_id}"
    try:
        resp = requests.get(url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
        if resp.status_code != 200:
            return None

        html = resp.text
        # Look for video src or download link
        m_video = (
            re.search(r'<video[^>]+src="([^"]+)"', html)
            or re.search(r'<source[^>]+src="([^"]+)"', html)
            or re.search(r'<a[^>]+href="([^"]+\.mp4)"[^>]*download', html)
        )
        if not m_video:
            return None

        video_href = m_video.group(1)
        if video_href.startswith("/"):
            stream_url = f"https://ghostarchive.org{video_href}"
        else:
            stream_url = video_href

        from .extractor import _is_safe_public_url
        if not _is_safe_public_url(stream_url):
            return None

        # Verify accessibility
        try:
            head_resp = _safe_request("HEAD", stream_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
            try:
                if head_resp.status_code in (200, 206, 302):
                    if not _is_safe_response_target(head_resp):
                        return None
                    return ArchivalStreamResult(
                        found=True,
                        source_name="Ghostarchive",
                        stream_url=stream_url,
                        title=metadata.title or f"Ghostarchive Video ({video_id})",
                        uploader=metadata.uploader or "Ghostarchive Vault",
                        description=metadata.description or "Recovered from Ghostarchive preservation index.",
                        ext="mp4",
                        duration=metadata.duration,
                        thumbnail_url=metadata.thumbnail_url,
                        is_direct_media=True,
                    )
            finally:
                if hasattr(head_resp, "close"):
                    head_resp.close()
        except Exception as head_err:
            logger.debug(f"Ghostarchive stream HEAD probe failed: {head_err}")
    except Exception as exc:
        logger.debug(f"Ghostarchive query error: {exc}")

    return None


def query_wayback_machine_stream(
    video_id: str,
    metadata: ArchivalMetadata,
    report: Optional[Callable[[float, str], None]] = None,
) -> Optional[ArchivalStreamResult]:
    """
    Probe Wayback Machine CDX API for direct googlevideo playback streams or archived watch captures.
    """
    if report:
        report(0.38, "Searching Wayback Machine for direct playback streams...")

    # 1. Search for archived googlevideo playback streams
    cdx_googlevideo_url = (
        f"https://web.archive.org/cdx/search/cdx?"
        f"url=*.googlevideo.com/videoplayback*&filter=original:.*{video_id}.*&fl=timestamp,original,statuscode&filter=statuscode:200&limit=3&output=json"
    )
    try:
        resp = requests.get(cdx_googlevideo_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
        if resp.status_code == 200:
            rows = resp.json()
            if len(rows) > 1:
                latest = rows[-1]
                ts, orig_url = latest[0], latest[1]
                stream_url = f"https://web.archive.org/web/{ts}id_/{orig_url}"
                try:
                    head_resp = _safe_request("HEAD", stream_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
                    try:
                        if head_resp.status_code in (200, 206, 302):
                            if not _is_safe_response_target(head_resp):
                                return None
                            return ArchivalStreamResult(
                                found=True,
                                source_name="Wayback Machine Playback",
                                stream_url=stream_url,
                                title=metadata.title or f"Archived Playback ({video_id})",
                                uploader=metadata.uploader or "Wayback Machine",
                                description=metadata.description or "Recovered via Wayback Machine googlevideo playback snapshot.",
                                ext="mp4",
                                duration=metadata.duration,
                                thumbnail_url=metadata.thumbnail_url,
                                is_direct_media=True,
                            )
                    finally:
                        if hasattr(head_resp, "close"):
                            head_resp.close()
                except Exception as head_err:
                    logger.debug(f"Wayback stream HEAD probe failed: {head_err}")
    except Exception as exc:
        logger.debug(f"Wayback googlevideo CDX error: {exc}")

    # 2. Check for archived YouTube watch URL that yt-dlp's WaybackMachineIE can extract
    try:
        cdx_watch_url = (
            f"https://web.archive.org/cdx/search/cdx?"
            f"url=youtube.com/watch?v={video_id}&fl=timestamp,original,statuscode&filter=statuscode:200&limit=5&output=json"
        )
        resp = requests.get(cdx_watch_url, headers=ARCHIVE_HEADERS, timeout=ARCHIVE_TIMEOUT)
        if resp.status_code == 200:
            rows = resp.json()
            if len(rows) > 1:
                latest = rows[-1]
                ts, orig_url = latest[0], latest[1]
                wayback_watch_url = f"https://web.archive.org/web/{ts}/{orig_url}"
                return ArchivalStreamResult(
                    found=True,
                    source_name="Wayback Machine",
                    stream_url=wayback_watch_url,
                    title=metadata.title or f"Wayback Snapshot ({video_id})",
                    uploader=metadata.uploader or "Wayback Machine",
                    description=metadata.description or "Recovered via Wayback Machine watch page snapshot.",
                    ext="mp4",
                    duration=metadata.duration,
                    thumbnail_url=metadata.thumbnail_url,
                    is_direct_media=False,  # Can be ingested by yt-dlp's WaybackMachineIE
                )
    except Exception as exc:
        logger.debug(f"Wayback watch CDX error: {exc}")

    return None


def probe_archival_vaults(
    source: str,
    report: Optional[Callable[[float, str], None]] = None,
) -> Optional[ArchivalStreamResult]:
    """
    Main entry point for Archival Recovery.
    Given a URL or ID, systematically discovers historical metadata and attempts
    to locate preserved video streams across Internet Archive, Ghostarchive, and Wayback Machine.
    """
    video_id = extract_youtube_id(source)
    if not video_id:
        return None

    if report:
        report(0.16, f"Initiating Archival Recovery Protocol for '{video_id}'...", force=True)

    # Phase 1: Metadata Fingerprinting
    metadata = lookup_historical_metadata(video_id, report=report)
    if metadata.title and report:
        report(
            0.22,
            f"Identified original metadata via {metadata.source_service}: '{metadata.title}'"
            + (f" by {metadata.uploader}" if metadata.uploader else ""),
            force=True,
        )

    # Phase 2: Direct Media Stream Recovery
    # Step A: Archive.org Collections (ArchiveTeam & YouTube collections)
    res = query_archive_org_collections(video_id, metadata, report=report)
    if res and res.found:
        if report:
            report(0.40, f"Found preserved media in Internet Archive item '{res.item_identifier}'!", force=True)
        return res

    # Step B: Ghostarchive
    res = query_ghostarchive(video_id, metadata, report=report)
    if res and res.found:
        if report:
            report(0.40, "Found preserved media in Ghostarchive vault!", force=True)
        return res

    # Step C: Wayback Machine Direct Stream / Watch Capture
    res = query_wayback_machine_stream(video_id, metadata, report=report)
    if res and res.found:
        if report:
            report(0.40, f"Found capture in {res.source_name}!", force=True)
        return res

    if report:
        meta_info = f"'{metadata.title}'" if metadata.title else f"ID {video_id}"
        report(
            0.45,
            f"Archival search complete: no preserved video streams found across public archives for {meta_info}.",
            force=True,
        )

    return None


def download_archival_stream(
    stream_result: ArchivalStreamResult,
    output_dir: str,
    abort_event: Optional[Any] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """
    Download a discovered archival stream file and construct a valid JaneConverter stream dictionary.
    """
    from .converter import probe_media_streams

    os.makedirs(output_dir, exist_ok=True)
    ext = (stream_result.ext or "mp4").lstrip(".")
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", stream_result.item_identifier or "archived_media")
    dest_filename = f"{safe_id}.{ext}"
    dest_path = os.path.join(output_dir, dest_filename)

    if progress_callback:
        progress_callback(0.45, f"Downloading recovered stream from {stream_result.source_name}...")

    if stream_result.is_direct_media:
        from .extractor import _is_safe_public_url
        if not _is_safe_public_url(stream_result.stream_url):
            raise ValueError("Archival stream URL failed public safety verification.")
        resp = _safe_request("GET", stream_result.stream_url, headers=ARCHIVE_HEADERS, stream=True, timeout=30)
        try:
            if not _is_safe_response_target(resp):
                raise ValueError("Archival stream URL redirected to an unsafe target.")
            if resp.status_code not in (200, 206):
                raise RuntimeError(f"Failed to download archival stream from {stream_result.source_name} (HTTP {resp.status_code})")

            total_len = int(resp.headers.get("content-length") or 0)
            downloaded = 0
            try:
                with open(dest_path, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=128 * 1024):
                        if abort_event and abort_event.is_set():
                            raise KeyboardInterrupt("Archival stream download aborted by user.")
                        if chunk:
                            f.write(chunk)
                            downloaded += len(chunk)
                            if downloaded > 2 * 1024 * 1024 * 1024:
                                raise RuntimeError("Archival media stream exceeds the 2 GB limit.")
                            if total_len > 0 and progress_callback:
                                pct = 0.45 + (downloaded / total_len) * 0.30
                                progress_callback(
                                    pct,
                                    f"Downloading {stream_result.source_name} media: {downloaded // 1024} KB / {total_len // 1024} KB"
                                )
            except BaseException:
                if os.path.exists(dest_path):
                    try:
                        os.remove(dest_path)
                    except OSError:
                        pass
                raise
        finally:
            if hasattr(resp, "close"):
                resp.close()
    else:
        import yt_dlp
        ydl_opts = {
            "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([stream_result.stream_url])
        downloaded_files = [
            os.path.join(output_dir, f)
            for f in os.listdir(output_dir)
            if os.path.isfile(os.path.join(output_dir, f))
        ]
        if not downloaded_files:
            raise RuntimeError("Could not retrieve media file from Wayback snapshot.")
        dest_path = max(downloaded_files, key=os.path.getmtime)

    if progress_callback:
        progress_callback(0.75, "Archival stream download complete. Preparing conversion...")

    probe = probe_media_streams(dest_path)
    duration = stream_result.duration
    width = None
    height = None
    vcodec = ""
    acodec = ""

    if probe:
        fmt = probe.get("format", {})
        if not duration and fmt.get("duration"):
            try:
                duration = float(fmt["duration"])
            except (ValueError, TypeError):
                pass
        for s in probe.get("streams", []):
            codec_type = s.get("codec_type")
            if codec_type == "video" and not vcodec:
                vcodec = s.get("codec_name", "")
                width = s.get("width")
                height = s.get("height")
            elif codec_type == "audio" and not acodec:
                acodec = s.get("codec_name", "")

    thumb_path = None
    if stream_result.thumbnail_url:
        try:
            from .extractor import download_and_convert_thumbnail
            t_path = os.path.join(output_dir, "archived_cover.jpg")
            thumb_path = download_and_convert_thumbnail(stream_result.thumbnail_url, t_path)
        except Exception:
            pass

    return {
        "media_path": dest_path,
        "title": stream_result.title,
        "artist": stream_result.uploader,
        "album": f"Archived from {stream_result.source_name}",
        "year": "",
        "description": stream_result.description,
        "tags": ["archived", stream_result.source_name.lower().replace(" ", "-")],
        "categories": ["Archival"],
        "webpage_url": stream_result.stream_url,
        "thumbnail_url": stream_result.thumbnail_url or "",
        "thumbnail_path": thumb_path,
        "duration": duration or 0,
        "source_format": ext,
        "source_format_id": "archival",
        "source_width": width,
        "source_height": height,
        "source_video_codec": vcodec,
        "source_audio_codec": acodec,
        "source_type": "archival",
        "is_local": False,
        "recovered_from_archive": True,
        "archive_source": stream_result.source_name,
    }

