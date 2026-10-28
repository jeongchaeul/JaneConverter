use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use std::collections::BTreeMap;
use url::Url;

use crate::model::{FacebookPhoto, FacebookPhotoManifest};

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
    pub count_source: String,
    #[serde(default)]
    pub end_confirmed: bool,
    #[serde(default)]
    pub count_conflict: bool,
    #[serde(default)]
    pub sequence: usize,
    #[serde(default)]
    pub request_id: String,
    #[serde(default)]
    pub photos: Vec<FacebookPhoto>,
}

#[derive(Debug, Default)]
pub struct CaptureAccumulator {
    pub title: String,
    pub photos: BTreeMap<String, FacebookPhoto>,
    pub order: Vec<String>,
}

impl CaptureAccumulator {
    pub fn add_photo(&mut self, photo: FacebookPhoto) {
        if !self.photos.contains_key(&photo.id) {
            self.order.push(photo.id.clone());
        }
        let Some(existing) = self.photos.get_mut(&photo.id) else {
            self.photos.insert(photo.id.clone(), photo);
            return;
        };
        let mut candidates = vec![existing.url.clone(), photo.url.clone()];
        candidates.extend(existing.alternates.iter().cloned());
        candidates.extend(photo.alternates);
        if photo.width > existing.width {
            existing.url = photo.url;
            existing.width = photo.width;
        }
        let mut seen = std::collections::HashSet::new();
        candidates.retain(|url| url != &existing.url && seen.insert(url.clone()));
        existing.alternates = candidates.into_iter().take(3).collect();
    }

    pub fn ordered_photos(&self) -> Vec<FacebookPhoto> {
        self.order
            .iter()
            .filter_map(|id| self.photos.get(id).cloned())
            .collect()
    }
}

pub enum CaptureOutcome {
    Photos(FacebookPhotoManifest),
    Video(String),
}

pub fn validate_post_url(value: &str) -> Result<Url, String> {
    let url =
        Url::parse(value.trim()).map_err(|_| "Paste a valid Facebook post link.".to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = url.path().to_ascii_lowercase();
    if url.scheme() != "https"
        || !(host == "facebook.com" || host.ends_with(".facebook.com"))
        || !(path.starts_with("/share/p/")
            || path.contains("/permalink/")
            || path.contains("/posts/")
            || path.ends_with("/story.php")
            || path.contains("/photo")
            || path.contains("/photos/")
            || path.contains("/media/set"))
    {
        return Err("Paste a public Facebook post link to capture its photos.".into());
    }
    Ok(url)
}

#[allow(dead_code)]
pub fn is_video_conversion_intent(category: &str, format: &str) -> bool {
    category.eq_ignore_ascii_case("video")
        && matches!(
            format.to_ascii_lowercase().as_str(),
            "source"
                | "original"
                | "mp4"
                | "mkv"
                | "webm"
                | "mov"
                | "avi"
                | "flv"
                | "m4v"
                | "ts"
                | "m2ts"
                | "mpeg"
                | "mpg"
                | "vob"
                | "3gp"
                | "wmv"
                | "asf"
                | "gif"
        )
}

pub fn is_facebook_navigation(value: &str) -> bool {
    Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|host| host == "facebook.com" || host.ends_with(".facebook.com"))
}

pub fn validate_photo_url(value: &str) -> bool {
    Url::parse(value).ok().is_some_and(|url| {
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        let path = url.path().to_ascii_lowercase();
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && (host == "fbcdn.net"
                || host.ends_with(".fbcdn.net")
                || host == "fbsbx.com"
                || host.ends_with(".fbsbx.com"))
            && !path.contains("1997-6")
            && !path.contains("/stickers/")
            && !path.contains("/reactions/")
            && !path.contains("emoji.php")
            && !path.contains("rsrc.php")
    })
}

