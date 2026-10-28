use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use std::collections::HashMap;
use url::Url;

use crate::model::{FacebookPhoto, SocialPhotoManifest};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SocialPlatform {
    Instagram,
    Twitter,
    TikTok,
    Reddit,
    Tumblr,
    Pinterest,
}

impl SocialPlatform {
    pub fn key(self) -> &'static str {
        match self {
            Self::Instagram => "instagram",
            Self::Twitter => "twitter",
            Self::TikTok => "tiktok",
            Self::Reddit => "reddit",
            Self::Tumblr => "tumblr",
            Self::Pinterest => "pinterest",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Instagram => "Instagram",
            Self::Twitter => "X/Twitter",
            Self::TikTok => "TikTok",
            Self::Reddit => "Reddit",
            Self::Tumblr => "Tumblr",
            Self::Pinterest => "Pinterest",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMessage {
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub count: usize,
    #[serde(default)]
    pub expected_count: Option<usize>,
    #[serde(default)]
    pub end_confirmed: bool,
    #[serde(default)]
    pub count_conflict: bool,
    #[serde(default)]
    pub completion: String,
    #[serde(default)]
    pub sequence: usize,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub photos: Vec<FacebookPhoto>,
}

#[derive(Debug, Default)]
pub struct CaptureAccumulator {
    pub title: String,
    pub photos: Vec<FacebookPhoto>,
    pub photo_indexes: HashMap<String, usize>,
}

pub fn validate_post_url(value: &str) -> Result<(SocialPlatform, Url), String> {
    let url = Url::parse(value.trim()).map_err(|_| {
        "Paste a valid public photo post, gallery, or Pinterest board link.".to_string()
    })?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = url.path().to_ascii_lowercase();
    let instagram_segments = path
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let instagram = (host == "instagram.com" || host.ends_with(".instagram.com"))
        && match instagram_segments.as_slice() {
            ["p" | "reel" | "reels", shortcode] => !shortcode.is_empty(),
            [username, "p" | "reel" | "reels", shortcode] => {
                !username.is_empty()
                    && !shortcode.is_empty()
                    && !matches!(
                        *username,
                        "accounts" | "explore" | "stories" | "direct" | "about" | "developer"
                    )
            }
            _ => false,
        };
    let twitter_host = matches!(
        host.as_str(),
        "x.com" | "www.x.com" | "twitter.com" | "www.twitter.com"
    );
    let twitter = twitter_host
        && path.contains("/status/")
        && path.split("/status/").nth(1).is_some_and(|tail| {
            tail.split('/')
                .next()
                .is_some_and(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()))
        });
    let tiktok_host = host == "tiktok.com" || host.ends_with(".tiktok.com");
    let tiktok = tiktok_host
        && (path.contains("/photo/")
            || path.starts_with("/t/")
            || path.starts_with("/share/photo/"));
    let reddit_host = host == "reddit.com" || host.ends_with(".reddit.com");
    let reddit = reddit_host && (path.contains("/comments/") || path.starts_with("/gallery/"));
    let tumblr_host = host == "tumblr.com" || host.ends_with(".tumblr.com");
    let tumblr_segments = path.trim_matches('/').split('/').collect::<Vec<_>>();
    let tumblr = tumblr_host
        && (path.contains("/post/")
            || tumblr_segments.len() >= 2
                && tumblr_segments.iter().any(|part| {
                    !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())
                }));
    let pinterest_host =
        host == "pinterest.com" || host.ends_with(".pinterest.com") || host == "pin.it";
    let pinterest_segments = path
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if pinterest_host
        && matches!(
            pinterest_segments.first().copied(),
            Some("news_hub" | "notifications")
        )
    {
        return Err("Pinterest notification links require account sign-in. In Pinterest, use the Share button to copy a public share link, or use Browser Capture with your active browser session.".into());
    }
    let pinterest = pinterest_host
        && (host == "pin.it"
            || path.starts_with("/pin/")
            || path.starts_with("/multi-pin-share/")
            || (2..=3).contains(&pinterest_segments.len())
                && !matches!(
                    pinterest_segments.first().copied(),
                    Some(
                        "search"
                            | "ideas"
                            | "explore"
                            | "business"
                            | "news_hub"
                            | "notifications"
                            | "settings"
                            | "messages"
                            | "edit"
                            | "following"
                            | "feed"
                            | "today"
                            | "login"
                            | "signup"
                            | "logout"
                            | "about"
                            | "resource"
                            | "multi-pin-share"
                    )
                ));
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return Err("Paste a secure public post, gallery, or board link.".into());
    }
    let platform = if instagram {
        SocialPlatform::Instagram
    } else if twitter {
        SocialPlatform::Twitter
    } else if tiktok {
        SocialPlatform::TikTok
    } else if reddit {
        SocialPlatform::Reddit
    } else if tumblr {
        SocialPlatform::Tumblr
    } else if pinterest {
        SocialPlatform::Pinterest
    } else {
        return Err("Paste an Instagram/X post, TikTok photo post, Reddit gallery, Tumblr photo post, or Pinterest board link.".into());
    };
    Ok((platform, url))
}

