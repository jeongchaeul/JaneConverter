"""Facebook extraction patch for yt-dlp.

yt-dlp has extractors for Facebook videos, reels, and ads, but lacks support
for Facebook stories (`facebook.com/stories/{bucket_id}/{story_id}/`), and
frequently fails on modern Comet / GraphQL delivery payloads in reels and videos
with `ERROR: [facebook] ...: Cannot parse data` due to outdated regexes
and structural shifts in Facebook's RelayPrefetchedStreamCache format.

This patch provides:
1. `FacebookStoryIE`: Custom extractor for Facebook stories across desktop and mobile.
2. Comet Fallback Extractor: Patches `FacebookIE._extract_from_url` to gracefully rescue
   reels and videos from Comet's embedded Relay preloader scripts when standard parsing fails.
3. Full stream extraction for DASH manifests (MPD), progressive MP4s (HD/SD), HLS playlists,
   and clean metadata (title, message caption, uploader name/id, thumbnail, duration).
"""

import base64
import json
import re
import threading
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any, Optional

_PATCHED = False
_VIDEO_PATCHED = False
_LOCK = threading.Lock()


def decode_fb_story_id(encoded: Optional[str]) -> str:
    """Decode a Facebook story identifier if base64 encoded (e.g. UzpfSVNDOjE2NjYyNDYxOTE4ODMxMjY=)."""
    if not encoded:
        return ""
    clean = str(encoded).strip().rstrip("/")
    if clean.isdigit():
        return clean
    try:
        decoded = base64.b64decode(clean).decode("utf-8", errors="ignore")
        m = re.search(r"(\d{10,})", decoded)
        if m:
            return m.group(1)
    except Exception:
        pass
    return clean


def clean_fb_cdn_url(uri: Optional[str]) -> str:
    """Strip crop/dimension clamp parameters (e.g. ctp=s...) to get full original dimensions."""
    if not uri:
        return ""
    cleaned = re.sub(
        r"([?&])ctp=[^&]*(&)?",
        lambda m: "&" if m.group(1) == "&" and m.group(2) else ("?" if m.group(1) == "?" and m.group(2) else ""),
        uri,
    )
    return cleaned.rstrip("&").rstrip("?")


def _unescape_fb_text(raw: Optional[str]) -> str:
    """Safely decode JSON-escaped unicode strings without throwing exceptions."""
    if not raw:
        return ""
    clean = str(raw).strip()
    try:
        return json.loads(f'"{clean}"')
    except Exception:
        return re.sub(
            r"\\u([0-9a-fA-F]{4})",
            lambda m: chr(int(m.group(1), 16)),
            clean,
        ).replace(r"\/", "/")


