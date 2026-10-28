"""
Streaming metadata resolution and track cataloging.
Resolves public metadata and search candidates for Spotify and Apple Music URLs.
"""

from __future__ import annotations

import html
import json
import re
import urllib.parse
from typing import Any, Callable, Dict, Optional
import requests

from .version import __version__


def format_duration(seconds: int) -> str:
    """Formats duration seconds into mm:ss or hh:mm:ss string."""
    if not seconds or seconds <= 0:
        return "0:00"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"

def build_search_candidates(artist: str, title: str) -> list:
    """
    Builds prioritized search queries to locate the best matching audio stream.
    Strips search syntax operators (colons, slashes, commas, question marks)
    and control characters that cause YouTube/SoundCloud search engines to drop matches.
    """
    def clean(s: str) -> str:
        s = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', str(s or ""))
        s = s.replace("\xa0", " ").replace(":", " ").replace("/", " ").replace("\\", " ").replace(",", " ")
        s = re.sub(r'[\?\"\'\!\*\<\>\|\^]', ' ', s)
        return re.sub(r'\s+', ' ', s).strip()

    c_art = clean(artist) if artist and artist != "Unknown Artist" else ""
    c_tit = clean(title) if title else ""
    prim_art_str = re.split(r'[,&]|\bfeat\b|\bft\b', str(artist or ""), flags=re.IGNORECASE)[0].strip()
    prim_art = clean(prim_art_str) if prim_art_str and prim_art_str != "Unknown Artist" else ""

    # Clean base title without parenthetical annotations or remaster tags
    clean_base_tit = re.sub(r'\s*[\(\[].*?[\)\]]', '', c_tit).strip()
    clean_base_tit = re.sub(r'\s*-\s*(?:remaster|remastered|bonus track|single version|radio edit|edit).*$', '', clean_base_tit, flags=re.IGNORECASE).strip()
    clean_base_tit = clean(clean_base_tit)

    candidates = []
    if c_art and c_tit:
        candidates.append(f"ytsearch1:{c_art} {c_tit} official audio")
        candidates.append(f"ytsearch1:{c_art} {c_tit} topic")
        candidates.append(f"ytsearch1:{c_art} {c_tit}")
    if prim_art and c_tit and prim_art != c_art:
        candidates.append(f"ytsearch1:{prim_art} {c_tit}")
    if clean_base_tit and clean_base_tit != c_tit and prim_art:
        candidates.append(f"ytsearch1:{prim_art} {clean_base_tit}")
    if c_art and c_tit:
        candidates.append(f"ytsearch1:{c_art} {c_tit} topic")
    if prim_art and c_tit:
        candidates.append(f"ytsearch1:{prim_art} {c_tit} topic")
    if clean_base_tit and prim_art:
        candidates.append(f"ytsearch1:{clean_base_tit} {prim_art} topic")
    if c_tit and prim_art:
        candidates.append(f"ytsearch1:{c_tit} {prim_art}")
    if c_tit:
        candidates.append(f"ytsearch1:{c_tit}")
    if clean_base_tit and clean_base_tit != c_tit:
        candidates.append(f"ytsearch1:{clean_base_tit}")
    if c_art and c_tit:
        candidates.append(f"scsearch1:{c_art} {c_tit}")
    if prim_art and c_tit:
        candidates.append(f"scsearch1:{prim_art} {c_tit}")
    if clean_base_tit and prim_art:
        candidates.append(f"scsearch1:{prim_art} {clean_base_tit}")

    seen = set()
    result = []
    for c in candidates:
        if c not in seen and c.strip():
            seen.add(c)
            result.append(c)
    return result

def _apple_music_url_parts(apple_url: str) -> Dict[str, str]:
    """Extract the storefront, resource kind, and IDs from an Apple Music URL."""
    parsed = urllib.parse.urlparse(apple_url.strip())
    path_parts = [part for part in parsed.path.split("/") if part]
    storefront = path_parts[0].lower() if path_parts else "us"
    kind = ""
    resource_id = ""
    for index, part in enumerate(path_parts[1:], 1):
        if part.lower() in {"song", "album", "playlist", "artist", "music-video", "station"}:
            kind = part.lower()
            if index + 2 < len(path_parts):
                resource_id = path_parts[index + 2]
            elif index + 1 < len(path_parts):
                resource_id = path_parts[index + 1]
            break
    track_id = (urllib.parse.parse_qs(parsed.query).get("i") or [""])[0]
    return {
        "storefront": storefront if re.fullmatch(r"[a-z]{2}", storefront) else "us",
        "kind": kind,
        "resource_id": resource_id,
        "track_id": track_id,
    }

