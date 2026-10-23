"""Tests for Facebook story extraction patch."""

import json
from unittest.mock import MagicMock
import yt_dlp.extractor as yde
from janeconverter.facebook_patch import (
    clean_fb_cdn_url,
    decode_fb_story_id,
    patch_facebook_story_extractor,
)


def test_decode_fb_story_id():
    assert decode_fb_story_id("UzpfSVNDOjE2NjYyNDYxOTE4ODMxMjY=") == "1666246191883126"
    assert decode_fb_story_id("1666246191883126") == "1666246191883126"
    assert decode_fb_story_id("") == ""
    assert decode_fb_story_id(None) == ""


def test_clean_fb_cdn_url():
    raw = "https://scontent.xx.fbcdn.net/v/t15.5256-10/sample.jpg?stp=dst-jpg_sh0.2&ctp=s960x960&oh=123"
    cleaned = clean_fb_cdn_url(raw)
    assert "ctp=" not in cleaned
    assert "stp=dst-jpg_sh0.2" in cleaned
    assert "oh=123" in cleaned


def test_facebook_patch_applied():
    patch_facebook_story_extractor()
    assert "FacebookStoryIE" in yde._extractors_context.value


def test_facebook_story_video_extraction():
    patch_facebook_story_extractor()
    ie_cls = yde._extractors_context.value["FacebookStoryIE"]
    ie = ie_cls()

    mock_downloader = MagicMock()
    mock_downloader.params = {"noplaylist": True}
    ie._downloader = mock_downloader

    relay_data = {
        "story_card_info": {
            "story_card_id": "1666246191883126",
            "story_thumbnail": {"uri": "https://scontent.xx.fbcdn.net/thumb.jpg?ctp=s960x960"},
        },
        "attachments": [
            {
                "media": {
                    "__typename": "Video",
                    "id": "1111537531607950",
                    "width": 1080,
                    "height": 1920,
                    "playable_url": "https://scontent.xx.fbcdn.net/video_sd.mp4",
                    "playable_url_quality_hd": "https://scontent.xx.fbcdn.net/video_hd.mp4",
                }
            }
        ],
    }
    webpage = (
        '<html><body>'
        '<script>{"require":[["ScheduledServerJS","handle",null,['
        + json.dumps(relay_data)
        + ']]]}</script>'
        '<script>{"story_bucket_owner":{"__typename":"User","name":"Cristalmae Palacio"}}</script>'
        '</body></html>'
    )

    ie._download_webpage = MagicMock(return_value=webpage)

    res = ie._real_extract(
        "https://www.facebook.com/stories/1552803711464154/UzpfSVNDOjE2NjYyNDYxOTE4ODMxMjY=/?view_single=1"
    )
    assert res is not None
    assert res["id"] == "1666246191883126"
    assert res["uploader"] == "Cristalmae Palacio"
    assert len(res["formats"]) == 2
    assert res["formats"][0]["format_id"] == "hd"
    assert res["formats"][0]["url"] == "https://scontent.xx.fbcdn.net/video_hd.mp4"
    assert res["formats"][1]["format_id"] == "sd"


def test_facebook_story_photo_format_synthesis():
    patch_facebook_story_extractor()
    ie_cls = yde._extractors_context.value["FacebookStoryIE"]
    ie = ie_cls()

    mock_downloader = MagicMock()
    mock_downloader.params = {"noplaylist": True}
    ie._downloader = mock_downloader

    relay_data = {
        "story_card_info": {
            "story_card_id": "999888777",
            "story_thumbnail": {"uri": "https://scontent.xx.fbcdn.net/thumb.jpg?ctp=s960x960"},
        },
        "attachments": [
            {
                "media": {
                    "__typename": "Photo",
                    "id": "555444333",
                    "width": 1080,
                    "height": 1920,
                    "image": {"uri": "https://scontent.xx.fbcdn.net/photo_full.jpg"},
                }
            }
        ],
    }
    webpage = (
        '<html><body>'
        '<script>' + json.dumps(relay_data) + '</script>'
        '</body></html>'
    )

    ie._download_webpage = MagicMock(return_value=webpage)

    res = ie._real_extract("https://www.facebook.com/stories/1552803711464154/999888777/")
    assert res is not None
    assert res["id"] == "999888777"
    assert len(res["formats"]) == 1
    assert res["formats"][0]["format_id"] == "photo"
    assert res["formats"][0]["vcodec"] == "mjpeg"
    assert res["formats"][0]["url"] == "https://scontent.xx.fbcdn.net/photo_full.jpg"
