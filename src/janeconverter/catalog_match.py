"""Conservative identity matching for catalog links that provide no media bytes."""
import math
import re
import unicodedata

VERSION_WORDS = {"live", "remix", "cover", "instrumental", "karaoke", "slowed", "sped", "acoustic", "remaster", "remastered", "demo", "extended", "edit"}
NOISE_WORDS = {"official", "audio", "video", "music", "lyrics", "lyric", "hd", "hq", "visualizer", "topic", "provided", "youtube"}


def tokens(value):
    normalized = unicodedata.normalize("NFKD", str(value or "")).casefold()
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return set(re.findall(r"\w+", normalized))


def match_score(requested, candidate):
    title = tokens(requested.get("title"))
    artist = tokens(requested.get("artist"))
    actual = tokens(candidate.get("title"))
    credit = tokens(candidate.get("artist") or candidate.get("creator") or candidate.get("uploader"))
    if not title or not artist or requested.get("artist") == "Unknown Artist":
        return None
    if (title & VERSION_WORDS) != (actual & VERSION_WORDS):
        return None
    wanted_title = title - NOISE_WORDS
    if not wanted_title or not wanted_title <= actual or not artist <= (actual | credit):
        return None
    extra = actual - title - artist - NOISE_WORDS
    if extra:
        return None
    duration_score = 0
    expected, found = requested.get("duration"), candidate.get("duration")
    if expected:
        try:
            expected, found = float(expected), float(found)
        except (ValueError, TypeError):
            return None
        if not math.isfinite(expected) or not math.isfinite(found) or expected <= 0 or found <= 0:
            return None
        difference = abs(found - expected)
        if difference > max(5, expected * 0.05):
            return None
        duration_score = 0.1 * (1 - difference / max(5, expected * 0.05))
    return 0.8 + duration_score + (0.1 if artist <= credit else 0)


def choose_catalog_match(requested, candidates):
    ranked = sorted(((match_score(requested, item), item) for item in candidates if item),
                    key=lambda pair: pair[0] if pair[0] is not None else -1, reverse=True)
    ranked = [(score, item) for score, item in ranked if score is not None]
    if not ranked or (len(ranked) > 1 and ranked[0][0] - ranked[1][0] < 0.03
                      and ranked[0][1].get("id") != ranked[1][1].get("id")):
        raise ValueError("Catalog match is uncertain. Use a direct link to the intended recording; no guessed recording was downloaded.")
    return ranked[0][1]
