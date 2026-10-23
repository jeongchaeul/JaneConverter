"""JaneConverter media conversion backend."""

from .version import __version__
from .cookie_unlocker import patch_yt_dlp_cookie_database_reader
from .instagram_patch import patch_instagram_story_extractor
from .facebook_patch import patch_facebook_story_extractor

patch_yt_dlp_cookie_database_reader()
patch_instagram_story_extractor()
patch_facebook_story_extractor()

__all__ = ["__version__"]