pub fn is_allowed_navigation(value: &str, platform: SocialPlatform) -> bool {
    let Some(host) = Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
    else {
        return false;
    };
    match platform {
        SocialPlatform::Instagram => host == "instagram.com" || host.ends_with(".instagram.com"),
        SocialPlatform::Twitter => matches!(
            host.as_str(),
            "x.com" | "www.x.com" | "twitter.com" | "www.twitter.com"
        ),
        SocialPlatform::TikTok => host == "tiktok.com" || host.ends_with(".tiktok.com"),
        SocialPlatform::Reddit => host == "reddit.com" || host.ends_with(".reddit.com"),
        SocialPlatform::Tumblr => host == "tumblr.com" || host.ends_with(".tumblr.com"),
        SocialPlatform::Pinterest => {
            host == "pinterest.com" || host.ends_with(".pinterest.com") || host == "pin.it"
        }
    }
}

pub fn validate_photo_url(value: &str, platform: SocialPlatform) -> bool {
    Url::parse(value).ok().is_some_and(|url| {
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        let allowed = match platform {
            SocialPlatform::Instagram => ["cdninstagram.com", "fbcdn.net", "fbsbx.com"]
                .iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))),
            SocialPlatform::Twitter => host == "pbs.twimg.com",
            SocialPlatform::TikTok => [
                "tiktokcdn.com",
                "tiktokcdn-us.com",
                "tiktokv.com",
                "ibyteimg.com",
                "ibytedtos.com",
            ]
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))),
            SocialPlatform::Reddit => ["redd.it", "redditmedia.com"]
                .iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))),
            SocialPlatform::Tumblr => {
                host == "media.tumblr.com" || host.ends_with(".media.tumblr.com")
            }
            SocialPlatform::Pinterest => host == "pinimg.com" || host.ends_with(".pinimg.com"),
        };
        url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && allowed
    })
}

