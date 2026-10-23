"""Facebook story extraction patch for yt-dlp.

yt-dlp has extractors for Facebook videos, reels, and ads, but lacks support
for Facebook stories (`facebook.com/stories/{bucket_id}/{story_id}/`).

This patch registers `FacebookStoryIE` with yt-dlp:
1. Matches Facebook story URLs across desktop, mobile, and web subdomains.
2. Decodes base64-encoded story IDs (`Uzpf...` -> story card IDs).
3. Sends Facebook Comet's required Sec-Fetch navigation headers so requests
   succeed with HTTP 200 rather than throwing HTTP 400 or login redirects.
4. Parses story cards and attachments from Comet's embedded Relay preloader
   scripts (`ScheduledServerJS` and `story_card_info`).
5. Extracts video streams (`playable_url_quality_hd`, `playable_url`, etc.)
   with full resolution metadata.
6. Synthesizes `vcodec='mjpeg'` format entries for photo stories so yt-dlp
   can download and convert them to any target video or image format.
7. Supports both single-story extraction and full bucket/tray playlist mode.
"""

import base64
import json
import re
import threading
from typing import Any, Optional


_PATCHED = False
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

            def scan_obj(obj: Any) -> None:
                if isinstance(obj, dict):
                    card_info = obj.get("story_card_info")
                    attachments = obj.get("attachments")
                    if card_info and attachments and isinstance(attachments, list):
                        cid = (
                            (card_info.get("story_card_id") if isinstance(card_info, dict) else None)
                            or obj.get("post_id")
                            or obj.get("id")
                        )
                        media = attachments[0].get("media", {}) if attachments else {}
                        has_media = bool(
                            media.get("playable_url")
                            or media.get("playable_url_quality_hd")
                            or media.get("image")
                            or (isinstance(card_info, dict) and card_info.get("story_thumbnail"))
                        )
                        if cid and has_media and cid not in seen_ids:
                            seen_ids.add(cid)
                            found_cards.append((str(cid), obj))
                    for v in obj.values():
                        scan_obj(v)
                elif isinstance(obj, list):
                    for item in obj:
                        scan_obj(item)

            for s in scripts:
                if "story_card_info" in s and "attachments" in s:
                    try:
                        data = json.loads(s)
                        scan_obj(data)
                    except Exception:
                        pass

            if not found_cards:
                self.raise_login_required(
                    "Could not find story media in Facebook response. Verify your browser is logged into Facebook."
                )

            # Extract author / bucket owner name if present
            author_match = re.search(r'"story_bucket_owner":\{"__typename":"User"[^}]*?"name":"([^"]+)"', webpage)
            author_name = "Facebook User"
            if author_match:
                try:
                    author_name = author_match.group(1).encode("utf-8").decode("unicode_escape")
                except Exception:
                    author_name = author_match.group(1)

            entries = []
            for cid, card in found_cards:
                card_info = card.get("story_card_info", {}) if isinstance(card.get("story_card_info"), dict) else {}
                attachments = card.get("attachments") or []
                media = attachments[0].get("media", {}) if attachments else {}

                # Thumbnail
                thumbnail = None
                if card_info.get("story_thumbnail", {}).get("uri"):
                    thumbnail = card_info["story_thumbnail"]["uri"]
                elif media.get("blurred_image", {}).get("uri"):
                    thumbnail = media["blurred_image"]["uri"]
                elif media.get("preferred_thumbnail", {}).get("image", {}).get("uri"):
                    thumbnail = media["preferred_thumbnail"]["image"]["uri"]

                formats = []
                hd_url = media.get("playable_url_quality_hd")
                sd_url = media.get("playable_url")
                width = media.get("width")
                height = media.get("height")

                if hd_url:
                    formats.append({
                        "format_id": "hd",
                        "url": hd_url,
                        "ext": "mp4",
                        "quality": 1,
                        "vcodec": "h264",
                        "acodec": "aac",
                        "width": width,
                        "height": height,
                    })
                if sd_url and sd_url != hd_url:
                    formats.append({
                        "format_id": "sd",
                        "url": sd_url,
                        "ext": "mp4",
                        "quality": 0,
                        "vcodec": "h264",
                        "acodec": "aac",
                        "width": width,
                        "height": height,
                    })

                # If photo story (no playable video streams)
                if not formats:
                    img_uri = None
                    if media.get("image", {}).get("uri"):
                        img_uri = media["image"]["uri"]
                    elif media.get("photo_image", {}).get("uri"):
                        img_uri = media["photo_image"]["uri"]
                    elif thumbnail:
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

            # If user targeted a single story ID
            if target_id:
                for entry in entries:
                    if entry["id"] == target_id or entry["id"] == raw_story_id:
                        return entry

            # Playlist mode when multiple stories exist and no single target was specified
            downloader_params = getattr(getattr(self, "_downloader", None), "params", {})
            if not downloader_params.get("noplaylist") and len(entries) > 1 and not target_id:
                return self.playlist_result(entries, playlist_id=bucket_id, playlist_title=f"Stories by {author_name}")

            return entries[0]

    return FacebookStoryIE


def patch_facebook_story_extractor() -> None:
    """Register FacebookStoryIE with yt-dlp so Facebook stories extract reliably."""
    global _PATCHED
    with _LOCK:
        if _PATCHED:
            return
        try:
            import yt_dlp.extractor as yde

            yde.import_extractors()
            if "FacebookStoryIE" in yde._extractors_context.value:
                _PATCHED = True
                return

            FacebookStoryIE = _build_facebook_story_ie()
            FacebookStoryIE._jane_patched = True

            # Prepend so FacebookStoryIE runs before GenericIE
            new_extractors = {"FacebookStoryIE": FacebookStoryIE}
            new_extractors.update(yde._extractors_context.value)
            yde._extractors_context.value = new_extractors
            _PATCHED = True
        except Exception:
            pass