pub fn message_from_title(title: &str, nonce: &str) -> Option<PageMessage> {
    let prefix = format!("__JANE_FACEBOOK_CAPTURE__{nonce}__");
    let encoded = title.strip_prefix(&prefix)?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn refreshed_candidate_urls(message: &PageMessage, expected_photo_id: &str) -> Vec<String> {
    if message.kind != "refresh" || message.photos.len() != 1 {
        return Vec::new();
    }
    let photo = &message.photos[0];
    if photo.id != expected_photo_id || !validate_photo_url(&photo.url) {
        return Vec::new();
    }
    let mut urls = vec![photo.url.clone()];
    urls.extend(
        photo
            .alternates
            .iter()
            .filter(|url| validate_photo_url(url))
            .cloned(),
    );
    let mut seen = std::collections::HashSet::new();
    urls.retain(|url| seen.insert(url.clone()));
    urls.truncate(4);
    urls
}

pub fn validate_completion(message: &PageMessage, received_count: usize) -> Result<(), String> {
    if !message.end_confirmed
        || message.count_conflict
        || !matches!(
            message.count_source.as_str(),
            "page-count" | "viewer-end" | "grid-end"
        )
    {
        return Err(
            "Facebook did not provide consistent count and end evidence. No partial album was saved."
                .into(),
        );
    }
    let Some(expected_count) = message.expected_count else {
        return Err(
            "Facebook did not confirm the album's full photo count. No partial album was saved."
                .into(),
        );
    };
    if expected_count != message.count
        || received_count != message.count
        || !(1..=500).contains(&message.count)
    {
        return Err(format!(
            "Facebook reported {} photos, expected {}, and delivered {}. No partial album was saved.",
            message.count, expected_count, received_count
        ));
    }
    Ok(())
}

const FACEBOOK_CAPTURE_SCRIPT: &str = include_str!("../scripts/facebook_capture.js");

pub fn initialization_script(nonce: &str) -> String {
    let nonce_json = serde_json::to_string(nonce).expect("nonce is a string");
    FACEBOOK_CAPTURE_SCRIPT.replace("__NONCE_JSON__", &nonce_json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn album_order_survives_id_deduplication_and_better_renditions() {
        let mut captured = CaptureAccumulator::default();
        for (id, width) in [("30", 640), ("10", 640), ("30", 1080), ("20", 640)] {
            captured.add_photo(FacebookPhoto {
                id: id.into(),
                url: format!("https://scontent.fbcdn.net/{id}-{width}.jpg"),
                width,
                alternates: Vec::new(),
            });
        }
        let photos = captured.ordered_photos();
        assert_eq!(
            photos
                .iter()
                .map(|photo| photo.id.as_str())
                .collect::<Vec<_>>(),
            ["30", "10", "20"]
        );
        assert_eq!(photos[0].width, 1080);
    }

    #[test]
    fn only_facebook_post_links_are_accepted() {
        assert!(validate_post_url("https://www.facebook.com/share/p/abc123/").is_ok());
        assert!(validate_post_url("https://www.facebook.com/groups/42/permalink/123/").is_ok());
        assert!(validate_post_url("https://www.facebook.com/photo/?fbid=123").is_ok());
        assert!(validate_post_url("https://www.facebook.com/user/photos/456").is_ok());
        assert!(validate_post_url("https://www.facebook.com/media/set/?set=pcb.123").is_ok());
        assert!(validate_post_url("http://www.facebook.com/share/p/abc123/").is_err());
        assert!(validate_post_url("https://example.com/posts/123").is_err());
    }

    #[test]
    fn direct_video_conversion_requires_a_video_intent_and_container() {
        assert!(is_video_conversion_intent("Video", "mp4"));
        assert!(is_video_conversion_intent("Video", "source"));
        assert!(!is_video_conversion_intent("Image", "mp4"));
        assert!(!is_video_conversion_intent("Video", "mp3"));
    }

    #[test]
    fn photo_urls_must_use_the_public_facebook_media_cdn() {
        assert!(validate_photo_url(
            "https://scontent.xx.fbcdn.net/photo.jpg?sig=sample"
        ));
        assert!(validate_photo_url("https://lookaside.fbsbx.com/photo.jpg"));
        assert!(!validate_photo_url("https://example.com/photo.jpg"));
        assert!(!validate_photo_url(
            "https://user@scontent.xx.fbcdn.net/photo.jpg"
        ));
    }

    #[test]
    fn capture_messages_are_bound_to_the_current_nonce() {
        let encoded = URL_SAFE_NO_PAD.encode(br#"{"kind":"done","count":2,"expectedCount":80}"#);
        let title = format!("__JANE_FACEBOOK_CAPTURE__session-1__{encoded}");
        let message = message_from_title(&title, "session-1").unwrap();
        assert_eq!(message.count, 2);
        assert_eq!(message.expected_count, Some(80));
        assert!(message_from_title(&title, "another-session").is_none());
    }

    #[test]
    fn rendition_refresh_messages_keep_the_request_and_photo_identity() {
        let encoded = URL_SAFE_NO_PAD.encode(
            br#"{"kind":"refresh","requestId":"0123456789abcdef0123456789abcdef","photos":[{"id":"123456789","url":"https://scontent.fbcdn.net/photo.jpg","width":1200,"alternates":[]}]}"#,
        );
        let title = format!("__JANE_FACEBOOK_CAPTURE__session-1__{encoded}");
        let message = message_from_title(&title, "session-1").unwrap();
        assert_eq!(message.kind, "refresh");
        assert_eq!(message.request_id, "0123456789abcdef0123456789abcdef");
        assert_eq!(message.photos[0].id, "123456789");
        assert!(validate_photo_url(&message.photos[0].url));
        assert_eq!(
            refreshed_candidate_urls(&message, "123456789"),
            ["https://scontent.fbcdn.net/photo.jpg"]
        );
        assert!(refreshed_candidate_urls(&message, "987654321").is_empty());
    }

    #[test]
    fn album_completion_requires_matching_count_acknowledged_items_and_end_evidence() {
        let mut message: PageMessage = serde_json::from_value(serde_json::json!({
            "kind": "done",
            "count": 3,
            "expectedCount": 3,
            "countSource": "page-count",
            "endConfirmed": true
        }))
        .unwrap();
        assert!(validate_completion(&message, 3).is_ok());
        assert!(validate_completion(&message, 2).is_err());
        message.end_confirmed = false;
        assert!(validate_completion(&message, 3).is_err());
        message.end_confirmed = true;
        message.count_conflict = true;
        assert!(validate_completion(&message, 3).is_err());
        message.count_conflict = false;
        message.expected_count = Some(4);
        assert!(validate_completion(&message, 3).is_err());
    }

    #[test]
    fn remote_capture_script_has_no_tauri_command_bridge() {
        let script = initialization_script("session-1");
        assert!(!script.contains("__TAURI__"));
        assert!(!script.contains("fetch("));
        assert!(script.contains("__JANE_FACEBOOK_CAPTURE__"));
        assert!(script.contains("__JANE_FACEBOOK_ACK__"));
        assert!(script.contains("janeFacebookPendingRenditionRefresh"));
        assert!(script.contains("__JANE_FACEBOOK_REFRESH__"));
        assert!(script.contains("kind:\"refresh\""));
        assert!(script.contains("pending.splice(0,2)"));
        assert!(script.contains("awaitingSequence === 0"));
        assert!(script.contains("findAlbumScroller"));
        assert!(script.contains("discoverExpectedPhotoCount"));
        assert!(script.contains("const MAX_ATTEMPTS = 1800"));
        assert!(script.contains("const BOTTOM_PROBE_INTERVAL = 4"));
        assert!(script.contains("clickPhotoExpansionControl"));
        assert!(script.contains("expectedCount > scanned.size"));
        assert!(script.contains("Facebook exposed only ${scanned.size} of ${expectedCount}"));
        assert!(script.contains("const probeTop"));
        assert!(script.contains("element.scrollHeight > element.clientHeight + 80"));
        assert!(script.contains("else scroller.scrollTop = nextScrollTop"));
        assert!(script.contains(
            "log in to facebook|log in or sign up|sign up for facebook|see more on facebook"
        ));
        assert!(script.contains("hasLoginForm && /see more from/i.test(text)"));
        assert!(script.contains("input[type=\"password\"], input[name=\"pass\"]"));
        assert!(script.contains("identifiesLogin && hasLoginForm"));
        assert!(script.contains("if (prompt)"));
        assert!(script.contains("getComputedStyle(parent).position === \"fixed\""));
        assert!(script.contains("overlay.remove()"));
        assert!(script.contains("document.body.style.overflow = \"\""));
        assert!(script.contains("ArrowRight"));
        assert!(script.contains("findFallbackNextPhotoUrl"));
        assert!(script.contains("triggerNextKey"));
        assert!(script.contains("janeFacebookKnownPhotoIds"));
        assert!(script.contains("janeFacebookLastProgressAt"));
    }
}