def _apple_artwork_url(url: str, size: int = 1000) -> str:
    """Request a larger rendition of an iTunes/Apple Music artwork URL."""
    if not url:
        return ""
    if "{w}" in url and "{h}" in url:
        return url.replace("{w}", str(size)).replace("{h}", str(size)).replace("{f}", "jpg")
    return re.sub(r"/\d+x\d+(?:bb)?\.(?:jpg|png)$", f"/{size}x{size}bb.jpg", url)

def _apple_music_result_metadata(result: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize one iTunes Search API result into JaneConverter metadata."""
    title = result.get("trackName") or result.get("collectionName") or "Unknown Track"
    artist = result.get("artistName") or "Unknown Artist"
    album = result.get("collectionName") or ""
    release_date = str(result.get("releaseDate") or "")
    artwork = _apple_artwork_url(result.get("artworkUrl100") or "")
    candidates = build_search_candidates(artist, title)
    return {
        "title": title,
        "artist": artist,
        "album": album,
        "year": release_date[:4] if len(release_date) >= 4 else "",
        "search_query": candidates[0] if candidates else title,
        "search_candidates": candidates,
        "thumbnail": artwork,
        "thumbnail_url": artwork,
        "description": "",
        "track_id": str(result.get("trackId") or ""),
        "source_url": result.get("trackViewUrl") or result.get("collectionViewUrl") or "",
        "preview_url": result.get("previewUrl") or "",
        "duration": int(result.get("trackTimeMillis") or 0) // 1000,
    }

def resolve_apple_music_metadata(apple_url: str) -> Dict[str, Any]:
    """Resolve a public Apple Music song link through Apple's catalog lookup.

    The catalog supplies metadata, artwork, IDs, and a short preview. It does
    not expose subscription audio as a normal downloadable stream, so the
    returned title and artist locate an available full stream through
    JaneConverter's existing supported-source search path.
    """
    parts = _apple_music_url_parts(apple_url)
    storefront = parts["storefront"]
    lookup_id = parts["track_id"] or (parts["resource_id"] if parts["kind"] in {"song", "album"} else "")
    if not lookup_id or parts["kind"] not in {"song", "album", "playlist"}:
        raise RuntimeError(
            "Apple Music link must point to a public song or an album track (with ?i=track-id)."
        )

    response = requests.get(
        "https://itunes.apple.com/lookup",
        params={"id": lookup_id, "entity": "song", "country": storefront, "limit": 200},
        headers={"User-Agent": f"JaneConverter/{__version__} (+local media utility)"},
        timeout=12,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Apple catalog lookup returned HTTP status {response.status_code}")
    results = response.json().get("results") or []
    if parts["track_id"]:
        results = [item for item in results if str(item.get("trackId")) == parts["track_id"]]
    else:
        results = [item for item in results if item.get("kind") == "song"]
    if not results:
        raise RuntimeError("Apple Music catalog did not return a public track for this link.")
    return _apple_music_result_metadata(results[0])

def fetch_apple_music_playlist_entries(apple_url: str, progress_callback: Optional[Callable[[float, str], None]] = None) -> Dict[str, Any]:
    """Fetch public Apple Music playlist or album tracks."""
    parts = _apple_music_url_parts(apple_url)
    if parts["track_id"]:
        raise RuntimeError(
            "Apple Music playlist loading expects a playlist or album link without an individual track selector (?i=...)."
        )

    # 1. User-created or curated playlist via serialized server data
    if parts["kind"] == "playlist":
        if progress_callback:
            progress_callback(0.1, "Connecting to Apple Music public playlist service...")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
        if progress_callback:
            progress_callback(0.25, "Fetching Apple Music playlist preview...")
        resp = requests.get(apple_url, headers=headers, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f"Apple Music playlist page returned HTTP status {resp.status_code}")

        m_data = re.search(r'<script[^>]*id=["\']serialized-server-data["\'][^>]*>(.*?)</script>', resp.text, re.DOTALL)
        if not m_data:
            raise RuntimeError("Could not locate Apple Music public playlist catalog in page response.")

        try:
            payload = json.loads(m_data.group(1))
            root_data = payload.get("data", [])
            sections = []
            if root_data and isinstance(root_data, list):
                first_node = root_data[0]
                if isinstance(first_node, dict):
                    sections = first_node.get("data", {}).get("sections", [])
        except Exception as e:
            raise RuntimeError(f"Failed to parse Apple Music playlist catalog: {e}") from e

        playlist_title = "Apple Music Playlist"
        playlist_cover = ""
        for sec in sections:
            if sec.get("itemKind") == "containerDetailHeaderLockup":
                items = sec.get("items") or []
                if items:
                    h = items[0]
                    playlist_title = h.get("title") or playlist_title
                    art = h.get("artwork") or {}
                    art_dict = art.get("dictionary") if isinstance(art, dict) else {}
                    if isinstance(art_dict, dict) and art_dict.get("url"):
                        playlist_cover = _apple_artwork_url(art_dict.get("url"))
                break

        if playlist_title == "Apple Music Playlist":
            og_title = re.search(r'<meta property=["\']og:title["\'] content=["\'](.*?)["\']', resp.text)
            if og_title:
                playlist_title = html.unescape(og_title.group(1))
        if not playlist_cover:
            og_img = re.search(r'<meta property=["\']og:image["\'] content=["\'](.*?)["\']', resp.text)
            if og_img:
                playlist_cover = _apple_artwork_url(html.unescape(og_img.group(1)))

        raw_tracks = []
        for sec in sections:
            if sec.get("itemKind") == "trackLockup":
                raw_tracks.extend(sec.get("items") or [])

        if not raw_tracks:
            raise RuntimeError("Apple Music playlist did not contain any public tracks.")

        if progress_callback:
            progress_callback(0.7, f"Extracting {len(raw_tracks)} tracks from {playlist_title}...")

        entries = []
        for idx, item in enumerate(raw_tracks, 1):
            t_title = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', item.get("title") or f"Track {idx}").strip()
            t_artist = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', item.get("artistName") or "Unknown Artist").strip()
            dur = item.get("duration") or 0
            t_dur_sec = (dur // 1000) if dur > 1000 else int(dur)

            t_album = playlist_title
            for link in item.get("tertiaryLinks") or []:
                if link.get("title"):
                    t_album = link.get("title")
                    break

            art = item.get("artwork") or {}
            art_dict = art.get("dictionary") if isinstance(art, dict) else {}
            art_url = art_dict.get("url") if isinstance(art_dict, dict) else ""
            t_thumb = _apple_artwork_url(art_url) if art_url else playlist_cover

            desc = item.get("contentDescriptor") or {}
            track_url = desc.get("url") or ""
            track_id = ""
            if isinstance(desc.get("identifiers"), dict):
                track_id = str(desc["identifiers"].get("storeAdamID") or "")
            if not track_url and track_id:
                track_url = f"https://music.apple.com/{parts['storefront']}/song/{track_id}"
            if not track_url:
                track_url = apple_url

            entries.append({
                "index": idx,
                "title": t_title,
                "artist": t_artist,
                "album": t_album,
                "duration": t_dur_sec,
                "duration_str": format_duration(t_dur_sec),
                "url": track_url,
                "thumbnail": t_thumb,
                "description": "",
            })

        if progress_callback:
            progress_callback(1.0, f"Loaded {len(entries)} Apple Music playlist tracks.")

        return {
            "playlist_title": playlist_title,
            "entries": entries,
            "total_count": len(entries),
            "thumbnail_url": playlist_cover,
            "source_type": "apple_music",
        }

    # 2. Public Album Catalog via iTunes Lookup
    if parts["kind"] != "album":
        raise RuntimeError(
            "Apple Music playlist loading supports public playlist and album links."
        )
    if not parts["resource_id"]:
        raise RuntimeError("Could not find an Apple Music album ID in this link.")
    if progress_callback:
        progress_callback(0.2, "Loading Apple Music album catalog...")
    response = requests.get(
        "https://itunes.apple.com/lookup",
        params={
            "id": parts["resource_id"],
            "entity": "song",
            "country": parts["storefront"],
            "limit": 200,
        },
        headers={"User-Agent": f"JaneConverter/{__version__} (+local media utility)"},
        timeout=12,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Apple catalog lookup returned HTTP status {response.status_code}")
    results = response.json().get("results") or []
    album = next((item for item in results if item.get("wrapperType") == "collection"), {})
    songs = [item for item in results if item.get("kind") == "song"]
    if not album or not songs:
        raise RuntimeError("Apple Music catalog did not return any public tracks for this album.")
    parsed = urllib.parse.urlparse(apple_url)
    entries = []
    for index, result in enumerate(songs, 1):
        meta = _apple_music_result_metadata(result)
        track_id = str(result.get("trackId") or "")
        track_query = urllib.parse.urlencode({"i": track_id})
        track_url = urllib.parse.urlunparse(parsed._replace(query=track_query))
        entries.append({
            "index": index,
            "title": meta["title"],
            "artist": meta["artist"],
            "duration": result.get("trackTimeMillis", 0),
            "duration_str": format_duration(meta.get("duration", 0)),
            "url": track_url,
            "thumbnail": meta.get("thumbnail_url", ""),
            "description": "",
        })
    if progress_callback:
        progress_callback(1.0, f"Loaded {len(entries)} Apple Music album tracks.")
    return {
        "playlist_title": album.get("collectionName") or "Apple Music Album",
        "entries": entries,
        "total_count": len(entries),
        "thumbnail_url": _apple_artwork_url(album.get("artworkUrl100") or ""),
        "source_type": "apple_music",
    }
def resolve_spotify_metadata(spotify_url: str) -> Dict[str, str]:
    """
    Extracts public track title, artist, album, year, and thumbnail from Spotify via public oEmbed and OpenGraph.
    No API keys or authentication required.
    """
    clean_url = spotify_url.split("?")[0].strip()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    title = "Unknown Track"
    artist = "Unknown Artist"
    album = ""
    year = ""
    thumbnail = ""
    description = ""
    duration = 0

    # 1. Try Spotify embed page for rich track details and high-res art
    m_track = re.search(r'/track/([a-zA-Z0-9]+)', clean_url)
    if m_track:
        track_id = m_track.group(1)
        embed_url = f"https://open.spotify.com/embed/track/{track_id}"
        try:
            resp = requests.get(embed_url, headers=headers, timeout=8)
            if resp.status_code == 200:
                m_data = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.DOTALL)
                if m_data:
                    data = json.loads(m_data.group(1))
                    entity = data.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
                    title = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', entity.get("title") or title).strip()
                    duration = int(entity.get("duration") or 0) // 1000
                    artist_list = [re.sub(r'[\x00-\x1f\x7f-\x9f]', '', a.get("name")).strip() for a in entity.get("artists", []) if a.get("name")]
                    if artist_list:
                        artist = ", ".join(artist_list)
                    elif entity.get("subtitle"):
                        artist = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', entity.get("subtitle")).strip()

                    rel_date = entity.get("releaseDate", {}).get("isoString", "")
                    if rel_date and len(rel_date) >= 4:
                        year = rel_date[:4]

                    imgs = entity.get("visualIdentity", {}).get("image", [])
                    if imgs:
                        best = max(imgs, key=lambda x: x.get("maxWidth", 0))
                        thumbnail = best.get("url", "")
        except (KeyError, TypeError, ValueError, AttributeError):
            pass

    # 2. Fallback to public oEmbed endpoint for thumbnail / title if needed
    if not thumbnail or title == "Unknown Track":
        try:
            oembed_url = f"https://open.spotify.com/oembed?url={urllib.parse.quote(clean_url)}"
            resp = requests.get(oembed_url, headers=headers, timeout=8)
            if resp.status_code == 200:
                data = resp.json()
                if title == "Unknown Track":
                    title = data.get("title", title)
                if not thumbnail:
                    thumbnail = data.get("thumbnail_url", "")
        except (requests.RequestException, json.JSONDecodeError, KeyError, TypeError):
            pass

    # 3. Scrape OpenGraph description for album and artist fallback
    try:
        page_resp = requests.get(clean_url, headers=headers, timeout=8)
        if page_resp.status_code == 200:
            page_html = page_resp.text
            desc_match = re.search(r'<meta property="og:description" content="([^"]+)"', page_html)
            if desc_match:
                desc_text = html.unescape(desc_match.group(1))
                description = desc_text
                parts = [p.strip() for p in re.split(r'[·•|]', desc_text)]
                if parts and artist == "Unknown Artist":
                    artist = html.unescape(parts[0])
                if len(parts) > 1 and "Song" not in parts[1] and not album:
                    album = html.unescape(parts[1])
                if len(parts) > 3 and not year and parts[-1].isdigit():
                    year = parts[-1]
    except (requests.RequestException, IndexError, ValueError):
        pass

    candidates = build_search_candidates(artist, title)
    primary_query = candidates[0] if candidates else (f"{artist} - {title}" if artist != "Unknown Artist" else title)

    return {
        "title": title,
        "artist": artist,
        "album": album,
        "year": year,
        "search_query": primary_query,
        "search_candidates": candidates,
        "thumbnail": thumbnail,
        "thumbnail_url": thumbnail,
        "description": description,
        "duration": duration,
    }

