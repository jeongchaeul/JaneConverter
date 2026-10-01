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
            || path.ends_with("/story.php"))
    {
        return Err("Paste a public Facebook post link to capture its photos.".into());
    }
    Ok(url)
}

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
        || !(2..=500).contains(&message.count)
    {
        return Err(format!(
            "Facebook reported {} photos, expected {}, and delivered {}. No partial album was saved.",
            message.count, expected_count, received_count
        ));
    }
    Ok(())
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
  const pendingRefreshKey = "janeFacebookPendingRenditionRefresh";
  const refreshFunctionKey = "__JANE_FACEBOOK_REFRESH__" + nonce;
  const attemptsKey = "janeFacebookCaptureAttempts";
  const startedAtKey = "janeFacebookCaptureStartedAt";
  const viewerImageKey = "janeFacebookViewerImageUrl";
  const MAX_PHOTOS = 500;
  const MAX_ATTEMPTS = 1800;
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
  let countSource = sessionStorage.getItem("janeFacebookCountSource") || "";
  let countConflict = sessionStorage.getItem("janeFacebookCountConflict") === "true";
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
  let endConfirmed = false;
  let lastRelevantMutationAt = Date.now();
  let scheduledScan = 0;
  const scheduleScan = (delay = 100) => {{
    if (finished || scheduledScan) return;
    scheduledScan = setTimeout(() => {{ scheduledScan = 0; scan(); }}, delay);
  }};
  const send = (value) => {{
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    document.title = prefix + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }};
  window[refreshFunctionKey] = (requestId, photoId) => {{
    if (!/^[a-f0-9]{{32}}$/i.test(requestId || "") || !/^[0-9]{{5,30}}$/.test(photoId || "")) return false;
    const albumSet = sessionStorage.getItem(albumSetKey) || new URL(location.href).searchParams.get("set") || "";
    if (!albumSet.startsWith("pcb.")) return false;
    sessionStorage.setItem(pendingRefreshKey, JSON.stringify({{requestId,photoId}}));
    const target = new URL("/photo/", location.href);
    target.searchParams.set("fbid", photoId);
    target.searchParams.set("set", albumSet);
    location.replace(target.href);
    return true;
  }};
  const readPageTitle = () => {{
    const current = document.title || "";
    if (current && !current.startsWith(prefix)) lastPageTitle = current;
    return lastPageTitle;
  }};
  const pageTitle = () => {{
    const meta = document.querySelector('meta[property="og:title"]');
    return ((meta && meta.content) || readPageTitle() || "Facebook Post").slice(0, 200);
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
      {{value: document.querySelector('meta[property="og:description"]')?.content || "", includeUnqualifiedCounts: !onAlbumPage}}
    ];
    for (const heading of document.querySelectorAll('h1, h2, [role="heading"]')) {{
      sources.push({{value: heading.innerText || "", includeUnqualifiedCounts: !onAlbumPage}});
    }}
    for (const element of document.querySelectorAll("[aria-label], [title]")) {{
      const label = [element.getAttribute("aria-label"), element.getAttribute("title")]
        .filter(Boolean).join(" ");
      if (/photo|image|picture/i.test(label)) sources.push({{value: label, includeUnqualifiedCounts: false}});
    }}
    const exactCounts = new Set(sources.map((source) =>
      photoCountFromText(source.value, source.includeUnqualifiedCounts)
    ).filter(Boolean));
    const exact = exactCounts.size === 1 ? [...exactCounts][0] : 0;
    let lowerBound = 0;
    const galleryLinks = Array.from(document.querySelectorAll('a[href*="fbid="][href*="set=pcb."]'));
    if (galleryLinks.length === 4 || galleryLinks.length === 5) {{
      const overlayText = (galleryLinks[galleryLinks.length - 1].innerText || "")
        .replace(/\s+/g, "").trim();
      const remaining = /^\+(\d{{1,3}})$/.exec(overlayText);
      if (remaining) lowerBound = galleryLinks.length + Number(remaining[1]) - 1;
    }}
    return {{count:Math.max(exact,lowerBound),source:exact ? "page-count" : lowerBound ? "overlay-minimum" : "",conflict:exactCounts.size > 1 || (exact > 0 && lowerBound > exact)}};
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
    if (!candidates.length) return null;
    const unique = [...new Set(candidates.map((candidate) => candidate.url))];
    return {{...candidates[0], alternates:unique.filter((url) => url !== candidates[0].url).slice(0,3)}};
  }};
  const hasVisiblePublicPhoto = () => {{
    if (new URL(location.href).pathname.toLowerCase().includes("/photo"))
      return !!findCurrentViewerPhoto();
    return Array.from(document.querySelectorAll('a[href*="fbid="] img')).some((image) => {{
      const rect = image.getBoundingClientRect();
      return rect.width >= 80 && rect.height >= 80 && chooseImage(image);
    }});
  }};
  const hasVideoPost = () => {{
    const root = document.querySelector('[role="article"], article, main') || document;
    const visibleVideo = Array.from(root.querySelectorAll('video')).some((video) => {{
      const rect = video.getBoundingClientRect();
      return rect.width >= 160 && rect.height >= 90
        && (video.currentSrc || video.readyState > 0 || video.poster);
    }});
    return visibleVideo || !!document.querySelector('meta[property="og:video"], meta[property="og:video:url"]');
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
    return {{id:photoId,url:candidate.selected.url,width:candidate.selected.width,alternates:candidate.selected.alternates}};
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
    const refreshText = sessionStorage.getItem(pendingRefreshKey) || "";
    if (refreshText) {{
      let refresh = null;
      try {{ refresh = JSON.parse(refreshText); }} catch (_) {{}}
      if (!refresh || !/^[a-f0-9]{{32}}$/i.test(refresh.requestId || "")
        || !/^[0-9]{{5,30}}$/.test(refresh.photoId || "")) {{
        sessionStorage.removeItem(pendingRefreshKey);
        return;
      }}
      const page = new URL(location.href);
      if (!page.pathname.toLowerCase().includes("/photo")
        || page.searchParams.get("fbid") !== refresh.photoId) {{
        const albumSet = sessionStorage.getItem(albumSetKey) || page.searchParams.get("set") || "";
        if (!albumSet.startsWith("pcb.")) {{
          sessionStorage.removeItem(pendingRefreshKey);
          send({{kind:"refresh",requestId:refresh.requestId,photos:[]}});
          return;
        }}
        const target = new URL("/photo/", location.href);
        target.searchParams.set("fbid", refresh.photoId);
        target.searchParams.set("set", albumSet);
        location.replace(target.href);
        return;
      }}
      const refreshedPhoto = findCurrentViewerPhoto();
      if (refreshedPhoto && refreshedPhoto.id === refresh.photoId) {{
        sessionStorage.removeItem(pendingRefreshKey);
        finished = true;
        send({{kind:"refresh",requestId:refresh.requestId,photos:[refreshedPhoto]}});
        return;
      }}
      scheduleScan(VIEWER_POLL_MS);
      return;
    }}
    if (finished) return;
    attempts += 1;
    sessionStorage.setItem(attemptsKey, String(attempts));
    if (awaitingSequence && window[ackKey] === awaitingSequence) awaitingSequence = 0;
    closeGuestPrompt();
    let captureMode = sessionStorage.getItem(captureModeKey) || "";
    if (captureMode !== "viewer" || !expectedCount) {{
      const evidence = discoverExpectedPhotoCount();
      if (evidence.conflict || (countSource === "page-count" && evidence.source === "page-count" && expectedCount && evidence.count !== expectedCount)) countConflict = true;
      if (evidence.count > expectedCount || (evidence.source === "page-count" && countSource !== "page-count")) {{
        expectedCount = evidence.count;
        countSource = evidence.source;
      }}
      sessionStorage.setItem("janeFacebookCountConflict", String(countConflict));
      sessionStorage.setItem("janeFacebookCountSource", countSource);
    }}
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
    if (scanned.size > MAX_PHOTOS) {{
      finished = true;
      send({{kind:"error",error:"Facebook exposed more than the 500-photo capture limit. No partial album was saved."}});
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
        scheduleScan(VIEWER_POLL_MS);
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
      if (attempts >= 3 && !startPhoto && !findAlbumSet() && hasVideoPost()) {{
        finished = true;
        send({{kind:"video",title:pageTitle()}});
        return;
      }}
    }}
    if (captureMode === "viewer") {{
      if (!location.pathname.toLowerCase().includes("/photo")) {{
        const startPhoto = findAlbumStartPhoto();
        if (startPhoto && hasVisiblePublicPhoto()) startPhoto.anchor.click();
        scheduleScan(VIEWER_POLL_MS);
        return;
      }}
      const savedTitle = sessionStorage.getItem("janeFacebookCaptureTitle");
      const title = savedTitle || pageTitle() || "Facebook Photo Album";
      const currentPhoto = findCurrentViewerPhoto();
      if (currentPhoto) {{
        if (navigatingFromId === currentPhoto.id
          || (!scanned.has(currentPhoto.id) && currentPhoto.url === lastViewerImageUrl)) {{
          scheduleScan(VIEWER_POLL_MS);
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
        if (scanned.size === previousCount) unchanged += 1;
        else unchanged = 0;
        previousCount = scanned.size;
        if (pending.length && awaitingSequence === 0) {{
          awaitingSequence = ++nextSequence;
          send({{kind:"photos",sequence:awaitingSequence,photos:pending.splice(0,1),title}});
        }}
        if (pending.length === 0 && awaitingSequence === 0) {{
          const nextPhotoUrl = findNextPhotoUrl();
          if (nextPhotoUrl === "clicked") {{
            navigatingFromId = currentPhoto.id;
            scheduleScan(VIEWER_POLL_MS);
            return;
          }}
          if (nextPhotoUrl) {{
            const nextId = new URL(nextPhotoUrl).searchParams.get("fbid") || "";
            if (nextId && scanned.has(nextId)) endConfirmed = true;
            else {{ location.replace(nextPhotoUrl); return; }}
          }}
          if (!nextPhotoUrl && unchanged >= 3 && Date.now() - lastRelevantMutationAt >= 2500)
            endConfirmed = true;
          if (endConfirmed && !countConflict && scanned.size >= 2
            && expectedCount > 0
            && (countSource !== "page-count" || scanned.size === expectedCount)
            && scanned.size >= expectedCount) {{
            if (countSource !== "page-count") {{
              expectedCount = scanned.size;
              countSource = "viewer-end";
            }}
            finished = true;
            send({{kind:"done",count:scanned.size,expectedCount,countSource,endConfirmed,countConflict,title}});
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
        pending.push({{id:photoId,url:selected.url,width:selected.width,alternates:selected.alternates}});
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
      endConfirmed = atBottom && !expanded && unchanged >= BOTTOM_PROBE_INTERVAL
        && Date.now() - lastRelevantMutationAt >= 2500;
      if (endConfirmed && !countConflict && pending.length === 0 && awaitingSequence === 0
        && scanned.size >= 2 && expectedCount > 0 && scanned.size >= expectedCount
        && (countSource !== "page-count" || scanned.size === expectedCount)) {{
        if (countSource !== "page-count") {{
          expectedCount = scanned.size;
          countSource = "grid-end";
        }}
        finished = true;
        send({{kind:"done",count:scanned.size,expectedCount,countSource,endConfirmed,countConflict,title}});
        return;
      }}
    }}
    if (awaitingSequence) scheduleScan(VIEWER_POLL_MS);
  }};
  const observe = () => {{
    const observer = new MutationObserver(() => {{
      lastRelevantMutationAt = Date.now();
      scheduleScan(100);
    }});
    observer.observe(document.body, {{childList:true,subtree:true,attributes:true,attributeFilter:["src","srcset","href","aria-label"]}});
    window.addEventListener("popstate", () => scheduleScan(100));
    window.addEventListener("hashchange", () => scheduleScan(100));
    window.addEventListener("load", () => scheduleScan(100), true);
    for (const name of ["pushState", "replaceState"]) {{
      const original = history[name];
      history[name] = function(...args) {{
        const result = original.apply(this, args);
        scheduleScan(100);
        return result;
      }};
    }}
    setInterval(() => scheduleScan(100), 1000);
    scheduleScan(100);
  }};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, {{once:true}});
  else observe();
}})();"#
    )
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
    }
}
