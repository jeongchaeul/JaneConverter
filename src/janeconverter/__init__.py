"""JaneConverter media conversion backend."""

from .version import __version__
from .cookie_unlocker import patch_yt_dlp_cookie_database_reader

patch_yt_dlp_cookie_database_reader()

__all__ = ["__version__"]

