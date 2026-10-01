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
    let pinterest = pinterest_host
        && (host == "pin.it"
            || path.starts_with("/pin/")
            || (2..=3).contains(&pinterest_segments.len())
                && !matches!(
                    pinterest_segments.first().copied(),
                    Some("search" | "ideas" | "explore" | "business")
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

pub fn initialization_script(nonce: &str, platform: SocialPlatform) -> String {
    let nonce_json = serde_json::to_string(nonce).expect("nonce is a string");
    let platform_json = serde_json::to_string(platform.key()).expect("platform is a string");
    format!(
        r#"(() => {{
  const nonce = {nonce_json};
  const platform = {platform_json};
  const platformLabel = {{instagram:"Instagram",twitter:"X/Twitter",tiktok:"TikTok",reddit:"Reddit",tumblr:"Tumblr",pinterest:"Pinterest"}}[platform] || platform;
  const prefix = "__JANE_SOCIAL_PHOTO_CAPTURE__" + nonce + "__";
  const ackKey = "__JANE_SOCIAL_PHOTO_ACK__" + nonce;
  window[ackKey] = 0;
  const photos = new Map();
  let pending = [];
  let sequence = 0;
  let waiting = 0;
  let attempts = 0;
  let unchanged = 0;
  let lastCount = 0;
  let finished = false;
  let inFlight = null;
  let retryAfterAttempt = 0;
  let retryCount = 0;
  const send = (value) => {{
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    document.title = prefix + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }};
  const sendFinal = (value) => {{
    finished = true;
    let retries = 0;
    const publish = () => {{
      send({{...value,retry:retries++}});
      if (retries < 4) setTimeout(publish, 700);
    }};
    publish();
  }};
  const isCdn = (value) => {{
    try {{
      const parsed = new URL(value, location.href);
      const host = parsed.hostname.toLowerCase();
      const suffixes = {{
        instagram: ["fbcdn.net", "fbsbx.com", "cdninstagram.com"],
        twitter: ["pbs.twimg.com"],
        tiktok: ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "ibyteimg.com", "ibytedtos.com"],
        reddit: ["redd.it", "redditmedia.com"],
        tumblr: ["media.tumblr.com"],
        pinterest: ["pinimg.com"]
      }}[platform] || [];
      if (!suffixes.some(suffix => host === suffix || host.endsWith("." + suffix))) return false;
      if (platform === "instagram") {{
        const lowerUrl = parsed.href.toLowerCase();
        if (host.startsWith("static.") || parsed.pathname.toLowerCase().includes("/rsrc.php")) return false;
        if (lowerUrl.includes("giphy.com") || lowerUrl.includes("/giphy") || parsed.pathname.toLowerCase().endsWith(".gif")) return false;
        if (/\/s(?:150x150|100x100|64x64|40x40|32x32)\b/i.test(lowerUrl)) return false;
      }}
      return true;
    }} catch (_) {{ return false; }}
  }};
  const isInstagramCommentOrChromeImage = (image, container) => {{
    if (platform !== "instagram") return false;
    const alt = (image.getAttribute("alt") || "").trim();
    if (/profile picture|avatar|giphy|sticker/i.test(alt)) return true;
    for (let el = image.parentElement; el && el !== container && el !== document.body; el = el.parentElement) {{
      if (el.tagName === "HEADER") return true;
      if (el.tagName === "UL" && el.querySelector('a[href*="/c/"]')) return true;
      const role = el.getAttribute("role") || "";
      if (role === "complementary") return true;
    }}
    return false;
  }};
  const chooseImage = (image) => {{
    const candidates = [];
    const add = (url, width) => {{ if (url && isCdn(url)) candidates.push({{url, width: Number(width) || 0}}); }};
    add(image.currentSrc, image.naturalWidth);
    add(image.src, image.naturalWidth);
    add(image.getAttribute("data-src"), image.naturalWidth);
    for (const entry of (image.getAttribute("srcset") || "").split(",")) {{
      const parts = entry.trim().split(/\s+/);
      if (parts[0]) add(parts[0], parseInt(parts[1] || "0", 10));
    }}
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0] || null;
  }};
  const isPostCandidateImage = (image, container) => {{
    if (isInstagramCommentOrChromeImage(image, container)) return false;
    const rect = image.getBoundingClientRect();
    const minSize = platform === "instagram" ? 220 : 120;
    if (rect.width < minSize || rect.height < minSize) return false;
    return chooseImage(image);
  }};
  const imageId = (value) => {{
    try {{
      const url = new URL(value, location.href);
      const name = url.pathname.split("/").filter(Boolean).pop() || "";
      return name.replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
    }} catch (_) {{ return ""; }}
  }};
  const pageTitle = () => {{
    const meta = document.querySelector('meta[property="og:title"]');
    const article = document.querySelector("article");
    const text = article && article.innerText ? article.innerText.slice(0, 140) : "";
    const fallback = {{instagram:"Instagram Post",twitter:"X Post",tiktok:"TikTok Photo Post",reddit:"Reddit Gallery",tumblr:"Tumblr Photo Post",pinterest:"Pinterest Collection"}}[platform];
    return ((meta && meta.content) || text || document.title || fallback).slice(0, 200);
  }};
  const closeGuestPrompt = () => {{
    // Social photo viewers use the same generic close label as account
    // prompts. Require login language and account controls before closing so
    // the scan cannot dismiss its own post viewer or carousel.
    const promptPatterns = {{
      instagram: /log in to instagram|sign in to instagram|sign up for instagram/i,
      twitter: /log in to x|sign in to x|sign up for x/i,
      tiktok: /log in to tiktok|sign in to tiktok|sign up for tiktok/i,
      reddit: /log in to reddit|sign in to reddit|sign up for reddit/i,
      tumblr: /log in to tumblr|sign in to tumblr|sign up for tumblr/i,
      pinterest: /log in to pinterest|sign in to pinterest|sign up for pinterest/i
    }};
    const promptPattern = promptPatterns[platform];
    const commonPromptPattern = /log in or sign up|sign in or sign up|log in to continue|sign in to continue|see more from|see more on/i;
    const prompt = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).find((dialog) => {{
      const text = dialog.innerText || "";
      const hasLoginForm = !!dialog.querySelector('input[type="password"], input[name="password"], input[name="pass"], input[autocomplete="current-password"]');
      const hasAccountAction = Array.from(dialog.querySelectorAll('button, [role="button"]')).some((action) =>
        /log in|sign in|sign up|continue with/i.test((action.innerText || "") + " " + (action.getAttribute("aria-label") || ""))
      );
      const identifiesPrompt = (promptPattern && promptPattern.test(text)) || commonPromptPattern.test(text);
      return identifiesPrompt && (hasLoginForm || hasAccountAction);
    }});
    if (prompt) {{
      let overlay = prompt;
      for (let parent = prompt.parentElement; parent && parent !== document.body; parent = parent.parentElement) {{
        const rect = parent.getBoundingClientRect();
        if (getComputedStyle(parent).position === "fixed"
          && rect.width >= window.innerWidth * 0.7
          && rect.height >= window.innerHeight * 0.7) {{
          overlay = parent;
          break;
        }}
      }}
      overlay.remove();
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.position = "";
    }}
  }};
  const postContainer = () => {{
    const articles = Array.from(document.querySelectorAll("article"));
    if (platform === "instagram") {{
      const postId = location.pathname.match(/\/(?:p|reels?)\/([^/]+)\/?$/i)?.[1];
      const permalink = postId && Array.from(document.querySelectorAll("a[href]")).find(anchor => {{
        try {{ return new URL(anchor.href, location.href).pathname.match(/\/(?:p|reels?)\/([^/]+)\/?$/i)?.[1] === postId; }}
        catch (_) {{ return false; }}
      }});
      if (permalink) {{
        for (let container = permalink.parentElement; container && container !== document.body && container.tagName !== "MAIN"; container = container.parentElement) {{
          const hasPublicPostImage = Array.from(container.querySelectorAll("img")).some(image => !!isPostCandidateImage(image, container));
          if (hasPublicPostImage) return container;
        }}
      }}
      const legacyPost = articles[0] || document.querySelector('[role="dialog"]');
      if (legacyPost && Array.from(legacyPost.querySelectorAll("img, video")).some(media => {{
        if (media.tagName === "VIDEO") {{
          const rect = media.getBoundingClientRect();
          return rect.width >= 220 && rect.height >= 220;
        }}
        return !!isPostCandidateImage(media, legacyPost);
      }})) return legacyPost;
      if (permalink) {{
        for (let container = permalink.parentElement; container && container !== document.body && container.tagName !== "MAIN"; container = container.parentElement) {{
          const hasPublicPostVideo = Array.from(container.querySelectorAll("video")).some(video => {{
            const rect = video.getBoundingClientRect();
            return rect.width >= 220 && rect.height >= 220;
          }});
          if (hasPublicPostVideo) return container;
        }}
      }}
      return null;
    }}
    if (platform === "pinterest") {{
      return document.querySelector('[data-test-id="board-pin-grid"], [data-test-id="pinGrid"], main') || document;
    }}
    if (platform === "tiktok") {{
      return document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="photo-post"], [data-e2e="browse-video"]')?.closest('article, [role="dialog"]')
        || document.querySelector('article, [role="dialog"], main') || document;
    }}
    if (platform === "reddit") {{
      return document.querySelector('shreddit-post[post-id], [data-testid="post-container"], article') || document.querySelector('main') || document;
    }}
    if (platform === "tumblr") {{
      return document.querySelector('article, .post, [data-testid="post"]') || document.querySelector('main') || document;
    }}
    const statusId = location.pathname.match(/\/status\/(\d+)/i)?.[1];
    const matching = articles.find(article => !statusId || Array.from(article.querySelectorAll('a[href*="/status/"]')).some(link => link.href.includes("/status/" + statusId)));
    return matching || articles[0] || document.querySelector('[role="dialog"]') || document;
  }};
  const hasVideoPost = () => {{
    if (platform === "instagram" && /^\/(?:[^/]+\/)?reels?\//i.test(location.pathname)) return true;
    const container = postContainer();
    const visibleVideo = !!container && Array.from(container.querySelectorAll("video")).some((video) => {{
      const rect = video.getBoundingClientRect();
      return rect.width >= 220 && rect.height >= 220 && (video.currentSrc || video.src || video.readyState > 0 || video.poster);
    }});
    return visibleVideo || !!document.querySelector('meta[property="og:video"], meta[property="og:video:url"]');
  }};
  const collectPhotos = () => {{
    const container = postContainer();
    if (!container) return;
    const images = Array.from(container.querySelectorAll("img"));
    const candidates = [];
    for (const image of images) {{
      const selected = isPostCandidateImage(image, container);
      if (!selected) continue;
      const rect = image.getBoundingClientRect();
      candidates.push({{image, selected, area: rect.width * rect.height, width: rect.width}});
    }}
    if (platform === "instagram" && candidates.length > 1) {{
      const maxWidth = Math.max(...candidates.map(item => item.width));
      // Filter out smaller auxiliary thumbnails or comment stickers when the main post image is present
      const filtered = candidates.filter(item => item.width >= maxWidth * 0.65);
      candidates.length = 0;
      candidates.push(...filtered);
    }}
    for (const {{selected}} of candidates) {{
      const id = imageId(selected.url);
      if (!id) continue;
      const existing = photos.get(id);
      if (!existing || selected.width > existing.width) {{
        const photo = {{id, url:selected.url, width:selected.width}};
        photos.set(id, photo);
        const pendingIndex = pending.findIndex(item => item.id === id);
        if (pendingIndex >= 0) pending[pendingIndex] = photo;
        else pending.push(photo);
      }}
    }}
  }};
  const nextButton = () => {{
    const container = postContainer();
    if (!container) return null;
    const nextLabelPattern = /^(next|next photo|next image|next slide|next image \(.*\)|go to next (photo|image|slide)|التالي|다음|次へ|下一步|下一张|下一張|siguiente|suivant|weiter|далее|avanti|próximo|ileri|berikutnya|tiếp|ถัดไป|הבא)$/i;
    return Array.from(container.querySelectorAll('button[aria-label], [role="button"][aria-label], button._afxw'))
      .find(button => button.classList.contains("_afxw") || nextLabelPattern.test((button.getAttribute("aria-label") || "").trim()));
  }};
  const flush = (title) => {{
    if (!pending.length || waiting) return false;
    const batch = pending.splice(0, 2);
    waiting = ++sequence;
    inFlight = {{kind:"photos",sequence,photos:batch,title,platform}};
    retryCount = 0;
    retryAfterAttempt = attempts + 3;
    send(inFlight);
    return true;
  }};
  const scan = () => {{
    if (finished) return;
    if (window.__JANE_CAPTURE_PAUSED__) {{
      setTimeout(scan, 300);
      return;
    }}
    attempts += 1;
    if (waiting && window[ackKey] === waiting) {{
      waiting = 0;
      inFlight = null;
    }} else if (waiting && inFlight && attempts >= retryAfterAttempt) {{
      retryCount += 1;
      send({{...inFlight,retry:retryCount}});
      retryAfterAttempt = attempts + 3;
    }}
    closeGuestPrompt();
    const path = location.pathname.toLowerCase();
    const loginPath = path.includes("/accounts/login") || path.includes("/i/flow/login") || path.includes("/challenge/") || path.includes("/checkpoint/") || path.includes("/login");
    if (loginPath) {{
      sendFinal({{kind:"error",error:platformLabel + " requires sign-in to view this collection. JaneConverter only captures photos visible to logged-out visitors."}});
      return;
    }}
    collectPhotos();
    const title = pageTitle();
    if (!photos.size && !pending.length && attempts >= 3 && hasVideoPost()) {{
      sendFinal({{kind:"video",count:0,title,platform}});
      return;
    }}
    if (pending.length && !waiting) {{ flush(title); }}
    const currentCount = photos.size;
    if (currentCount === lastCount) unchanged = Math.min(unchanged + 1, 20);
    else unchanged = 0;
    lastCount = currentCount;
    if (["instagram", "tiktok", "reddit"].includes(platform) && photos.size < 500 && !waiting && !pending.length) {{
      const next = nextButton();
      if (next && next.getAttribute("aria-disabled") !== "true" && !next.disabled) {{
        next.click();
        unchanged = 0;
        setTimeout(scan, 850);
        return;
      }}
    }}
    const isPinterestBoard = platform === "pinterest" && !path.startsWith("/pin/");
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;
    if (isPinterestBoard && photos.size < 500) {{
      window.scrollTo(0, Math.min(window.scrollY + Math.max(400, window.innerHeight * 0.8), document.documentElement.scrollHeight));
    }}
    const noPhotoWait = platform === "instagram" && !postContainer() ? 15 : isPinterestBoard ? 16 : 6;
    const settled = isPinterestBoard ? atBottom && unchanged >= 8 : unchanged >= 3;
    if (photos.size >= 500 && !waiting && !pending.length) {{
      const capNextButton = nextButton();
      const hasMoreSlides = ["instagram", "tiktok", "reddit"].includes(platform)
        && capNextButton
        && capNextButton.getAttribute("aria-disabled") !== "true"
        && !capNextButton.disabled;
      if (hasMoreSlides || (isPinterestBoard && !(atBottom && unchanged >= 8))) {{
        sendFinal({{kind:"error",error:platformLabel + " collection exceeds the 500-photo capture limit; nothing was saved."}});
      }} else if (settled) {{
        sendFinal({{kind:"done",count:photos.size,title,platform}});
      }}
      if (finished) return;
    }}
    if (attempts >= noPhotoWait && settled && !waiting && !pending.length) {{
      if (photos.size) sendFinal({{kind:"done",count:photos.size,title,platform}});
      else if (hasVideoPost()) sendFinal({{kind:"video",count:0,title,platform}});
      else if (platform === "twitter") sendFinal({{kind:"no_photos",count:0,title,platform}});
      else sendFinal({{kind:"error",error:"No public " + platformLabel + " photos were visible in this post."}});
      return;
    }}
    if (attempts >= 80) {{
      sendFinal({{kind:"error",error:platformLabel + " did not expose a complete public photo collection in time."}});
      return;
    }}
    setTimeout(scan, 900);
  }};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(scan, 1000), {{once:true}});
  else setTimeout(scan, 1000);
}})();"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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
            let script = initialization_script("session-1", platform);
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
