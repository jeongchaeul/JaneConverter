use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use std::collections::BTreeMap;
use url::Url;

use crate::model::FacebookPhoto;

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
    pub sequence: usize,
    #[serde(default)]
    pub photos: Vec<FacebookPhoto>,
}

#[derive(Debug, Default)]
pub struct CaptureAccumulator {
    pub title: String,
    pub photos: BTreeMap<String, FacebookPhoto>,
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
            || path.ends_with("/story.php"))
    {
        return Err("Paste a public Facebook post link to capture its photos.".into());
    }
    Ok(url)
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
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && (host == "fbcdn.net"
                || host.ends_with(".fbcdn.net")
                || host == "fbsbx.com"
                || host.ends_with(".fbsbx.com"))
    })
}

pub fn message_from_title(title: &str, nonce: &str) -> Option<PageMessage> {
    let prefix = format!("__JANE_FACEBOOK_CAPTURE__{nonce}__");
    let encoded = title.strip_prefix(&prefix)?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn initialization_script(nonce: &str) -> String {
    let nonce_json = serde_json::to_string(nonce).expect("nonce is a string");
    format!(
        r#"(() => {{
  const nonce = {nonce_json};
  const prefix = "__JANE_FACEBOOK_CAPTURE__" + nonce + "__";
  const ackKey = "__JANE_FACEBOOK_ACK__" + nonce;
  const expectedCountKey = "janeFacebookExpectedPhotoCount";
  const captureModeKey = "janeFacebookCaptureMode";
  const albumSetKey = "janeFacebookAlbumSet";
  const scannedIdsKey = "janeFacebookScannedPhotoIds";
  const attemptsKey = "janeFacebookCaptureAttempts";
  const startedAtKey = "janeFacebookCaptureStartedAt";
  const viewerImageKey = "janeFacebookViewerImageUrl";
  const MAX_PHOTOS = 500;
  const MAX_ATTEMPTS = 180;
  const MAX_CAPTURE_MS = 180000;
  const VIEWER_POLL_MS = 250;
  const BOTTOM_PROBE_INTERVAL = 4;
  const MAX_EXPANSION_CLICKS = 20;
  let lastPageTitle = document.title || "";
  window[ackKey] = 0;
  let scanned;
  try {{ scanned = new Set(JSON.parse(sessionStorage.getItem(scannedIdsKey) || "[]")); }}
  catch (_) {{ scanned = new Set(); }}
  let unchanged = 0;
  let previousCount = 0;
  let expectedCount = Number(sessionStorage.getItem(expectedCountKey)) || 0;
  let attempts = Number(sessionStorage.getItem(attemptsKey)) || 0;
  const startedAt = Number(sessionStorage.getItem(startedAtKey)) || Date.now();
  sessionStorage.setItem(startedAtKey, String(startedAt));
  let lastViewerImageUrl = sessionStorage.getItem(viewerImageKey) || "";
  let navigatingFromId = "";
  let expansionClicks = 0;
  let lastExpansionClickAttempt = 0;
  let finished = false;
  let pending = [];
  let nextSequence = 0;
  let awaitingSequence = 0;
  const send = (value) => {{
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    document.title = prefix + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }};
  const readPageTitle = () => {{
    const current = document.title || "";
    if (current && !current.startsWith(prefix)) lastPageTitle = current;
    return lastPageTitle;
  }};
  const pageTitle = () => {{
    const meta = document.querySelector('meta[property="og:title"]');
    return (meta && meta.content) || readPageTitle() || "Facebook Post";
  }};
  const photoCountFromText = (value, includeUnqualifiedCounts) => {{
    let total = 0;
    if (includeUnqualifiedCounts) {{
      for (const match of value.matchAll(/\b(\d{{1,3}})\s+(?:photos?|images?|pictures?)\b/gi)) {{
        const count = Number(match[1]);
        if (count >= 2 && count <= MAX_PHOTOS) total = Math.max(total, count);
      }}
    }}
    for (const match of value.matchAll(/\b(?:photos?|images?|pictures?)\s+\d{{1,4}}\s+(?:of|\/)\s*(\d{{1,3}})\b/gi)) {{
      const count = Number(match[1]);
      if (count >= 2 && count <= MAX_PHOTOS) total = Math.max(total, count);
    }}
    return total;
  }};
  const discoverExpectedPhotoCount = () => {{
    const onAlbumPage = location.pathname.toLowerCase().includes("/media/set/");
    const sources = [
      {{value: readPageTitle(), includeUnqualifiedCounts: !onAlbumPage}},
      {{value: document.querySelector('meta[property="og:title"]')?.content || "", includeUnqualifiedCounts: !onAlbumPage}},
      {{value: document.querySelector('meta[property="og:description"]')?.content || "", includeUnqualifiedCounts: !onAlbumPage}},
      {{value: document.body?.innerText || "", includeUnqualifiedCounts: !onAlbumPage}}
    ];
    for (const heading of document.querySelectorAll('h1, h2, [role="heading"]')) {{
      sources.push({{value: heading.innerText || "", includeUnqualifiedCounts: !onAlbumPage}});
    }}
    for (const element of document.querySelectorAll("[aria-label], [title]")) {{
      const label = [element.getAttribute("aria-label"), element.getAttribute("title")]
        .filter(Boolean).join(" ");
      if (/photo|image|picture/i.test(label)) sources.push({{value: label, includeUnqualifiedCounts: false}});
    }}
    let expected = sources.reduce((largest, source) => Math.max(
      largest,
      photoCountFromText(source.value, source.includeUnqualifiedCounts)
    ), 0);
    const galleryLinks = Array.from(document.querySelectorAll('a[href*="fbid="]'));
    if (galleryLinks.length === 4 || galleryLinks.length === 5) {{
      const overlayText = (galleryLinks[galleryLinks.length - 1].innerText || "")
        .replace(/\s+/g, "").trim();
      const remaining = /^\+(\d{{1,3}})$/.exec(overlayText);
      if (remaining) expected = Math.max(expected, galleryLinks.length + Number(remaining[1]) - 1);
    }}
    return expected;
  }};
  const isCdn = (value) => {{
    try {{ const host = new URL(value, location.href).hostname.toLowerCase(); return host.endsWith(".fbcdn.net") || host === "fbcdn.net" || host.endsWith(".fbsbx.com") || host === "fbsbx.com"; }} catch (_) {{ return false; }}
  }};
  const chooseImage = (image) => {{
    const candidates = [];
    for (const value of [image.currentSrc, image.src, image.getAttribute("data-src")]) {{
      if (value && isCdn(value)) candidates.push({{url: value, width: image.naturalWidth || 0}});
    }}
    for (const entry of (image.getAttribute("srcset") || "").split(",")) {{
      const parts = entry.trim().split(/\s+/);
      if (parts[0] && isCdn(parts[0])) candidates.push({{url: parts[0], width: parseInt(parts[1] || "0", 10) || 0}});
    }}
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0] || null;
  }};
  const hasVisiblePublicPhoto = () => {{
    if (new URL(location.href).pathname.toLowerCase().includes("/photo"))
      return !!findCurrentViewerPhoto();
    return Array.from(document.querySelectorAll('a[href*="fbid="] img')).some((image) => {{
      const rect = image.getBoundingClientRect();
      return rect.width >= 80 && rect.height >= 80 && chooseImage(image);
    }});
  }};
  const closeGuestPrompt = () => {{
    // Facebook also labels the photo viewer's close button "Close". Only
    // dismiss a dialog when its own text identifies it as an account prompt;
    // otherwise this can close the album before its photos are scanned.
    const prompt = Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) => {{
      const text = dialog.innerText || "";
      const loginForm = dialog.querySelector('#login_popup_cta_form, form[action*="/login/"]');
      const hasLoginForm = !!loginForm || (dialog.querySelector('input[type="password"], input[name="pass"]')
        && dialog.querySelector('button[aria-label*="log in" i], button[type="submit"]'));
      const identifiesLogin = /log in to facebook|log in or sign up|sign up for facebook|see more on facebook/i.test(text)
        || (hasLoginForm && /see more from/i.test(text));
      return identifiesLogin && hasLoginForm && hasVisiblePublicPhoto();
    }});
    if (prompt) {{
      let overlay = prompt;
      for (let parent = prompt.parentElement; parent && parent !== document.body; parent = parent.parentElement) {{
        const rect = parent.getBoundingClientRect();
        const isFixed = getComputedStyle(parent).position === "fixed";
        const isAbsolute = getComputedStyle(parent).position === "absolute";
        if (parent.parentElement === document.body
          && parent.querySelectorAll('[role="dialog"]').length === 1
          && !parent.querySelector('[aria-label="Photo Viewer"], a[href*="fbid="]')) {{
          overlay = parent;
          break;
        }}
        if ((isFixed || isAbsolute)
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
  const findAlbumSet = () => {{
    for (const anchor of document.querySelectorAll('a[href*="fbid="]')) {{
      try {{
        const href = new URL(anchor.href, location.href);
        const set = href.searchParams.get("set");
        if (set && set.startsWith("pcb.")) return set;
      }} catch (_) {{}}
    }}
    return "";
  }};
  const normalizeFacebookUrl = (value) => {{
    try {{
      const url = new URL(value, location.href);
      const host = url.hostname.toLowerCase();
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return "";
      url.protocol = "https:";
      url.hostname = location.hostname.toLowerCase();
      url.hash = "";
      return url.href;
    }} catch (_) {{ return ""; }}
  }};
  const findAlbumStartPhoto = () => {{
    const pageSet = new URL(location.href).searchParams.get("set") || "";
    for (const anchor of document.querySelectorAll('a[href*="fbid="]')) {{
      try {{
        const href = new URL(anchor.href, location.href);
        const photoId = href.searchParams.get("fbid") || "";
        const set = href.searchParams.get("set") || pageSet;
        if (/^[0-9]{{5,30}}$/.test(photoId) && set.startsWith("pcb.")) {{
          const normalized = normalizeFacebookUrl(href.href);
          if (normalized) {{
            const photoUrl = new URL(normalized);
            if (!photoUrl.searchParams.has("set")) photoUrl.searchParams.set("set", set);
            return {{anchor, url:photoUrl.href}};
          }}
        }}
      }} catch (_) {{}}
    }}
    return "";
  }};
  const findCurrentViewerPhoto = () => {{
    const pageUrl = new URL(location.href);
    let photoId = pageUrl.searchParams.get("fbid") || pageUrl.searchParams.get("photo_id") || "";
    const preferredImages = Array.from(document.querySelectorAll('[data-sigil*="photo-image"]'))
      .filter((image) => image.tagName === "IMG");
    const allImages = preferredImages.length ? preferredImages : Array.from(document.images);
    const candidates = allImages.map((image) => {{
      const selected = chooseImage(image);
      const rect = image.getBoundingClientRect();
      return selected && image.complete && image.naturalWidth >= 80
        && rect.width >= 80 && rect.height >= 80
        ? {{image, selected, area: rect.width * rect.height}}
        : null;
    }}).filter(Boolean).sort((left, right) => right.area - left.area);
    const candidate = candidates[0];
    if (!photoId && candidate) {{
      const anchor = candidate.image.closest('a[href*="fbid="]');
      if (anchor) {{
        try {{ photoId = new URL(anchor.href, location.href).searchParams.get("fbid") || ""; }}
        catch (_) {{}}
      }}
    }}
    if (!candidate || !/^[0-9]{{5,30}}$/.test(photoId)) return null;
    return {{id:photoId,url:candidate.selected.url,width:candidate.selected.width}};
  }};
  const findNextPhotoUrl = () => {{
    const hasPhotosFrom = Array.from(document.querySelectorAll("a"))
      .some((anchor) => (anchor.innerText || "").includes("Photos from"));
    const preferredToken = hasPhotosFrom ? "+=" : "+>";
    const currentId = new URL(location.href).searchParams.get("fbid") || "";
    const arrows = Array.from(document.querySelectorAll('a.touchable[data-gt], a[data-gt]'))
      .map((anchor) => {{
        try {{ return {{anchor, direction:JSON.parse(anchor.getAttribute("data-gt") || "{{}}").tn || ""}}; }}
        catch (_) {{ return {{anchor, direction:""}}; }}
      }})
      .filter((entry) => entry.direction === "+>" || entry.direction === "+=");
    const ordered = arrows.sort((left, right) =>
      Number(right.direction === preferredToken) - Number(left.direction === preferredToken)
    );
    for (const entry of ordered) {{
      const target = normalizeFacebookUrl(entry.anchor.href);
      if (!target || target === normalizeFacebookUrl(location.href)) continue;
      try {{
        const targetUrl = new URL(target);
        if (targetUrl.searchParams.has("fbid") && targetUrl.searchParams.get("fbid") !== currentId) return target;
      }} catch (_) {{}}
    }}
    const labelledNext = Array.from(document.querySelectorAll('a[href], button, [role="button"]'))
      .find((element) => /next\s*(photo|image)?/i.test([
        element.getAttribute("aria-label"), element.getAttribute("title"), element.innerText
      ].filter(Boolean).join(" ")));
    if (labelledNext?.href) return normalizeFacebookUrl(labelledNext.href);
    if (labelledNext) {{ labelledNext.click(); return "clicked"; }}
    return "";
  }};
  const findAlbumScroller = () => {{
    const candidates = Array.from(document.querySelectorAll("div"))
      .filter((element) => element.querySelector('a[href*="fbid="]'))
      .filter((element) => {{
        const overflowY = getComputedStyle(element).overflowY;
        return element.clientHeight > 0
          && element.scrollHeight > element.clientHeight + 80
          && (overflowY === "auto" || overflowY === "scroll");
      }});
    candidates.sort((left, right) =>
      (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight)
    );
    return candidates[0] || document.scrollingElement || document.documentElement;
  }};
  const clickPhotoExpansionControl = () => {{
    if (expansionClicks >= MAX_EXPANSION_CLICKS
      || attempts - lastExpansionClickAttempt < BOTTOM_PROBE_INTERVAL * 2) return false;
    const controls = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const control = controls.find((element) => {{
      const label = [element.getAttribute("aria-label"), element.getAttribute("title"), element.innerText]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      const namesPhotos = /photo|image|picture/i.test(label);
      const offersMore = /(?:see|view|show|load)\b.*\b(?:more|all|photos?|images?|pictures?)\b|\b(?:more|all)\s+(?:photos?|images?|pictures?)\b/i.test(label);
      const rect = element.getBoundingClientRect();
      return namesPhotos && offersMore && rect.width > 0 && rect.height > 0 && !element.disabled;
    }});
    if (!control) return false;
    control.click();
    expansionClicks += 1;
    lastExpansionClickAttempt = attempts;
    return true;
  }};
  const scan = () => {{
    if (finished) return;
    attempts += 1;
    sessionStorage.setItem(attemptsKey, String(attempts));
    if (awaitingSequence && window[ackKey] === awaitingSequence) awaitingSequence = 0;
    closeGuestPrompt();
    let captureMode = sessionStorage.getItem(captureModeKey) || "";
    if (captureMode !== "viewer" || !expectedCount)
      expectedCount = Math.max(expectedCount, discoverExpectedPhotoCount());
    if (expectedCount) sessionStorage.setItem(expectedCountKey, String(expectedCount));
    if (Date.now() - startedAt >= MAX_CAPTURE_MS
      || (captureMode !== "viewer" && attempts >= MAX_ATTEMPTS)) {{
      finished = true;
      const error = expectedCount > scanned.size
        ? `Facebook exposed only ${{scanned.size}} of ${{expectedCount}} public album photos before the capture timed out. No partial album was saved.`
        : `Facebook did not confirm the public album was complete after finding ${{scanned.size}} photos. No partial album was saved.`;
      send({{kind:"error",error}});
      return;
    }}
    if (location.pathname.toLowerCase().includes("/login")) {{
      const albumSet = sessionStorage.getItem(albumSetKey) || "";
      if (captureMode === "viewer" && albumSet.startsWith("pcb.")) {{
        const albumUrl = new URL("/media/set/", location.href);
        albumUrl.searchParams.set("set", albumSet);
        sessionStorage.setItem(captureModeKey, "grid");
        sessionStorage.setItem(attemptsKey, "0");
        location.replace(albumUrl.href);
        return;
      }}
      finished = true;
      send({{kind:"error",error:"Facebook redirected the post or photo viewer to a sign-in page before JaneConverter could reach its public photos."}});
      return;
    }}
    const onAlbumPage = location.pathname.toLowerCase().includes("/media/set/");
    if (captureMode === "") {{
      sessionStorage.setItem("janeFacebookCaptureTitle", pageTitle());
      const startPhoto = findAlbumStartPhoto();
      if (startPhoto && hasVisiblePublicPhoto()) {{
        const photoUrl = new URL(startPhoto.url);
        const albumSet = photoUrl.searchParams.get("set") || "";
        if (albumSet.startsWith("pcb.")) sessionStorage.setItem(albumSetKey, albumSet);
        sessionStorage.setItem(captureModeKey, "viewer");
        sessionStorage.setItem(scannedIdsKey, JSON.stringify(Array.from(scanned)));
        if (expectedCount) sessionStorage.setItem(expectedCountKey, String(expectedCount));
        startPhoto.anchor.click();
        setTimeout(scan, VIEWER_POLL_MS);
        return;
      }}
      if (!onAlbumPage) {{
        const set = findAlbumSet();
        if (set) {{
          sessionStorage.setItem(albumSetKey, set);
          if (expectedCount) sessionStorage.setItem(expectedCountKey, String(expectedCount));
          sessionStorage.setItem(captureModeKey, "grid");
          const albumUrl = new URL("/media/set/", location.href);
          albumUrl.searchParams.set("set", set);
          location.replace(albumUrl.href);
          return;
        }}
      }}
    }}
    if (captureMode === "viewer") {{
      if (!location.pathname.toLowerCase().includes("/photo")) {{
        const startPhoto = findAlbumStartPhoto();
        if (startPhoto && hasVisiblePublicPhoto()) startPhoto.anchor.click();
        setTimeout(scan, VIEWER_POLL_MS);
        return;
      }}
      const savedTitle = sessionStorage.getItem("janeFacebookCaptureTitle");
      const title = savedTitle || pageTitle() || "Facebook Photo Album";
      const currentPhoto = findCurrentViewerPhoto();
      if (currentPhoto) {{
        if (navigatingFromId === currentPhoto.id
          || (!scanned.has(currentPhoto.id) && currentPhoto.url === lastViewerImageUrl)) {{
          setTimeout(scan, VIEWER_POLL_MS);
          return;
        }}
        navigatingFromId = "";
        if (!scanned.has(currentPhoto.id)) {{
          scanned.add(currentPhoto.id);
          sessionStorage.setItem(scannedIdsKey, JSON.stringify(Array.from(scanned)));
          lastViewerImageUrl = currentPhoto.url;
          sessionStorage.setItem(viewerImageKey, lastViewerImageUrl);
          pending.push(currentPhoto);
        }}
        if (pending.length && awaitingSequence === 0) {{
          awaitingSequence = ++nextSequence;
          send({{kind:"photos",sequence:awaitingSequence,photos:pending.splice(0,1),title}});
        }}
        const reachedExpectedCount = expectedCount > 0 && scanned.size === expectedCount;
        if (reachedExpectedCount && pending.length === 0 && awaitingSequence === 0) {{
          finished = true;
          send({{kind:"done",count:scanned.size,expectedCount,title}});
          return;
        }}
        if (pending.length === 0 && awaitingSequence === 0 && expectedCount > scanned.size) {{
          const nextPhotoUrl = findNextPhotoUrl();
          if (nextPhotoUrl === "clicked") {{
            navigatingFromId = currentPhoto.id;
            setTimeout(scan, VIEWER_POLL_MS);
            return;
          }}
          if (nextPhotoUrl) {{
            location.replace(nextPhotoUrl);
            return;
          }}
        }}
      }}
    }} else if (onAlbumPage) {{
      const savedTitle = sessionStorage.getItem("janeFacebookCaptureTitle");
      const albumTitle = pageTitle();
      const title = savedTitle || (albumTitle && albumTitle !== "Facebook" ? albumTitle : "Facebook Photo Album");
      for (const anchor of document.querySelectorAll('a[href*="fbid="]')) {{
        let photoId = "";
        try {{ photoId = new URL(anchor.href, location.href).searchParams.get("fbid") || ""; }} catch (_) {{}}
        if (!/^[0-9]{{5,30}}$/.test(photoId) || scanned.has(photoId)) continue;
        const image = anchor.querySelector("img");
        const selected = image && chooseImage(image);
        if (!selected) continue;
        scanned.add(photoId);
        pending.push({{id:photoId,url:selected.url,width:selected.width}});
      }}
      if (scanned.size) sessionStorage.setItem(scannedIdsKey, JSON.stringify(Array.from(scanned)));
      if (pending.length && awaitingSequence === 0) {{
        awaitingSequence = ++nextSequence;
        send({{kind:"photos",sequence:awaitingSequence,photos:pending.splice(0,2),title}});
      }}
      const scroller = findAlbumScroller();
      const isDocumentScroller = scroller === document.scrollingElement || scroller === document.documentElement;
      const scrollTop = isDocumentScroller ? window.scrollY : scroller.scrollTop;
      const viewportHeight = isDocumentScroller ? window.innerHeight : scroller.clientHeight;
      const scrollHeight = isDocumentScroller ? document.documentElement.scrollHeight : scroller.scrollHeight;
      const atBottom = scrollTop + viewportHeight >= scrollHeight - 8;
      if (scanned.size === previousCount) unchanged += 1;
      else unchanged = 0;
      previousCount = scanned.size;
      const expanded = atBottom && clickPhotoExpansionControl();
      if (!atBottom) {{
        const nextScrollTop = Math.min(scrollTop + Math.max(400, viewportHeight * 0.8), scrollHeight);
        if (isDocumentScroller) window.scrollTo(0, nextScrollTop);
        else scroller.scrollTop = nextScrollTop;
      }} else if (!expanded && unchanged > 0 && unchanged % BOTTOM_PROBE_INTERVAL === 0) {{
        const backoff = Math.min(240, Math.max(80, viewportHeight * 0.12));
        const bottom = Math.max(0, scrollHeight - viewportHeight);
        const probeTop = Math.max(0, Math.min(scrollTop, bottom) - backoff);
        if (isDocumentScroller) window.scrollTo(0, probeTop);
        else scroller.scrollTop = probeTop;
      }}
      const reachedExpectedCount = expectedCount > 0 && scanned.size === expectedCount;
      if (reachedExpectedCount && pending.length === 0 && awaitingSequence === 0) {{
        finished = true;
        if (scanned.size >= 2) send({{kind:"done",count:scanned.size,expectedCount,title}});
        else send({{kind:"error",error:"No multi-photo album was visible to a logged-out visitor."}});
        return;
      }}
    }}
    setTimeout(scan, captureMode === "viewer" ? VIEWER_POLL_MS : 1000);
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
    fn only_facebook_post_links_are_accepted() {
        assert!(validate_post_url("https://www.facebook.com/share/p/abc123/").is_ok());
        assert!(validate_post_url("https://www.facebook.com/groups/42/permalink/123/").is_ok());
        assert!(validate_post_url("http://www.facebook.com/share/p/abc123/").is_err());
        assert!(validate_post_url("https://example.com/posts/123").is_err());
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
    fn remote_capture_script_has_no_tauri_command_bridge() {
        let script = initialization_script("session-1");
        assert!(!script.contains("__TAURI__"));
        assert!(!script.contains("fetch("));
        assert!(script.contains("__JANE_FACEBOOK_CAPTURE__"));
        assert!(script.contains("__JANE_FACEBOOK_ACK__"));
        assert!(script.contains("pending.splice(0,2)"));
        assert!(script.contains("awaitingSequence === 0"));
        assert!(script.contains("findAlbumScroller"));
        assert!(script.contains("discoverExpectedPhotoCount"));
        assert!(script.contains("const MAX_ATTEMPTS = 180"));
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
    }
}
