"""Instagram story extraction patch for yt-dlp.

Instagram frequently restricts or drops the legacy `/api/v1/feed/reels_media/`
endpoint, causing HTTP 500 errors and unhandled login exceptions even when valid
browser session cookies are present.

This patch enhances yt-dlp's `InstagramStoryIE` with:
1. Direct `/api/v1/media/{story_id}/info/` lookup for individual story URLs.
2. Webpage Relay preloader extraction (`xdt_api__v1__feed__reels_media`).
3. Highlights connection preloader (`xdt_api__v1__feed__reels_media__connection`).
4. Support for photo stories by synthesizing format entries from image candidates.
5. Extraction of CSRF tokens and browser headers from active cookie sessions.
"""

import threading
from typing import Any


_PATCHED = False
_LOCK = threading.Lock()


def patch_instagram_story_extractor() -> None:
    """Monkey-patch yt-dlp's InstagramStoryIE to reliably extract stories and highlights."""
    global _PATCHED
    with _LOCK:
        if _PATCHED:
            return
        try:
            from yt_dlp.extractor.instagram import InstagramStoryIE, _pk_to_id
            from yt_dlp.utils import ExtractorError, filter_dict

            if getattr(InstagramStoryIE, "_jane_patched", False):
                _PATCHED = True
                return

            orig_real_extract = InstagramStoryIE._real_extract

            def patched_real_extract(self: Any, url: str) -> Any:
                username, story_id = self._match_valid_url(url).group("user", "id")
                if username == "highlights" and not story_id:
                    raise ExtractorError("Input URL is missing a highlight ID", expected=True)
                display_id = story_id or username

                items: list[dict[str, Any]] = []
                user_info: dict[str, Any] = {}
                full_name = username
                story_title = None

                # Extract CSRF token from active cookie jar if present
                csrf = ""
                downloader = getattr(self, "_downloader", None)
                cookiejar = getattr(downloader, "cookiejar", None) or getattr(downloader, "_cookiejar", None)
                if cookiejar is not None:
                    for cookie in cookiejar:
                        if getattr(cookie, "name", None) == "csrftoken":
                            csrf = getattr(cookie, "value", "")
                            break

                api_headers = dict(self._api_headers)
                if csrf:
                    api_headers["X-CSRFToken"] = csrf
                api_headers["X-Requested-With"] = "XMLHttpRequest"
                api_headers["Referer"] = "https://www.instagram.com/"

                # Strategy 1: Direct single-story media info API if story_id is present
                if story_id and username != "highlights":
                    media_info_url = f"https://www.instagram.com/api/v1/media/{story_id}/info/"
                    media_data = self._download_json(media_info_url, display_id, fatal=False, headers=api_headers)
                    if media_data and isinstance(media_data, dict) and media_data.get("items"):
                        items = media_data["items"]
                        if items:
                            user_info = items[0].get("user") or {}
                            full_name = user_info.get("full_name") or user_info.get("username") or username

                # Strategy 2: Webpage preloaded relay states
                if not items:
                    story_info = self._download_webpage(url, display_id, fatal=False)
                    if not story_info:
                        self.raise_login_required("This content is unreachable")

                    # Standard user story tray preloader
                    preloader = self._search_json(
                        r'xdt_api__v1__feed__reels_media":',
                        story_info,
                        "relay preloader",
                        display_id,
                        fatal=False,
                    )
                    reels = (preloader or {}).get("reels_media") or []
                    for reel in reels:
                        reel_items = reel.get("items") or []
                        if reel_items:
                            user_info = reel.get("user") or reel_items[0].get("user") or {}
                            full_name = user_info.get("full_name") or user_info.get("username") or username
                            items.extend(reel_items)

                    # Highlights connection preloader
                    if not items and username == "highlights":
                        hl_preloader = self._search_json(
                            r'xdt_api__v1__feed__reels_media__connection":',
                            story_info,
                            "highlight preloader",
                            display_id,
                            fatal=False,
                        )
                        edges = (hl_preloader or {}).get("edges") or []
                        for edge in edges:
                            node = edge.get("node") or {}
                            node_items = node.get("items") or []
                            if node_items:
                                user_info = node.get("user") or node_items[0].get("user") or {}
                                full_name = user_info.get("full_name") or user_info.get("username") or username
                                story_title = node.get("title")
                                items.extend(node_items)

                # Strategy 3: Try original real_extract if neither custom strategy matched
                if not items:
                    try:
                        return orig_real_extract(self, url)
                    except Exception:
                        self.raise_login_required("You need to log in to access this content")

                if not story_title:
                    story_title = f"Story by {username}"

                info_data = []
                for item in items:
                    item.setdefault("user", {}).update(user_info)
                    highlight_data = self._extract_product(item)

                    # For photo stories, synthesize a valid format so image extraction succeeds
                    if not highlight_data.get("formats"):
                        thumbs = highlight_data.get("thumbnails") or []
                        if thumbs:
                            best_thumb = max(thumbs, key=lambda t: (t.get("width") or 0) * (t.get("height") or 0))
                            highlight_data["formats"] = [{
                                "url": best_thumb["url"],
                                "format_id": "photo",
                                "ext": "jpg",
                                "width": best_thumb.get("width"),
                                "height": best_thumb.get("height"),
                                "vcodec": "mjpeg",
                                "acodec": "none",
                            }]

                    if highlight_data.get("formats"):
                        info_data.append({
                            "uploader": full_name,
                            "uploader_id": user_info.get("pk") or user_info.get("id"),
                            **filter_dict(highlight_data),
                        })

                if not info_data:
                    raise ExtractorError("No formats found for story", expected=True)

                if username != "highlights" and story_id and not self._yes_playlist(username, story_id):
                    target_pk = str(story_id)
                    encoded_pk = _pk_to_id(story_id)
                    for entry in info_data:
                        entry_id = str(entry.get("id") or "")
                        entry_pk = str(entry.get("pk") or "")
                        if entry_id == encoded_pk or entry_pk == target_pk or entry_id == target_pk:
                            return entry
                    if len(info_data) == 1:
                        return info_data[0]

                return self.playlist_result(info_data, playlist_id=story_id or username, playlist_title=story_title)

            InstagramStoryIE._real_extract = patched_real_extract
            InstagramStoryIE._jane_patched = True
            _PATCHED = True
        except (ImportError, AttributeError):
            pass
