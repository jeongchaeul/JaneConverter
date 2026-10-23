"""Tests for the Instagram story and highlight extractor patch."""

from unittest.mock import MagicMock
from yt_dlp.extractor.instagram import InstagramStoryIE
from janeconverter.instagram_patch import patch_instagram_story_extractor


def test_instagram_patch_applied():
    patch_instagram_story_extractor()
    assert getattr(InstagramStoryIE, "_jane_patched", False) is True


def test_instagram_patch_direct_story_extraction():
    patch_instagram_story_extractor()
    ie = InstagramStoryIE()
    
    # Mock downloader and cookiejar
    mock_downloader = MagicMock()
    mock_cookie = MagicMock()
    mock_cookie.name = "csrftoken"
    mock_cookie.value = "test_csrf_token"
    mock_downloader.cookiejar = [mock_cookie]
    ie._downloader = mock_downloader
    
    # Mock download_json returning story item
    mock_item = {
        "id": "4013374841222675452_63228509378",
        "pk": 4013374841222675452,
        "media_type": 2,
        "user": {"pk": "63228509378", "username": "shinchewieeee", "full_name": "Shin Chewie"},
        "video_duration": 15.0,
        "video_versions": [
            {"url": "https://cdn.example.com/story.mp4", "width": 720, "height": 1280, "id": "123"}
        ],
        "image_versions2": {
            "candidates": [{"url": "https://cdn.example.com/thumb.jpg", "width": 720, "height": 1280}]
        },
    }
    ie._download_json = MagicMock(return_value={"items": [mock_item]})
    ie._yes_playlist = MagicMock(return_value=False)
    
    res = ie._real_extract("https://www.instagram.com/stories/shinchewieeee/4013374841222675452/")
    assert res is not None
    assert res.get("uploader") == "Shin Chewie"
    assert len(res.get("formats", [])) > 0
    assert res["formats"][0]["url"] == "https://cdn.example.com/story.mp4"


def test_instagram_patch_photo_story_format_synthesis():
    patch_instagram_story_extractor()
    ie = InstagramStoryIE()
    
    mock_downloader = MagicMock()
    mock_downloader.cookiejar = []
    ie._downloader = mock_downloader
    
    # Photo story without video_versions
    mock_item = {
        "id": "4013399999999999999_63228509378",
        "pk": 4013399999999999999,
        "media_type": 1,
        "user": {"pk": "63228509378", "username": "shinchewieeee", "full_name": "Shin Chewie"},
        "image_versions2": {
            "candidates": [
                {"url": "https://cdn.example.com/photo_high.jpg", "width": 1080, "height": 1920},
                {"url": "https://cdn.example.com/photo_low.jpg", "width": 360, "height": 640},
            ]
        },
    }
    ie._download_json = MagicMock(return_value={"items": [mock_item]})
    ie._yes_playlist = MagicMock(return_value=False)
    
    res = ie._real_extract("https://www.instagram.com/stories/shinchewieeee/4013399999999999999/")
    assert res is not None
    assert len(res.get("formats", [])) == 1
    assert res["formats"][0]["url"] == "https://cdn.example.com/photo_high.jpg"
    assert res["formats"][0]["vcodec"] == "mjpeg"
