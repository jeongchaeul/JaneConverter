  const seenScripts = new WeakSet();
(() => {
  const nonce = __NONCE_JSON__;
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
  const MAX_PHOTOS = 10000;
  const MAX_ATTEMPTS = 1800;
  const MAX_CAPTURE_MS = 180000;
  const VIEWER_POLL_MS = 250;
  const BOTTOM_PROBE_INTERVAL = 4;
  const MAX_EXPANSION_CLICKS = 20;
  let lastPageTitle = document.title || "";
  window[ackKey] = 0;
  let scanned;
  try { scanned = new Set(JSON.parse(sessionStorage.getItem(scannedIdsKey) || "[]")); }
  catch (_) { scanned = new Set(); }
  let unchanged = 0;
  let previousCount = 0;
  let expectedCount = Number(sessionStorage.getItem(expectedCountKey)) || 0;
  let countSource = sessionStorage.getItem("janeFacebookCountSource") || "";
  let countConflict = sessionStorage.getItem("janeFacebookCountConflict") === "true";
  let attempts = Number(sessionStorage.getItem(attemptsKey)) || 0;
  let startedAt = Number(sessionStorage.getItem(startedAtKey)) || Date.now();
  sessionStorage.setItem(startedAtKey, String(startedAt));
  let lastPauseTick = 0;
  let lastViewerImageUrl = sessionStorage.getItem(viewerImageKey) || "";
  let navigatingFromId = "";
  let navigatingFromTicks = 0;
  let viewerInitAttempts = 0;
  let currentPageScannedId = "";
  const knownIdsKey = "janeFacebookKnownPhotoIds";
  const lastProgressKey = "janeFacebookLastProgressAt";
  let knownIds;
  try { knownIds = JSON.parse(sessionStorage.getItem(knownIdsKey) || "[]"); }
  catch (_) { knownIds = []; }
  const recordKnownId = (id) => {
    if (/^[0-9]{5,30}$/.test(id) && !knownIds.includes(id)) {
      knownIds.push(id);
      sessionStorage.setItem(knownIdsKey, JSON.stringify(knownIds));
    }
  };
  let lastProgressAt = Number(sessionStorage.getItem(lastProgressKey)) || Date.now();
  let expansionClicks = 0;
  let lastExpansionClickAttempt = 0;
  let finished = false;
  let pending = [];
  let nextSequence = 0;
  let awaitingSequence = 0;
  let endConfirmed = false;
  let lastRelevantMutationAt = Date.now();
  let scheduledScan = 0;
  const scheduleScan = (delay = 100) => {
    if (finished || scheduledScan) return;
    scheduledScan = setTimeout(() => { scheduledScan = 0; scan(); }, delay);
  };
  const send = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    document.title = prefix + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  };
  window[refreshFunctionKey] = (requestId, photoId) => {
    if (!/^[a-f0-9]{32}$/i.test(requestId || "") || !/^[0-9]{5,30}$/.test(photoId || "")) return false;
    const albumSet = sessionStorage.getItem(albumSetKey) || new URL(location.href).searchParams.get("set") || "";
    if (!albumSet.startsWith("pcb.")) return false;
    sessionStorage.setItem(pendingRefreshKey, JSON.stringify({requestId,photoId}));
    const target = new URL("/photo/", location.href);
    target.searchParams.set("fbid", photoId);
    target.searchParams.set("set", albumSet);
    location.replace(target.href);
    return true;
  };
  const readPageTitle = () => {
    const current = document.title || "";
    if (current && !current.startsWith(prefix)) lastPageTitle = current;
    return lastPageTitle;
  };
  const pageTitle = () => {
    const meta = document.querySelector('meta[property="og:title"]');
    return ((meta && meta.content) || readPageTitle() || "Facebook Post").slice(0, 200);
  };
  const photoCountFromText = (value, includeUnqualifiedCounts) => {
    let total = 0;
    if (includeUnqualifiedCounts) {
      for (const match of value.matchAll(/\b([\d,]{1,6})\s+(?:photos?|images?|pictures?)\b/gi)) {
        const count = Number(match[1].replace(/,/g, ""));
        if (count >= 2 && count <= MAX_PHOTOS) total = Math.max(total, count);
      }
    }
    for (const match of value.matchAll(/\b(?:photos?|images?|pictures?)\s+[\d,]{1,6}\s+(?:of|\/)\s*([\d,]{1,6})\b/gi)) {
      const count = Number(match[1].replace(/,/g, ""));
      if (count >= 2 && count <= MAX_PHOTOS) total = Math.max(total, count);
    }
    return total;
  };
  const discoverPostPhotoIds = () => {
    for (const anchor of document.querySelectorAll('a[href*="fbid="]')) {
      try {
        const href = new URL(anchor.href, location.href);
        const photoId = href.searchParams.get("fbid") || "";
        if (photoId) recordKnownId(photoId);
      } catch (_) {}
    }
    for (const script of document.scripts) {
      if (seenScripts.has(script)) continue;
      seenScripts.add(script);
      const text = script.textContent || "";
      if (!text.includes("fbid=") && !text.includes("nextMediaAfterNodeId") && !text.includes("all_subattachments")) continue;
      for (const match of text.matchAll(/photo\.php\?fbid=([0-9]{5,30})/g)) {
        recordKnownId(match[1]);
      }
      for (const match of text.matchAll(/"nextMediaAfterNodeId"\s*:\s*\{\s*"__typename"\s*:\s*"Photo"\s*,\s*"id"\s*:\s*"([0-9]{5,30})"/g)) {
        recordKnownId(match[1]);
      }
    }
  };
  const discoverExpectedPhotoCount = () => {
    discoverPostPhotoIds();
    const onAlbumPage = location.pathname.toLowerCase().includes("/media/set/");
    const sources = [
      {value: readPageTitle(), includeUnqualifiedCounts: !onAlbumPage},
      {value: document.querySelector('meta[property="og:title"]')?.content || "", includeUnqualifiedCounts: !onAlbumPage},
      {value: document.querySelector('meta[property="og:description"]')?.content || "", includeUnqualifiedCounts: !onAlbumPage}
    ];
    for (const heading of document.querySelectorAll('h1, h2, [role="heading"]')) {
      sources.push({value: heading.innerText || "", includeUnqualifiedCounts: !onAlbumPage});
    }
    for (const element of document.querySelectorAll("[aria-label], [title]")) {
      const label = [element.getAttribute("aria-label"), element.getAttribute("title")]
        .filter(Boolean).join(" ");
      if (/photo|image|picture/i.test(label)) sources.push({value: label, includeUnqualifiedCounts: false});
    }
    const exactCounts = new Set(sources.map((source) =>
      photoCountFromText(source.value, source.includeUnqualifiedCounts)
    ).filter(Boolean));
    const exact = exactCounts.size === 1 ? [...exactCounts][0] : 0;
    let lowerBound = 0;
    if (knownIds.length >= 2 && knownIds.length <= MAX_PHOTOS) {
      lowerBound = Math.max(lowerBound, knownIds.length);
    }
    const galleryLinks = Array.from(document.querySelectorAll('a[href*="fbid="][href*="set=pcb."], a[href*="fbid="][href*="set=gm."]'));
    if (galleryLinks.length === 4 || galleryLinks.length === 5) {
      const overlayText = (galleryLinks[galleryLinks.length - 1].innerText || "")
        .replace(/\s+/g, "").trim();
      const remaining = /^\+(\d{1,3})$/.exec(overlayText);
      if (remaining) lowerBound = galleryLinks.length + Number(remaining[1]) - 1;
    }
    if (!onAlbumPage && !location.pathname.toLowerCase().includes("/photo")) {
      for (const script of document.scripts) {
        const text = script.textContent || "";
        if (!text.includes("all_subattachments")) continue;
        const match = /"all_subattachments"\s*:\s*\{\s*"count"\s*:\s*(\d{1,3})/.exec(text);
        if (match) {
          const count = Number(match[1]);
          if (count >= 1 && count <= MAX_PHOTOS) lowerBound = Math.max(lowerBound, count);
        }
      }
    }
    return {count:Math.max(exact,lowerBound),source:exact ? "page-count" : lowerBound ? "overlay-minimum" : "",conflict:exactCounts.size > 1 || (exact > 0 && lowerBound > exact)};
  };
  const cleanFbUrl = (uri) => {
    if (!uri) return "";
    return uri.replace(/([?&])ctp=[^&]*(&)?/g, (m, p1, p2) => p1 === '&' && p2 ? '&' : (p1 === '?' && p2 ? '?' : '')).replace(/[?&]$/, "");
  };
  const isCdn = (value) => {
    try {
      const parsed = new URL(value, location.href);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      if (
        path.includes("/stickers/") ||
        path.includes("/reactions/") ||
        path.includes("emoji.php") ||
        path.includes("rsrc.php") ||
        path.includes("/sprites/") ||
        path.includes("1997-6")
      ) {
        return false;
      }
      return host.endsWith(".fbcdn.net") || host === "fbcdn.net" || host.endsWith(".fbsbx.com") || host === "fbsbx.com";
    } catch (_) { return false; }
  };
  const chooseImage = (image) => {
    if (image.closest('[role="toolbar"], [aria-label*="reaction" i], [aria-label*="sticker" i], form, footer')) {
      return null;
    }
    const candidates = [];
    for (const value of [image.currentSrc, image.src, image.getAttribute("data-src")]) {
      if (value && isCdn(value)) {
        const fullUrl = cleanFbUrl(value);
        candidates.push({url: fullUrl, width: image.naturalWidth || 0, raw: value});
      }
    }
    for (const entry of (image.getAttribute("srcset") || "").split(",")) {
      const parts = entry.trim().split(/\s+/);
      if (parts[0] && isCdn(parts[0])) {
        const fullUrl = cleanFbUrl(parts[0]);
        candidates.push({url: fullUrl, width: parseInt(parts[1] || "0", 10) || 0, raw: parts[0]});
      }
    }
    candidates.sort((a, b) => b.width - a.width);
    if (!candidates.length) return null;
    const allUrls = [];
    for (const c of candidates) {
      if (!allUrls.includes(c.url)) allUrls.push(c.url);
      if (c.raw && !allUrls.includes(c.raw)) allUrls.push(c.raw);
    }
    return {url: candidates[0].url, width: candidates[0].width, alternates: allUrls.filter((u) => u !== candidates[0].url).slice(0, 3)};
  };
  const hasVisiblePublicPhoto = () => {
    if (new URL(location.href).pathname.toLowerCase().includes("/photo"))
      return !!findCurrentViewerPhoto();
    return Array.from(document.querySelectorAll('a[href*="fbid="] img')).some((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width >= 80 && rect.height >= 80 && chooseImage(image);
    });
  };
  const hasVideoPost = () => {
    const root = document.querySelector('[role="article"], article, main') || document;
    const visibleVideo = Array.from(root.querySelectorAll('video')).some((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width >= 160 && rect.height >= 90
        && (video.currentSrc || video.readyState > 0 || video.poster);
    });
    return visibleVideo || !!document.querySelector('meta[property="og:video"], meta[property="og:video:url"]');
  };
  const closeGuestPrompt = () => {
    // Facebook also labels the photo viewer's close button "Close". Only
    // dismiss a dialog when its own text identifies it as an account prompt;
    // otherwise this can close the album before its photos are scanned.
    const prompt = Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) => {
      const text = dialog.innerText || "";
      const loginForm = dialog.querySelector('#login_popup_cta_form, form[action*="/login/"]');
      const hasLoginForm = !!loginForm || (dialog.querySelector('input[type="password"], input[name="pass"]')
        && dialog.querySelector('button[aria-label*="log in" i], button[type="submit"]'));
      const identifiesLogin = /log in to facebook|log in or sign up|sign up for facebook|see more on facebook/i.test(text)
        || (hasLoginForm && /see more from/i.test(text));
      const isViewer = dialog.querySelector('[aria-label="Photo Viewer"], [aria-label*="media viewer" i], a[href*="fbid="] img');
      return (identifiesLogin && hasLoginForm && hasVisiblePublicPhoto())
        || (identifiesLogin && !isViewer && /log in|sign up|create account|see more/i.test(text));
    });
    if (prompt) {
      const dismissBtn = Array.from(prompt.querySelectorAll('button, [role="button"], a')).find((el) => {
        const label = [el.getAttribute("aria-label"), el.getAttribute("title"), el.innerText].filter(Boolean).join(" ");
        return /^(?:close|not now|dismiss|cancel)$/i.test(label.trim());
      });
      if (dismissBtn) { try { dismissBtn.click(); } catch (_) {} }
      let overlay = prompt;
      for (let parent = prompt.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const rect = parent.getBoundingClientRect();
        const isFixed = getComputedStyle(parent).position === "fixed";
        const isAbsolute = getComputedStyle(parent).position === "absolute";
        if (parent.parentElement === document.body
          && parent.querySelectorAll('[role="dialog"]').length === 1
          && !parent.querySelector('[aria-label="Photo Viewer"], a[href*="fbid="]')) {
          overlay = parent;
          break;
        }
        if ((isFixed || isAbsolute)
          && rect.width >= window.innerWidth * 0.7
          && rect.height >= window.innerHeight * 0.7) {
          overlay = parent;
          break;
        }
      }
      overlay.remove();
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.position = "";
    }
  };
  const findAlbumSet = () => {
    const currentSet = new URL(location.href).searchParams.get("set") || "";
    if (currentSet.startsWith("pcb.")) return currentSet;
    for (const anchor of document.querySelectorAll('a[href*="fbid="]')) {
      try {
        const href = new URL(anchor.href, location.href);
        const set = href.searchParams.get("set");
        if (set && set.startsWith("pcb.")) return set;
      } catch (_) {}
    }
    return "";
  };
  const findPostAlbumSet = () => {
    const domSet = findAlbumSet();
    if (domSet) return domSet;
    for (const script of document.scripts) {
      const text = script.textContent || "";
      if (!text.includes("pcb.")) continue;
      const match = /(?:"mediaset_token"\s*:\s*"|[?&]set=)(pcb\.[0-9]{5,30})/.exec(text);
      if (match) return match[1];
    }
    const pathMatch = /\/(?:permalink|posts)\/([0-9]{5,30})/.exec(location.pathname);
    if (pathMatch) return "pcb." + pathMatch[1];
    const storyId = new URL(location.href).searchParams.get("story_fbid") || "";
    if (/^[0-9]{5,30}$/.test(storyId)) return "pcb." + storyId;
    return "";
  };
  const normalizeFacebookUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      const host = url.hostname.toLowerCase();
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return "";
      url.protocol = "https:";
      url.hostname = location.hostname.toLowerCase();
      url.hash = "";
      return url.href;
    } catch (_) { return ""; }
  };
  const findAlbumStartPhoto = () => {
    const pageSet = new URL(location.href).searchParams.get("set") || findPostAlbumSet() || "";
    for (const anchor of document.querySelectorAll('a[href*="fbid="]')) {
      try {
        const href = new URL(anchor.href, location.href);
        const photoId = href.searchParams.get("fbid") || "";
        const rawSet = href.searchParams.get("set") || "";
        const set = rawSet.startsWith("pcb.") ? rawSet : (pageSet.startsWith("pcb.") ? pageSet : rawSet);
        if (/^[0-9]{5,30}$/.test(photoId) && (set.startsWith("pcb.") || set.startsWith("gm.") || set.startsWith("a."))) {
          const normalized = normalizeFacebookUrl(href.href);
          if (normalized) {
            const photoUrl = new URL("/photo/", normalized);
            photoUrl.searchParams.set("fbid", photoId);
            if (set) photoUrl.searchParams.set("set", set);
            return {anchor, url:photoUrl.href, needsDirectNavigation: rawSet !== set};
          }
        }
      } catch (_) {}
    }
    if (pageSet.startsWith("pcb.")) {
      for (const script of document.scripts) {
        const text = script.textContent || "";
        if (!text.includes("fbid=") && !text.includes("all_subattachments")) continue;
        const hrefMatch = /photo\.php\?fbid=([0-9]{5,30})&(?:amp;)?set=((?:pcb|gm|a)\.[0-9]{5,30})/.exec(text);
        const subMatch = !hrefMatch && /"all_subattachments"\s*:\s*\{[\s\S]{0,1200}?"__typename"\s*:\s*"Photo"[\s\S]{0,1200}?"id"\s*:\s*"([0-9]{5,30})"/.exec(text);
        const photoId = hrefMatch ? hrefMatch[1] : (subMatch ? subMatch[1] : "");
        if (photoId) {
          const photoUrl = new URL("/photo/", location.href);
          photoUrl.searchParams.set("fbid", photoId);
          photoUrl.searchParams.set("set", pageSet);
          return {anchor: null, url: photoUrl.href, needsDirectNavigation: true};
        }
      }
      if (knownIds.length > 0) {
        const photoUrl = new URL("/photo/", location.href);
        photoUrl.searchParams.set("fbid", knownIds[0]);
        photoUrl.searchParams.set("set", pageSet);
        return {anchor: null, url: photoUrl.href, needsDirectNavigation: true};
      }
    }
    return "";
  };
  const findScriptViewerPhoto = (expectedId) => {
    if (!/^[0-9]{5,30}$/.test(expectedId || "")) return null;
    for (const script of document.scripts) {
      const text = script.textContent || "";
      if (!text.includes(expectedId)) continue;
      const idIdx = text.indexOf(`"id":"${expectedId}"`);
      if (idIdx === -1) continue;
      const window = text.slice(Math.max(0, idIdx - 200), Math.min(text.length, idIdx + 1500));
      const uriMatch = /"(?:viewer_image|image|photo_image)"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/.exec(window);
      const widthMatch = /"width"\s*:\s*(\d+)/.exec(window);
      if (uriMatch) {
        let decodedUrl = uriMatch[1].replace(/\\u0025/g, "%").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
        if (isCdn(decodedUrl)) {
          const fullUrl = cleanFbUrl(decodedUrl);
          const alts = fullUrl !== decodedUrl ? [decodedUrl] : [];
          return {id: expectedId, url: fullUrl, width: Number(widthMatch ? widthMatch[1] : "1080") || 1080, alternates: alts};
        }
      }
    }
    return null;
  };
  const findCurrentViewerPhoto = () => {
    const pageUrl = new URL(location.href);
    let photoId = pageUrl.searchParams.get("fbid") || pageUrl.searchParams.get("photo_id") || "";
    if (/^[0-9]{5,30}$/.test(photoId)) {
      const scriptPhoto = findScriptViewerPhoto(photoId);
      if (scriptPhoto) return scriptPhoto;
    }
    const preferredImages = Array.from(document.querySelectorAll('[data-visualcompletion="media-vc-image"], img[data-visualcompletion], [data-sigil*="photo-image"]'))
      .filter((image) => image.tagName === "IMG");
    const allImages = preferredImages.length ? preferredImages : Array.from(document.images);
    const candidates = allImages.map((image) => {
      const selected = chooseImage(image);
      const rect = image.getBoundingClientRect();
      return selected && image.complete && image.naturalWidth >= 200 && image.naturalHeight >= 200
        && rect.width >= 100 && rect.height >= 100
        ? {image, selected, area: rect.width * rect.height}
        : null;
    }).filter(Boolean).sort((left, right) => right.area - left.area);
    const candidate = candidates[0];
    if (!photoId && candidate) {
      const anchor = candidate.image.closest('a[href*="fbid="]');
      if (anchor) {
        try { photoId = new URL(anchor.href, location.href).searchParams.get("fbid") || ""; }
        catch (_) {}
      }
    }
    if (candidate && /^[0-9]{5,30}$/.test(photoId)) {
      return {id:photoId,url:candidate.selected.url,width:candidate.selected.width,alternates:candidate.selected.alternates};
    }
    return findScriptViewerPhoto(photoId);
  };
  // Dispatches a synthetic pointer activation lifecycle.
  // Meta's React event delegation ignores bare element.click() in webviews
  // unless preceded by pointerdown/pointerup events.
  const triggerClick = (element) => {
    if (!element) return false;
    try { element.focus(); } catch (_) {}
    try {
      const opts = {bubbles: true, cancelable: true, view: window};
      if (typeof PointerEvent !== "undefined") {
        element.dispatchEvent(new PointerEvent("pointerdown", opts));
        element.dispatchEvent(new PointerEvent("pointerup", opts));
      } else {
        element.dispatchEvent(new MouseEvent("mousedown", opts));
        element.dispatchEvent(new MouseEvent("mouseup", opts));
      }
      element.click();
      return true;
    } catch (_) {
      try { element.click(); return true; } catch (_) { return false; }
    }
  };
  // Dispatches keyboard carousel advancement (ArrowRight) to active document target.
  const triggerNextKey = () => {
    try {
      const init = {key: "ArrowRight", code: "ArrowRight", keyCode: 39, which: 39, bubbles: true, cancelable: true};
      const target = document.activeElement || document.body || document;
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
    } catch (_) {}
  };
  const findNextElement = () => {
    return Array.from(document.querySelectorAll('a[href], button, [role="button"]'))
      .find((element) => /next\s*(photo|image)?/i.test([
        element.getAttribute("aria-label"), element.getAttribute("title"), element.innerText
      ].filter(Boolean).join(" ")));
  };
  const findFallbackNextPhotoUrl = (currentId) => {
    const albumSet = sessionStorage.getItem(albumSetKey) || new URL(location.href).searchParams.get("set") || findPostAlbumSet();
    const nextUnscanned = knownIds.find((id) => id !== currentId && !scanned.has(id));
    if (nextUnscanned) {
      const nextUrl = new URL("/photo/", location.href);
      nextUrl.searchParams.set("fbid", nextUnscanned);
      if (albumSet) nextUrl.searchParams.set("set", albumSet);
      return nextUrl.href;
    }
    for (const script of document.scripts) {
      const text = script.textContent || "";
      if (!text.includes("nextMediaAfterNodeId")) continue;
      const match = /"nextMediaAfterNodeId"\s*:\s*\{\s*"__typename"\s*:\s*"Photo"\s*,\s*"id"\s*:\s*"([0-9]{5,30})"/.exec(text);
      if (match && match[1] && match[1] !== currentId && !scanned.has(match[1])) {
        const nextUrl = new URL("/photo/", location.href);
        nextUrl.searchParams.set("fbid", match[1]);
        if (albumSet) nextUrl.searchParams.set("set", albumSet);
        return nextUrl.href;
      }
    }
    for (const anchor of document.querySelectorAll('a[href*="fbid="]')) {
      try {
        const href = new URL(anchor.href, location.href);
        const id = href.searchParams.get("fbid") || "";
        if (/^[0-9]{5,30}$/.test(id) && id !== currentId && !scanned.has(id)) {
          const nextUrl = new URL("/photo/", location.href);
          nextUrl.searchParams.set("fbid", id);
          if (albumSet) nextUrl.searchParams.set("set", albumSet);
          return nextUrl.href;
        }
      } catch (_) {}
    }
    return "";
  };
  const findNextPhotoUrl = () => {
    const hasPhotosFrom = Array.from(document.querySelectorAll("a"))
      .some((anchor) => (anchor.innerText || "").includes("Photos from"));
    const preferredToken = hasPhotosFrom ? "+=" : "+>";
    const currentId = new URL(location.href).searchParams.get("fbid") || "";
    const arrows = Array.from(document.querySelectorAll('a.touchable[data-gt], a[data-gt]'))
      .map((anchor) => {
        try { return {anchor, direction:JSON.parse(anchor.getAttribute("data-gt") || "{}").tn || ""}; }
        catch (_) { return {anchor, direction:""}; }
      })
      .filter((entry) => entry.direction === "+>" || entry.direction === "+=");
    const ordered = arrows.sort((left, right) =>
      Number(right.direction === preferredToken) - Number(left.direction === preferredToken)
    );
    for (const entry of ordered) {
      const target = normalizeFacebookUrl(entry.anchor.href);
      if (!target || target === normalizeFacebookUrl(location.href)) continue;
      try {
        const targetUrl = new URL(target);
        if (targetUrl.searchParams.has("fbid") && targetUrl.searchParams.get("fbid") !== currentId) return target;
      } catch (_) {}
    }
    const labelledNext = findNextElement();
    if (labelledNext?.href) return normalizeFacebookUrl(labelledNext.href);
    if (labelledNext) {
      triggerClick(labelledNext);
      return "clicked";
    }
    triggerNextKey();
    const fallbackNext = findFallbackNextPhotoUrl(currentId);
    if (fallbackNext) return fallbackNext;
    if (/^[0-9]{5,30}$/.test(currentId)) {
      const albumSet = sessionStorage.getItem(albumSetKey) || new URL(location.href).searchParams.get("set") || findPostAlbumSet();
      for (const script of document.scripts) {
        const text = script.textContent || "";
        if (!text.includes("nextMediaAfterNodeId")) continue;
        const match = /"nextMediaAfterNodeId"\s*:\s*\{\s*"__typename"\s*:\s*"Photo"\s*,\s*"id"\s*:\s*"([0-9]{5,30})"/.exec(text);
        if (match && match[1] && match[1] !== currentId) {
          const nextUrl = new URL("/photo/", location.href);
          nextUrl.searchParams.set("fbid", match[1]);
          if (albumSet) nextUrl.searchParams.set("set", albumSet);
          return nextUrl.href;
        }
      }
    }
    return "";
  };
  const findAlbumScroller = () => {
    const candidates = Array.from(document.querySelectorAll("div"))
      .filter((element) => element.querySelector('a[href*="fbid="]'))
      .filter((element) => {
        const overflowY = getComputedStyle(element).overflowY;
        return element.clientHeight > 0
          && element.scrollHeight > element.clientHeight + 80
          && (overflowY === "auto" || overflowY === "scroll");
      });
    candidates.sort((left, right) =>
      (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight)
    );
    return candidates[0] || document.scrollingElement || document.documentElement;
  };
  const clickPhotoExpansionControl = () => {
    if (expansionClicks >= MAX_EXPANSION_CLICKS
      || attempts - lastExpansionClickAttempt < BOTTOM_PROBE_INTERVAL * 2) return false;
    const controls = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const control = controls.find((element) => {
      const label = [element.getAttribute("aria-label"), element.getAttribute("title"), element.innerText]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      const namesPhotos = /photo|image|picture/i.test(label);
      const offersMore = /(?:see|view|show|load)\b.*\b(?:more|all|photos?|images?|pictures?)\b|\b(?:more|all)\s+(?:photos?|images?|pictures?)\b/i.test(label);
      const rect = element.getBoundingClientRect();
      return namesPhotos && offersMore && rect.width > 0 && rect.height > 0 && !element.disabled;
    });
    if (!control) return false;
    control.click();
    expansionClicks += 1;
    lastExpansionClickAttempt = attempts;
    return true;
  };
  const scan = () => {
    if (window.__JANE_CAPTURE_PAUSED__) {
      const now = Date.now();
      if (lastPauseTick > 0) {
        startedAt += Math.max(0, now - lastPauseTick);
        sessionStorage.setItem(startedAtKey, String(startedAt));
      }
      lastPauseTick = now;
      scheduleScan(VIEWER_POLL_MS);
      return;
    }
    lastPauseTick = 0;
    const refreshText = sessionStorage.getItem(pendingRefreshKey) || "";
    if (refreshText) {
      let refresh = null;
      try { refresh = JSON.parse(refreshText); } catch (_) {}
      if (!refresh || !/^[a-f0-9]{32}$/i.test(refresh.requestId || "")
        || !/^[0-9]{5,30}$/.test(refresh.photoId || "")) {
        sessionStorage.removeItem(pendingRefreshKey);
        return;
      }
      const page = new URL(location.href);
      if (!page.pathname.toLowerCase().includes("/photo")
        || page.searchParams.get("fbid") !== refresh.photoId) {
        const albumSet = sessionStorage.getItem(albumSetKey) || page.searchParams.get("set") || "";
        if (!albumSet.startsWith("pcb.")) {
          sessionStorage.removeItem(pendingRefreshKey);
          send({kind:"refresh",requestId:refresh.requestId,photos:[]});
          return;
        }
        const target = new URL("/photo/", location.href);
        target.searchParams.set("fbid", refresh.photoId);
        target.searchParams.set("set", albumSet);
        location.replace(target.href);
        return;
      }
      const refreshedPhoto = findCurrentViewerPhoto();
      if (refreshedPhoto && refreshedPhoto.id === refresh.photoId) {
        sessionStorage.removeItem(pendingRefreshKey);
        finished = true;
        send({kind:"refresh",requestId:refresh.requestId,photos:[refreshedPhoto]});
        return;
      }
      scheduleScan(VIEWER_POLL_MS);
      return;
    }
    if (finished) return;
    attempts += 1;
    sessionStorage.setItem(attemptsKey, String(attempts));
    if (awaitingSequence && window[ackKey] === awaitingSequence) awaitingSequence = 0;
    closeGuestPrompt();
    let captureMode = sessionStorage.getItem(captureModeKey) || "";
    if (captureMode !== "viewer" || !expectedCount) {
      const evidence = discoverExpectedPhotoCount();
      if (evidence.conflict || (countSource === "page-count" && evidence.source === "page-count" && expectedCount && evidence.count !== expectedCount)) countConflict = true;
      if (evidence.count > expectedCount || (evidence.source === "page-count" && countSource !== "page-count")) {
        expectedCount = evidence.count;
        countSource = evidence.source;
      }
      sessionStorage.setItem("janeFacebookCountConflict", String(countConflict));
      sessionStorage.setItem("janeFacebookCountSource", countSource);
    }
    if (expectedCount) sessionStorage.setItem(expectedCountKey, String(expectedCount));
    if (Date.now() - startedAt >= MAX_CAPTURE_MS
      || (Date.now() - lastProgressAt >= 40000 && attempts >= 40)
      || (captureMode !== "viewer" && attempts >= MAX_ATTEMPTS)) {
      finished = true;
      const error = expectedCount > scanned.size
        ? `Facebook exposed only ${scanned.size} of ${expectedCount} public album photos before the capture timed out. No partial album was saved.`
        : `Facebook did not confirm the public album was complete after finding ${scanned.size} photos. No partial album was saved.`;
      send({kind:"error",error});
      return;
    }
    if (scanned.size > MAX_PHOTOS) {
      finished = true;
      send({kind:"error",error:`Facebook exposed more than the ${MAX_PHOTOS}-photo capture limit. No partial album was saved.`});
      return;
    }
    if (location.pathname.toLowerCase().includes("/login")) {
      const albumSet = sessionStorage.getItem(albumSetKey) || "";
      if (captureMode === "viewer" && albumSet.startsWith("pcb.")) {
        const albumUrl = new URL("/media/set/", location.href);
        albumUrl.searchParams.set("set", albumSet);
        sessionStorage.setItem(captureModeKey, "grid");
        sessionStorage.setItem(attemptsKey, "0");
        location.replace(albumUrl.href);
        return;
      }
      finished = true;
      send({kind:"error",error:"Facebook redirected the post or photo viewer to a sign-in page before JaneConverter could reach its public photos."});
      return;
    }
    const onAlbumPage = location.pathname.toLowerCase().includes("/media/set/");
    if (captureMode === "") {
      sessionStorage.setItem("janeFacebookCaptureTitle", pageTitle());
      const startPhoto = findAlbumStartPhoto();
      if (startPhoto && (startPhoto.needsDirectNavigation || hasVisiblePublicPhoto())) {
        const photoUrl = new URL(startPhoto.url);
        const albumSet = photoUrl.searchParams.get("set") || "";
        if (albumSet.startsWith("pcb.")) sessionStorage.setItem(albumSetKey, albumSet);
        sessionStorage.setItem(captureModeKey, "viewer");
        sessionStorage.setItem(scannedIdsKey, JSON.stringify(Array.from(scanned)));
        if (expectedCount) sessionStorage.setItem(expectedCountKey, String(expectedCount));
        if (startPhoto.needsDirectNavigation || !startPhoto.anchor) {
          location.replace(startPhoto.url);
          return;
        }
        startPhoto.anchor.click();
        scheduleScan(VIEWER_POLL_MS);
        return;
      }
      if (!onAlbumPage) {
        const set = findAlbumSet();
        if (set) {
          sessionStorage.setItem(albumSetKey, set);
          if (expectedCount) sessionStorage.setItem(expectedCountKey, String(expectedCount));
          sessionStorage.setItem(captureModeKey, "grid");
          const albumUrl = new URL("/media/set/", location.href);
          albumUrl.searchParams.set("set", set);
          location.replace(albumUrl.href);
          return;
        }
      }
      if (attempts >= 3 && !startPhoto && !findPostAlbumSet() && hasVideoPost()) {
        finished = true;
        send({kind:"video",title:pageTitle()});
        return;
      }
    }
    if (captureMode === "viewer") {
      if (!location.pathname.toLowerCase().includes("/photo")) {
        viewerInitAttempts += 1;
        const startPhoto = findAlbumStartPhoto();
        if (startPhoto && (startPhoto.needsDirectNavigation || hasVisiblePublicPhoto())) {
          if (viewerInitAttempts >= 2 || startPhoto.needsDirectNavigation || !startPhoto.anchor) {
            location.replace(startPhoto.url);
            return;
          }
          startPhoto.anchor.click();
        }
        scheduleScan(VIEWER_POLL_MS);
        return;
      }
      viewerInitAttempts = 0;
      const savedTitle = sessionStorage.getItem("janeFacebookCaptureTitle");
      const title = savedTitle || pageTitle() || "Facebook Photo Album";
      const currentPhoto = findCurrentViewerPhoto();
      if (currentPhoto) {
        if (navigatingFromId === currentPhoto.id) {
          navigatingFromTicks += 1;
          if (navigatingFromTicks >= 2 && navigatingFromTicks < 6) {
            const nextEl = findNextElement();
            if (nextEl) {
              triggerClick(nextEl);
            } else {
              triggerNextKey();
            }
          }
          if (navigatingFromTicks >= 6) {
            navigatingFromId = "";
            navigatingFromTicks = 0;
            const fallbackUrl = findFallbackNextPhotoUrl(currentPhoto.id);
            if (fallbackUrl && fallbackUrl !== location.href) {
              location.replace(fallbackUrl);
              return;
            }
          } else {
            scheduleScan(VIEWER_POLL_MS);
            return;
          }
        } else {
          navigatingFromTicks = 0;
        }
        if (!scanned.has(currentPhoto.id) && currentPhoto.url === lastViewerImageUrl) {
          scheduleScan(VIEWER_POLL_MS);
          return;
        }
        const isNewPhotoForPage = currentPageScannedId !== currentPhoto.id;
        const wrappedAround = isNewPhotoForPage && scanned.has(currentPhoto.id);
        navigatingFromId = "";
        navigatingFromTicks = 0;
        if (!wrappedAround && isNewPhotoForPage) {
          currentPageScannedId = currentPhoto.id;
          scanned.add(currentPhoto.id);
          sessionStorage.setItem(scannedIdsKey, JSON.stringify(Array.from(scanned)));
          lastViewerImageUrl = currentPhoto.url;
          sessionStorage.setItem(viewerImageKey, lastViewerImageUrl);
          lastProgressAt = Date.now();
          sessionStorage.setItem(lastProgressKey, String(lastProgressAt));
          pending.push(currentPhoto);
        }
        if (scanned.size === previousCount) unchanged += 1;
        else {
          unchanged = 0;
          lastProgressAt = Date.now();
          sessionStorage.setItem(lastProgressKey, String(lastProgressAt));
        }
        previousCount = scanned.size;
        if (pending.length && awaitingSequence === 0) {
          awaitingSequence = ++nextSequence;
          send({kind:"photos",sequence:awaitingSequence,photos:pending.splice(0,1),title});
        }
        if (pending.length === 0 && awaitingSequence === 0) {
          if (wrappedAround && scanned.size >= 1) {
            endConfirmed = true;
          } else {
            const nextPhotoUrl = findNextPhotoUrl();
            if (nextPhotoUrl === "clicked") {
              navigatingFromId = currentPhoto.id;
              navigatingFromTicks = 0;
              currentPageScannedId = "";
              scheduleScan(VIEWER_POLL_MS);
              return;
            }
            if (nextPhotoUrl) {
              const nextId = new URL(nextPhotoUrl).searchParams.get("fbid") || "";
              if (nextId && scanned.has(nextId)) endConfirmed = true;
              else { location.replace(nextPhotoUrl); return; }
            }
            if (!nextPhotoUrl) {
              const fallbackUrl = findFallbackNextPhotoUrl(currentPhoto.id);
              if (fallbackUrl && fallbackUrl !== location.href) {
                location.replace(fallbackUrl);
                return;
              }
              const albumSet = sessionStorage.getItem(albumSetKey) || "";
              if (expectedCount > scanned.size && unchanged >= 6 && albumSet.startsWith("pcb.")) {
                sessionStorage.setItem(captureModeKey, "grid");
                sessionStorage.setItem(attemptsKey, "0");
                const albumUrl = new URL("/media/set/", location.href);
                albumUrl.searchParams.set("set", albumSet);
                location.replace(albumUrl.href);
                return;
              }
              if (unchanged >= 3 && Date.now() - lastRelevantMutationAt >= 2500)
                endConfirmed = true;
            }
          }
          if (endConfirmed && !countConflict && scanned.size >= 1
            && (expectedCount === 0 || scanned.size >= expectedCount)
            && (countSource !== "page-count" || scanned.size === expectedCount)) {
            if (countSource !== "page-count") {
              expectedCount = scanned.size;
              countSource = "viewer-end";
            }
            finished = true;
            send({kind:"done",count:scanned.size,expectedCount,countSource,endConfirmed,countConflict,title});
            return;
          }
        }
      }
    } else if (onAlbumPage) {
      const savedTitle = sessionStorage.getItem("janeFacebookCaptureTitle");
      const albumTitle = pageTitle();
      const title = savedTitle || (albumTitle && albumTitle !== "Facebook" ? albumTitle : "Facebook Photo Album");
      for (const anchor of document.querySelectorAll('a[href*="fbid="]')) {
        let photoId = "";
        try { photoId = new URL(anchor.href, location.href).searchParams.get("fbid") || ""; } catch (_) {}
        if (!/^[0-9]{5,30}$/.test(photoId) || scanned.has(photoId)) continue;
        const image = anchor.querySelector("img");
        const selected = image && chooseImage(image);
        if (!selected) continue;
        scanned.add(photoId);
        pending.push({id:photoId,url:selected.url,width:selected.width,alternates:selected.alternates});
      }
      if (scanned.size) sessionStorage.setItem(scannedIdsKey, JSON.stringify(Array.from(scanned)));
      if (pending.length && awaitingSequence === 0) {
        awaitingSequence = ++nextSequence;
        send({kind:"photos",sequence:awaitingSequence,photos:pending.splice(0,2),title});
      }
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
      if (!atBottom) {
        const nextScrollTop = Math.min(scrollTop + Math.max(400, viewportHeight * 0.8), scrollHeight);
        if (isDocumentScroller) window.scrollTo(0, nextScrollTop);
        else scroller.scrollTop = nextScrollTop;
      } else if (!expanded && unchanged > 0 && unchanged % BOTTOM_PROBE_INTERVAL === 0) {
        const backoff = Math.min(240, Math.max(80, viewportHeight * 0.12));
        const bottom = Math.max(0, scrollHeight - viewportHeight);
        const probeTop = Math.max(0, Math.min(scrollTop, bottom) - backoff);
        if (isDocumentScroller) window.scrollTo(0, probeTop);
        else scroller.scrollTop = probeTop;
      }
      endConfirmed = atBottom && !expanded && unchanged >= BOTTOM_PROBE_INTERVAL
        && Date.now() - lastRelevantMutationAt >= 2500;
      if (endConfirmed && !countConflict && pending.length === 0 && awaitingSequence === 0
        && scanned.size >= 1 && (expectedCount === 0 || scanned.size >= expectedCount)
        && (countSource !== "page-count" || scanned.size === expectedCount)) {
        if (countSource !== "page-count") {
          expectedCount = scanned.size;
          countSource = "grid-end";
        }
        finished = true;
        send({kind:"done",count:scanned.size,expectedCount,countSource,endConfirmed,countConflict,title});
        return;
      }
    }
    if (awaitingSequence) scheduleScan(VIEWER_POLL_MS);
  };
  const observe = () => {
    const observer = new MutationObserver(() => {
      lastRelevantMutationAt = Date.now();
      scheduleScan(100);
    });
    observer.observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:["src","srcset","href","aria-label"]});
    window.addEventListener("popstate", () => scheduleScan(100));
    window.addEventListener("hashchange", () => scheduleScan(100));
    window.addEventListener("load", () => scheduleScan(100), true);
    for (const name of ["pushState", "replaceState"]) {
      const original = history[name];
      history[name] = function(...args) {
        const result = original.apply(this, args);
        scheduleScan(100);
        return result;
      };
    }
    setInterval(() => scheduleScan(100), 1000);
    scheduleScan(100);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe, {once:true});
  else observe();
})();