pub fn message_from_title(title: &str, nonce: &str) -> Option<PageMessage> {
    let prefix = format!("__JANE_SOCIAL_PHOTO_CAPTURE__{nonce}__");
    let encoded = title.strip_prefix(&prefix)?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn validate_completion(message: &PageMessage, received: usize) -> Result<(), String> {
    if message.completion != "complete"
        || !message.end_confirmed
        || message.count_conflict
        || message.expected_count != Some(received)
        || message.count != received
        || !(1..=500).contains(&received)
    {
        return Err(format!("Collection completeness could not be verified (received {received} media). No partial collection was saved. Keep the full post open and retry, or use Browser Capture for individual visible items."));
    }
    Ok(())
}

const SOCIAL_PHOTO_CAPTURE_SCRIPT: &str = include_str!("../scripts/social_photo_capture.js");

pub fn initialization_script(nonce: &str, platform: SocialPlatform, target_url: &str) -> String {
    let nonce_json = serde_json::to_string(nonce).expect("nonce is a string");
    let platform_json = serde_json::to_string(platform.key()).expect("platform is a string");
    let target_url_json = serde_json::to_string(target_url).expect("target_url is a string");
    SOCIAL_PHOTO_CAPTURE_SCRIPT
        .replace("__NONCE_JSON__", &nonce_json)
        .replace("__PLATFORM_JSON__", &platform_json)
        .replace("__TARGET_URL_JSON__", &target_url_json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_partial_collections_are_not_complete() {
        let mut message: PageMessage =
            serde_json::from_str(r#"{"kind":"done","count":2}"#).unwrap();
        assert!(validate_completion(&message, 2).is_err());
        message.expected_count = Some(3);
        message.end_confirmed = true;
        message.completion = "complete".into();
        assert!(validate_completion(&message, 2).is_err());
        message.expected_count = Some(2);
        assert!(validate_completion(&message, 2).is_ok());
        message.count_conflict = true;
        assert!(validate_completion(&message, 2).is_err());
    }

    #[test]
    fn collection_links_are_limited_to_supported_public_routes() {
        assert_eq!(
            validate_post_url("https://www.instagram.com/p/Dd4-rBKT4Zk/")
                .unwrap()
                .0,
            SocialPlatform::Instagram
        );
        assert_eq!(
            validate_post_url("https://www.instagram.com/justinaxiecl/p/DFMyvpiSgxW/")
                .unwrap()
                .0,
            SocialPlatform::Instagram
        );
        assert_eq!(
            validate_post_url("https://www.instagram.com/justinaxiecl/reel/DFMyvpiSgxW/")
                .unwrap()
                .0,
            SocialPlatform::Instagram
        );
        assert_eq!(
            validate_post_url("https://www.tiktok.com/@creator/photo/123")
                .unwrap()
                .0,
            SocialPlatform::TikTok
        );
        assert_eq!(
            validate_post_url("https://www.reddit.com/r/test/comments/abc123/gallery/")
                .unwrap()
                .0,
            SocialPlatform::Reddit
        );
        assert_eq!(
            validate_post_url("https://blog.tumblr.com/post/123456789/example")
                .unwrap()
                .0,
            SocialPlatform::Tumblr
        );
        assert_eq!(
            validate_post_url("https://www.tumblr.com/blog/123456789/example")
                .unwrap()
                .0,
            SocialPlatform::Tumblr
        );
        assert_eq!(
            validate_post_url("https://www.pinterest.com/creator/interiors/")
                .unwrap()
                .0,
            SocialPlatform::Pinterest
        );
        assert_eq!(
            validate_post_url("https://www.pinterest.com/creator/interiors/ideas/")
                .unwrap()
                .0,
            SocialPlatform::Pinterest
        );
        assert_eq!(
            validate_post_url("https://www.pinterest.com/pin/123456789/")
                .unwrap()
                .0,
            SocialPlatform::Pinterest
        );
        assert_eq!(
            validate_post_url("https://pin.it/abc123").unwrap().0,
            SocialPlatform::Pinterest
        );
        assert_eq!(
            validate_post_url("https://www.pinterest.com/multi-pin-share/4154954936010891184/")
                .unwrap()
                .0,
            SocialPlatform::Pinterest
        );
        let news_err =
            validate_post_url("https://ph.pinterest.com/news_hub/3943610033677608128").unwrap_err();
        assert!(news_err.contains("Pinterest notification links require account sign-in"));
        assert!(validate_post_url("https://evilreddit.com/r/test/comments/abc123").is_err());
        assert!(validate_post_url("http://www.pinterest.com/creator/board/").is_err());
    }

    #[test]
    fn image_urls_are_restricted_to_each_platform_cdn() {
        for (platform, url) in [
            (
                SocialPlatform::TikTok,
                "https://p16-sign.tiktokcdn.com/tos/image.jpeg",
            ),
            (SocialPlatform::Reddit, "https://i.redd.it/example.jpg"),
            (
                SocialPlatform::Tumblr,
                "https://64.media.tumblr.com/example.jpg",
            ),
            (
                SocialPlatform::Pinterest,
                "https://i.pinimg.com/originals/example.jpg",
            ),
        ] {
            assert!(validate_photo_url(url, platform), "{url}");
            assert!(!validate_photo_url(
                "https://notallowed.example/photo.jpg",
                platform
            ));
        }
    }

    #[test]
    fn guest_prompt_closing_is_scoped_to_platform_login_dialogs() {
        for (platform, prompt) in [
            (
                SocialPlatform::Instagram,
                "log in to instagram|sign in to instagram|sign up for instagram",
            ),
            (
                SocialPlatform::Twitter,
                "log in to x|sign in to x|sign up for x",
            ),
            (
                SocialPlatform::TikTok,
                "log in to tiktok|sign in to tiktok|sign up for tiktok",
            ),
            (
                SocialPlatform::Reddit,
                "log in to reddit|sign in to reddit|sign up for reddit",
            ),
            (
                SocialPlatform::Tumblr,
                "log in to tumblr|sign in to tumblr|sign up for tumblr",
            ),
            (
                SocialPlatform::Pinterest,
                "log in to pinterest|sign in to pinterest|sign up for pinterest",
            ),
        ] {
            let script = initialization_script("session-1", platform, "https://example.com/post/1");
            assert!(script.contains(prompt));
            assert!(script.contains("commonPromptPattern"));
            assert!(script.contains("log in or sign up|sign in or sign up|log in to continue|sign in to continue|see more from|see more on"));
            assert!(script.contains("hasLoginForm || hasAccountAction"));
            assert!(script.contains("[role=\"dialog\"], [aria-modal=\"true\"]"));
            assert!(script.contains("if (prompt)"));
            assert!(script.contains("getComputedStyle(parent).position === \"fixed\""));
            assert!(script.contains("overlay.remove()"));
            assert!(script.contains("document.body.style.overflow = \"\""));
            assert!(!script.contains("document.querySelector('button[aria-label=\"Close\"]"));
            assert!(script.contains("window.scrollTo(0, Math.min(window.scrollY"));
            assert!(script.contains("photos.size >= 500 && !waiting && !pending.length"));
            assert!(script.contains("collection exceeds the 500-photo capture limit"));
            assert!(script.contains("redirected to the home feed"));
            assert!(script.contains("notification collections require account sign-in"));
        }
    }

    #[test]
    fn title_bridge_decodes_multibyte_arabic_and_cjk_titles() {
        let arabic_title = "فيديو انستغرام رائع جدًا ".repeat(12);
        assert!(arabic_title.len() > 500);
        assert!(arabic_title.chars().count() <= 500);
        let payload = serde_json::json!({
            "kind": "done",
            "platform": "instagram",
            "count": 1,
            "title": arabic_title,
        });
        let encoded = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
        let doc_title = format!("__JANE_SOCIAL_PHOTO_CAPTURE__nonce-1__{encoded}");
        let parsed = message_from_title(&doc_title, "nonce-1").expect("valid message");
        assert_eq!(parsed.title, arabic_title);
        assert!(parsed.title.chars().count() <= 500);
    }

    #[test]
    fn pinterest_script_observes_counts_and_confirms_settled_board() {
        let script = initialization_script(
            "test-nonce",
            SocialPlatform::Pinterest,
            "https://www.pinterest.com/user/board",
        );
        assert!(script.contains("pin_count"));
        assert!(script.contains("ideas?|pins?"));
        assert!(script
            .contains("isPinterestBoard && atBottom && unchanged >= 8 && expectedCount === null"));
        assert!(script.contains("closeup-body"));
        assert!(script.contains("Pinterest Collection"));

        let mut message: PageMessage = serde_json::from_str(
            r#"{
            "kind": "done",
            "count": 15,
            "expectedCount": 15,
            "endConfirmed": true,
            "countConflict": false,
            "completion": "complete",
            "title": "15 ideas I found on Pinterest"
        }"#,
        )
        .unwrap();
        assert!(validate_completion(&message, 15).is_ok());

        message.count = 14;
        assert!(validate_completion(&message, 15).is_err());
    }
}

pub enum CaptureOutcome {
    Photos(SocialPhotoManifest),
    Video(String),
}

pub fn manifest(
    platform: SocialPlatform,
    title: String,
    photos: Vec<FacebookPhoto>,
) -> SocialPhotoManifest {
    SocialPhotoManifest {
        platform: platform.key().to_string(),
        title,
        photos,
    }
}
