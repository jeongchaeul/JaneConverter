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


def test_facebook_comet_video_extraction():
    from janeconverter.facebook_patch import _extract_comet_video_data
    from yt_dlp.extractor.facebook import FacebookIE

    ie = FacebookIE()
    video_id = "1132151226070998"
    relay_data = {
        "require": [
            [
                "ScheduledServerJS",
                "handle",
                None,
                [
                    {
                        "__bbox": {
                            "require": [
                                [
                                    "RelayPrefetchedStreamCache",
                                    "next",
                                    [],
                                    [
                                        None,
                                        {
                                            "__bbox": {
                                                "result": {
                                                    "data": {
                                                        "video": {
                                                            "id": video_id,
                                                            "creation_story": {
                                                                "attachments": [
                                                                    {
                                                                        "media": {
                                                                            "__typename": "Video",
                                                                            "id": video_id,
                                                                            "videoDeliveryResponseFragment": {
                                                                                "videoDeliveryResponseResult": {
                                                                                    "progressive_urls": [
                                                                                        {
                                                                                            "progressive_url": "https://scontent.xx.fbcdn.net/video_hd.mp4",
                                                                                            "metadata": {"quality": "HD"},
                                                                                        },
                                                                                        {
                                                                                            "progressive_url": "https://scontent.xx.fbcdn.net/video_sd.mp4",
                                                                                            "metadata": {"quality": "SD"},
                                                                                        },
                                                                                    ]
                                                                                }
                                                                            },
                                                                        }
                                                                    }
                                                                ]
                                                            },
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                    ],
                                ]
                            ]
                        }
                    }
                ],
            ]
        ]
    }
    webpage = (
        '<html><body>'
        '<script data-sjs>' + json.dumps(relay_data) + '</script>'
        '<script>{"actors":[{"name":"Priquitilson Xibilson Bucetilson","id":"61591912586697"}]}</script>'
        '<script>{"message":{"text":"Amazing Reel"}}</script>'
        '<script>{"preferred_thumbnail":{"image":{"uri":"https://scontent.xx.fbcdn.net/thumb.jpg"}}}</script>'
        '<script>{"length_in_second": 15.9}</script>'
        '</body></html>'
    )

    info = _extract_comet_video_data(ie, webpage, video_id, f"https://www.facebook.com/reel/{video_id}")
    assert info is not None
    assert info["id"] == video_id
    assert info["title"] == "Amazing Reel"
    assert info["uploader"] == "Priquitilson Xibilson Bucetilson"
    assert info["uploader_id"] == "61591912586697"
    assert info["thumbnail"] == "https://scontent.xx.fbcdn.net/thumb.jpg"
    assert info["duration"] == 15.9
    assert len(info["formats"]) == 2
    assert info["formats"][0]["format_id"] == "hd"
    assert info["formats"][0]["url"] == "https://scontent.xx.fbcdn.net/video_hd.mp4"
    assert info["formats"][1]["format_id"] == "sd"
    assert info["formats"][1]["url"] == "https://scontent.xx.fbcdn.net/video_sd.mp4"


def test_facebook_comet_fallback_rescuing_cannot_parse_data():
    from yt_dlp.extractor.facebook import FacebookIE

    patch_facebook_story_extractor()
    ie = FacebookIE()
    ie._downloader = MagicMock()
    video_id = "99887766"

    # Mock _download_webpage to return a Comet page
    comet_data = {
        "videoDeliveryResponseFragment": {
            "videoDeliveryResponseResult": {
                "progressive_urls": [
                    {
                        "progressive_url": "https://scontent.xx.fbcdn.net/rescued_video.mp4",
                        "metadata": {"quality": "HD"},
                    }
                ]
            }
        }
    }
    webpage = (
        '<html><body>'
        '<script data-sjs>' + json.dumps(comet_data) + '</script>'
        '<script>{"actors":[{"name":"Jane Artist","id":"12345"}]}</script>'
        '</body></html>'
    )

    ie._download_webpage = MagicMock(return_value=webpage)

    res = ie._extract_from_url("https://m.facebook.com/watch/?v=99887766&_rdr", video_id)
    assert res is not None
    assert res["id"] == video_id
    assert res["uploader"] == "Jane Artist"
    assert len(res["formats"]) == 1
    assert res["formats"][0]["url"] == "https://scontent.xx.fbcdn.net/rescued_video.mp4"


def test_facebook_comet_multi_video_isolation_prevents_audio_bleeding():
    """Verify that preloaded next reels or recommended videos do not contaminate target video formats/audios."""
    from janeconverter.facebook_patch import _extract_comet_video_data
    from yt_dlp.extractor.facebook import FacebookIE

    ie = FacebookIE()
    target_video_id = "1132151226070998"
    preloaded_reel_id = "9999999999999999"

    target_data = {
        "require": [
            [
                "ScheduledServerJS",
                "handle",
                None,
                [
                    {
                        "__bbox": {
                            "require": [
                                [
                                    "RelayPrefetchedStreamCache",
                                    "next",
                                    [],
                                    [
                                        None,
                                        {
                                            "__bbox": {
                                                "result": {
                                                    "data": {
                                                        "video": {
                                                            "id": target_video_id,
                                                            "creation_story": {
                                                                "attachments": [
                                                                    {
                                                                        "media": {
                                                                            "__typename": "Video",
                                                                            "id": target_video_id,
                                                                            "videoDeliveryResponseFragment": {
                                                                                "videoDeliveryResponseResult": {
                                                                                    "id": target_video_id,
                                                                                    "progressive_urls": [
                                                                                        {
                                                                                            "progressive_url": "https://scontent.xx.fbcdn.net/target_hd.mp4",
                                                                                            "metadata": {"quality": "HD"},
                                                                                        },
                                                                                    ],
                                                                                }
                                                                            },
                                                                        }
                                                                    }
                                                                ]
                                                            },
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                    ],
                                ]
                            ]
                        }
                    }
                ],
            ]
        ]
    }

    preloaded_next_reel = {
        "require": [
            [
                "ScheduledServerJS",
                "handle",
                None,
                [
                    {
                        "__bbox": {
                            "require": [
                                [
                                    "RelayPrefetchedStreamCache",
                                    "next",
                                    [],
                                    [
                                        None,
                                        {
                                            "__bbox": {
                                                "result": {
                                                    "data": {
                                                        "node": {
                                                            "attachments": [
                                                                {
                                                                    "media": {
                                                                        "__typename": "Video",
                                                                        "id": preloaded_reel_id,
                                                                        "videoDeliveryResponseFragment": {
                                                                            "videoDeliveryResponseResult": {
                                                                                "id": preloaded_reel_id,
                                                                                "progressive_urls": [
                                                                                    {
                                                                                        "progressive_url": "https://scontent.xx.fbcdn.net/unwanted_preloaded_audio.mp4",
                                                                                        "metadata": {"quality": "HD"},
                                                                                    },
                                                                                ],
                                                                            }
                                                                        },
                                                                    }
                                                                }
                                                            ]
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                    ],
                                ]
                            ]
                        }
                    }
                ],
            ]
        ]
    }

    webpage = (
        '<html><body>'
        '<script data-sjs>' + json.dumps(target_data) + '</script>'
        '<script data-sjs>' + json.dumps(preloaded_next_reel) + '</script>'
        '<script>{"actors":[{"name":"Original Creator","id":"11111"}]}</script>'
        '</body></html>'
    )

    info = _extract_comet_video_data(ie, webpage, target_video_id, f"https://www.facebook.com/reel/{target_video_id}")
    assert info is not None
    assert info["id"] == target_video_id
    assert len(info["formats"]) == 1
    assert info["formats"][0]["url"] == "https://scontent.xx.fbcdn.net/target_hd.mp4"
    assert not any("unwanted_preloaded_audio" in f["url"] for f in info["formats"])