def _extract_comet_video_data(ie: Any, webpage: str, video_id: str, url: str) -> Optional[dict]:
    """Extract formats and metadata from Facebook Comet Relay / GraphQL embedded JSON."""
    from yt_dlp.utils import qualities, url_or_none

    raw_scripts = re.findall(r"<script[^>]*\bdata-sjs\b[^>]*>(.*?)</script>", webpage)
    if not raw_scripts:
        raw_scripts = re.findall(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', webpage)

    stream_keys = (
        "videoDeliveryResponse",
        "dash_manifests",
        "dash_manifest_urls",
        "progressive_urls",
        "playable_url",
    )

    def harvest_delivery_targets(
        obj: Any,
        parent_ids: Optional[list[str]] = None,
        parent_nodes: Optional[list[Any]] = None,
    ):
        if parent_ids is None:
            parent_ids = []
        if parent_nodes is None:
            parent_nodes = []

        current_ids = list(parent_ids)
        current_nodes = list(parent_nodes)
        if isinstance(obj, dict):
            current_nodes.append(obj)
            for k in ("id", "videoId", "video_id", "legacy_token"):
                val = obj.get(k)
                if val and str(val) not in current_ids:
                    current_ids.append(str(val))
                    decoded = decode_fb_story_id(str(val))
                    if decoded and decoded not in current_ids:
                        current_ids.append(decoded)

            fmt_payload = None
            if "videoDeliveryResponseResult" in obj and isinstance(obj["videoDeliveryResponseResult"], dict):
                fmt_payload = obj["videoDeliveryResponseResult"]
            elif "videoDeliveryResponseFragment" in obj and isinstance(obj["videoDeliveryResponseFragment"], dict):
                frag = obj["videoDeliveryResponseFragment"]
                fmt_payload = frag.get("videoDeliveryResponseResult") or frag
            elif "progressive_urls" in obj and isinstance(obj["progressive_urls"], list):
                fmt_payload = obj

            if fmt_payload:
                payload_id = fmt_payload.get("id")
                target_ids = list(current_ids)
                if payload_id and str(payload_id) not in target_ids:
                    target_ids.append(str(payload_id))
                    decoded = decode_fb_story_id(str(payload_id))
                    if decoded and decoded not in target_ids:
                        target_ids.append(decoded)
                yield (target_ids, fmt_payload, current_nodes)

            for v in obj.values():
                yield from harvest_delivery_targets(v, current_ids, current_nodes)
        elif isinstance(obj, list):
            for item in obj:
                yield from harvest_delivery_targets(item, current_ids, current_nodes)

    all_targets = []
    for s in raw_scripts:
        if not any(k in s for k in stream_keys):
            continue
        try:
            data = json.loads(s)
            for item in harvest_delivery_targets(data):
                all_targets.append(item)
        except Exception:
            continue

    if not all_targets:
        return None

    # Filter targets strictly by video_id to prevent multi-video stream mixing
    target_id_str = str(video_id).strip()
    matching_targets = [
        t for t in all_targets
        if any(target_id_str == i or target_id_str in i for i in t[0])
    ]

    if matching_targets:
        selected_targets = matching_targets
    else:
        # If no explicit match, isolate by the first video's identity so we never mix streams across different videos
        first_group_id = all_targets[0][0][0] if all_targets[0][0] else None
        if first_group_id:
            selected_targets = [t for t in all_targets if t[0] and t[0][0] == first_group_id]
        else:
            selected_targets = [all_targets[0]]

    formats = []
    q = qualities(["sd", "hd"])

    def process_delivery_result(fmt_data: dict, enclosing_node: Optional[dict] = None) -> None:
        if not fmt_data or not isinstance(fmt_data, dict):
            return

        # DASH MPD manifests
        dash_manifests = fmt_data.get("dash_manifests") or []
        mpd_urls = [
            u.get("manifest_url")
            for u in (fmt_data.get("dash_manifest_urls") or [])
            if isinstance(u, dict) and url_or_none(u.get("manifest_url"))
        ]
        for idx, dm in enumerate(dash_manifests):
            if not isinstance(dm, dict):
                continue
            manifest_xml = dm.get("manifest_xml")
            if manifest_xml:
                try:
                    unquoted_mpd = urllib.parse.unquote_plus(manifest_xml)
                    if "<!doctype" not in unquoted_mpd.lower() and "<!entity" not in unquoted_mpd.lower():
                        parsed_mpd = ET.fromstring(unquoted_mpd)
                        mpd_url = mpd_urls[idx] if idx < len(mpd_urls) else None
                        formats.extend(ie._parse_mpd_formats(parsed_mpd, mpd_url=mpd_url))
                except Exception:
                    pass

        raw_manifest_str = (
            fmt_data.get("dash_manifest")
            or fmt_data.get("dash_manifest_xml_string")
            or fmt_data.get("manifest_xml")
        )
        if raw_manifest_str and isinstance(raw_manifest_str, str):
            try:
                unquoted_mpd = urllib.parse.unquote_plus(raw_manifest_str)
                if "<!doctype" not in unquoted_mpd.lower() and "<!entity" not in unquoted_mpd.lower():
                    parsed_mpd = ET.fromstring(unquoted_mpd)
                    formats.extend(ie._parse_mpd_formats(parsed_mpd))
            except Exception:
                pass

        if not dash_manifests and not raw_manifest_str and mpd_urls:
            for mpd_url in mpd_urls:
                try:
                    formats.extend(ie._extract_mpd_formats(mpd_url, video_id, fatal=False))
                except Exception:
                    pass

        # Progressive MP4 URLs (HD / SD)
        for prog in fmt_data.get("progressive_urls") or []:
            if not isinstance(prog, dict):
                continue
            p_url = prog.get("progressive_url")
            if not p_url:
                continue
            meta = prog.get("metadata") or {}
            quality_label = str(meta.get("quality", "sd")).lower()
            formats.append({
                "format_id": quality_label,
                "quality": q(quality_label) - 3,
                "url": p_url,
                "ext": "mp4",
                "vcodec": "h264",
                "http_headers": {"User-Agent": "facebookexternalhit/1.1"},
                "downloader_options": {"http_chunk_size": 250 << 20},
            })

        # HLS Playlist URLs
        for m3u8_entry in fmt_data.get("hls_playlist_urls") or []:
            if isinstance(m3u8_entry, dict) and url_or_none(m3u8_entry.get("hls_playlist_url")):
                try:
                    formats.extend(
                        ie._extract_m3u8_formats(
                            m3u8_entry["hls_playlist_url"],
                            video_id,
                            "mp4",
                            fatal=False,
                            m3u8_id="hls",
                        )
                    )
                except Exception:
                    pass

        # Legacy playable URLs
        for key, fid in (
            ("playable_url_quality_hd", "hd"),
            ("playable_url", "sd"),
            ("browser_native_hd_url", "hd"),
            ("browser_native_sd_url", "sd"),
        ):
            raw_url = fmt_data.get(key) or (enclosing_node.get(key) if isinstance(enclosing_node, dict) else None)
            if raw_url and url_or_none(raw_url):
                formats.append({
                    "format_id": fid,
                    "quality": q(fid) - 3,
                    "url": raw_url,
                    "ext": "mp4",
                    "vcodec": "h264",
                    "http_headers": {"User-Agent": "facebookexternalhit/1.1"},
                    "downloader_options": {"http_chunk_size": 250 << 20},
                })

    for ids, payload, nodes in selected_targets:
        enc_node = nodes[-1] if nodes else None
        process_delivery_result(payload, enc_node)

    if not formats:
        return None

    # Deduplicate formats by URL and attach standard bypass headers
    seen_urls = set()
    unique_formats = []
    for f in formats:
        u = f.get("url")
        if u and u in seen_urls:
            continue
        if u:
            seen_urls.add(u)
        f.setdefault("http_headers", {})["User-Agent"] = "facebookexternalhit/1.1"
        f.setdefault("downloader_options", {})["http_chunk_size"] = 250 << 20
        unique_formats.append(f)

    # Metadata extraction from matched nodes first
    matched_nodes = selected_targets[0][2] if selected_targets else []
    uploader = None
    uploader_id = None
    title = None
    description = None
    thumbnail = None
    duration = None
    timestamp = None

    for n in reversed(matched_nodes):
        if isinstance(n, dict):
            if not uploader and "owner" in n and isinstance(n["owner"], dict):
                uploader = n["owner"].get("name")
                uploader_id = n["owner"].get("id")
            if not uploader and "actors" in n and isinstance(n["actors"], list) and n["actors"]:
                first_actor = n["actors"][0]
                if isinstance(first_actor, dict):
                    uploader = first_actor.get("name")
                    uploader_id = first_actor.get("id")
            if not duration:
                if "length_in_second" in n and n["length_in_second"] is not None:
                    try:
                        duration = float(n["length_in_second"])
                    except Exception:
                        pass
                elif "playable_duration_in_ms" in n and n["playable_duration_in_ms"] is not None:
                    try:
                        duration = float(n["playable_duration_in_ms"]) / 1000.0
                    except Exception:
                        pass
            if not thumbnail:
                if "preferred_thumbnail" in n and isinstance(n["preferred_thumbnail"], dict):
                    thumbnail = (n["preferred_thumbnail"].get("image") or {}).get("uri")
                elif "thumbnailImage" in n and isinstance(n["thumbnailImage"], dict):
                    thumbnail = n["thumbnailImage"].get("uri")
                elif "first_frame_thumbnail" in n and isinstance(n["first_frame_thumbnail"], str):
                    thumbnail = n["first_frame_thumbnail"]
            if not title:
                if "name" in n and isinstance(n["name"], str) and n["name"].strip():
                    title = n["name"].strip()
                elif "title" in n and isinstance(n["title"], str) and n["title"].strip():
                    title = n["title"].strip()
                elif "savable_description" in n and isinstance(n["savable_description"], dict):
                    title = n["savable_description"].get("text")
                    description = title
                elif "creation_story" in n and isinstance(n["creation_story"], dict):
                    msg = (n["creation_story"].get("message") or {}).get("text")
                    if msg:
                        title = msg
                        description = msg
            if not timestamp:
                if "publish_time" in n and n["publish_time"] is not None:
                    try:
                        timestamp = int(n["publish_time"])
                    except Exception:
                        pass
                elif "creation_time" in n and n["creation_time"] is not None:
                    try:
                        timestamp = int(n["creation_time"])
                    except Exception:
                        pass

    # Webpage regex fallbacks for any missing metadata
    if not uploader:
        m_actor = re.search(r'"actors"\s*:\s*\[\s*\{[^}]*"name"\s*:\s*"([^"]+)"', webpage)
        if m_actor:
            uploader = _unescape_fb_text(m_actor.group(1))
        else:
            m_owner = re.search(r'"owner"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"', webpage)
            if m_owner:
                uploader = _unescape_fb_text(m_owner.group(1))

    if not uploader_id:
        m_uid = re.search(r'"actors"\s*:\s*\[\s*\{[^}]*"id"\s*:\s*"(\d+)"', webpage)
        if m_uid:
            uploader_id = m_uid.group(1)
        else:
            m_oid = re.search(r'"owner"\s*:\s*\{[^}]*"id"\s*:\s*"(\d+)"', webpage)
            if m_oid:
                uploader_id = m_oid.group(1)

    if not title:
        m_msg = re.search(r'"message"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"', webpage)
        if m_msg:
            description = _unescape_fb_text(m_msg.group(1))
            title = description
    if not title:
        m_desc = re.search(r'"savable_description"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"', webpage)
        if m_desc:
            description = _unescape_fb_text(m_desc.group(1))
            title = description
    if not title:
        title = f"Reel by {uploader}" if uploader else f"Facebook video #{video_id}"

    if not thumbnail:
        m_thumb = re.search(r'"preferred_thumbnail"\s*:\s*\{\s*"image"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"', webpage)
        if m_thumb:
            thumbnail = m_thumb.group(1).replace(r"\/", "/").replace(r"\u0025", "%")
        else:
            m_t2 = re.search(r'"thumbnailImage"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"', webpage)
            if m_t2:
                thumbnail = m_t2.group(1).replace(r"\/", "/").replace(r"\u0025", "%")

    if not duration:
        dur_m = re.search(r'"length_in_second"\s*:\s*([\d\.]+)', webpage)
        if dur_m:
            try:
                duration = float(dur_m.group(1))
            except Exception:
                pass

    if not timestamp:
        time_m = re.search(r'"publish_time"\s*:\s*(\d{9,12})', webpage)
        timestamp = int(time_m.group(1)) if time_m else None

    return {
        "id": video_id,
        "title": title,
        "description": description,
        "uploader": uploader,
        "uploader_id": uploader_id,
        "thumbnail": thumbnail,
        "duration": duration,
        "timestamp": timestamp,
        "formats": unique_formats,
    }


def _fallback_extract_comet_video(ie: Any, url: str, video_id: str) -> dict:
    """Download Comet web pages and rescue media streams when standard yt-dlp parsing fails."""
    import yt_dlp.utils

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

    candidates = [
        f"https://www.facebook.com/reel/{video_id}",
        url.replace("://m.facebook.com/", "://www.facebook.com/"),
        f"https://www.facebook.com/watch/?v={video_id}",
    ]
    seen = set()
    unique_candidates = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique_candidates.append(c)

    login_required_detected = False
    for target_url in unique_candidates:
        webpage = ie._download_webpage(target_url, video_id, headers=headers, fatal=False)
        if not webpage:
            continue
        if any(marker in webpage for marker in (
            ">You must log in to continue",
            'id="login_form"',
            'id="loginbutton"',
            'name="login"',
            "useCometLogInFormQuery",
        )):
            login_required_detected = True

        info = _extract_comet_video_data(ie, webpage, video_id, target_url)
        if info and info.get("formats"):
            return info

    if login_required_detected:
        ie.raise_login_required("This Facebook media requires sign-in. Use --browser-session to extract.")
    raise yt_dlp.utils.ExtractorError("Cannot parse data")


def _patch_facebook_video_extractors() -> None:
    """Patch yt-dlp FacebookIE and FacebookReelIE to handle Comet Relay streams."""
    global _VIDEO_PATCHED
    if _VIDEO_PATCHED:
        return

    try:
        import yt_dlp.extractor.facebook as fb_mod
        from yt_dlp.utils import ExtractorError

        if not getattr(fb_mod.FacebookIE, "_jane_comet_patched", False):
            orig_extract_from_url = fb_mod.FacebookIE._extract_from_url

            def patched_extract_from_url(self, url, video_id):
                try:
                    res = orig_extract_from_url(self, url, video_id)
                    if res and (res.get("formats") or res.get("entries")):
                        return res
                except ExtractorError as err:
                    msg = str(err).lower()
                    if "the video is not available, facebook said" in msg or "login required" in msg:
                        raise
                return _fallback_extract_comet_video(self, url, video_id)

            fb_mod.FacebookIE._extract_from_url = patched_extract_from_url
            fb_mod.FacebookIE._jane_comet_patched = True

        if not getattr(fb_mod.FacebookReelIE, "_jane_comet_patched", False):
            def patched_reel_extract(self, url):
                video_id = self._match_id(url)
                return self.url_result(
                    f"https://m.facebook.com/watch/?v={video_id}&_rdr",
                    fb_mod.FacebookIE,
                    video_id,
                )

            fb_mod.FacebookReelIE._real_extract = patched_reel_extract
            fb_mod.FacebookReelIE._jane_comet_patched = True

        _VIDEO_PATCHED = True
    except Exception:
        pass


def _build_facebook_story_ie():
    from yt_dlp.extractor.common import InfoExtractor
    from yt_dlp.utils import ExtractorError

    class FacebookStoryIE(InfoExtractor):
        IE_NAME = "facebook:story"
        _VALID_URL = r"https?://(?:[\w-]+\.)?facebook\.com/stories/(?P<bucket_id>\d+)(?:/(?P<story_id>[^/?#&]+))?"

        def _real_extract(self, url: str) -> Any:
            m = self._match_valid_url(url)
            bucket_id = m.group("bucket_id")
            raw_story_id = m.group("story_id")
            target_id = decode_fb_story_id(raw_story_id)
            display_id = target_id or bucket_id or "facebook_story"

            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
            }

            webpage = self._download_webpage(url, display_id, headers=headers, fatal=False)
            if not webpage:
                self.raise_login_required("This Facebook story is unreachable or requires an active browser session.")

            last_url = getattr(getattr(self, "_downloader", None), "last_url", "") or ""
            if "/login" in last_url or 'name="login"' in webpage:
                self.raise_login_required("This Facebook story requires sign-in. Use --browser-session to extract.")

            # Extract story cards
            scripts = re.findall(r"<script[^>]*>(.*?)</script>", webpage, re.DOTALL)
            found_cards = []
            seen_ids = set()

            for s in scripts:
                if "story_card_info" not in s and "story_card_id" not in s:
                    continue
                try:
                    data = json.loads(s)
                except Exception:
                    continue

                def search_cards(obj):
                    if isinstance(obj, dict):
                        if "story_card_info" in obj:
                            c_id = obj["story_card_info"].get("story_card_id")
                            if c_id and c_id not in seen_ids:
                                seen_ids.add(c_id)
                                found_cards.append(obj)
                        for val in obj.values():
                            search_cards(val)
                    elif isinstance(obj, list):
                        for item in obj:
                            search_cards(item)

                search_cards(data)

            if not found_cards:
                self.raise_login_required("Could not find story media in Facebook response. Verify your browser is logged into Facebook.")

            # Resolve author name
            author_name = "Facebook User"
            m_author = re.search(r'"story_bucket_owner":\{"__typename":"User","name":"([^"]+)"\}', webpage)
            if m_author:
                author_name = m_author.group(1)

            entries = []
            for card in found_cards:
                c_info = card.get("story_card_info") or {}
                cid = c_info.get("story_card_id")
                thumbnail = clean_fb_cdn_url((c_info.get("story_thumbnail") or {}).get("uri"))
                formats = []

                # Video streams
                attachments = card.get("attachments") or []
                for att in attachments:
                    media = att.get("media") or {}
                    if media.get("__typename") != "Video":
                        continue
                    w = media.get("width")
                    h = media.get("height")
                    for k, fid in [
                        ("playable_url_quality_hd", "hd"),
                        ("playable_url", "sd"),
                        ("browser_native_hd_url", "hd"),
                        ("browser_native_sd_url", "sd"),
                    ]:
                        v_url = media.get(k)
                        if v_url:
                            formats.append({
                                "format_id": fid,
                                "url": v_url,
                                "ext": "mp4",
                                "vcodec": "h264",
                                "width": w,
                                "height": h,
                                "preference": 20 if "hd" in fid else 10,
                            })

                # Photo stories synthesis
                if not formats:
                    img_uri = None
                    width = None
                    height = None
                    for att in attachments:
                        media = att.get("media") or {}
                        if media.get("__typename") == "Photo" and media.get("image"):
                            img_uri = clean_fb_cdn_url(media["image"].get("uri"))
                            width = media["image"].get("width")
                            height = media["image"].get("height")
                            break
                    if not img_uri:
                        for att in attachments:
                            media = att.get("media") or {}
                            if media.get("photo_image"):
                                img_uri = media["photo_image"].get("uri")
                                break
                    if not img_uri and thumbnail:
                        img_uri = clean_fb_cdn_url(thumbnail)

                    if img_uri:
                        formats.append({
                            "format_id": "photo",
                            "url": img_uri,
                            "ext": "jpg",
                            "vcodec": "mjpeg",
                            "acodec": "none",
                            "width": width,
                            "height": height,
                            "preference": 10,
                        })

                if not formats:
                    continue

                title = f"Story by {author_name}"
                entries.append({
                    "id": str(cid),
                    "title": title,
                    "uploader": author_name,
                    "uploader_id": bucket_id,
                    "thumbnail": thumbnail,
                    "formats": formats,
                })

            if not entries:
                raise ExtractorError("No valid video or photo streams found in Facebook story.", expected=True)

            if target_id:
                for entry in entries:
                    if entry["id"] == target_id or entry["id"] == raw_story_id:
                        return entry

            downloader_params = getattr(getattr(self, "_downloader", None), "params", {})
            if not downloader_params.get("noplaylist") and len(entries) > 1 and not target_id:
                return self.playlist_result(entries, playlist_id=bucket_id, playlist_title=f"Stories by {author_name}")

            return entries[0]

    return FacebookStoryIE


def patch_facebook_story_extractor() -> None:
    """Register FacebookStoryIE with yt-dlp and patch FacebookIE Comet fallback."""
    global _PATCHED
    with _LOCK:
        try:
            import yt_dlp.extractor as yde

            yde.import_extractors()
            if "FacebookStoryIE" not in yde._extractors_context.value:
                FacebookStoryIE = _build_facebook_story_ie()
                FacebookStoryIE._jane_patched = True

                new_extractors = {"FacebookStoryIE": FacebookStoryIE}
                new_extractors.update(yde._extractors_context.value)
                yde._extractors_context.value = new_extractors

            _patch_facebook_video_extractors()
            _PATCHED = True
        except Exception:
            pass


patch_facebook_extractors = patch_facebook_story_extractor
