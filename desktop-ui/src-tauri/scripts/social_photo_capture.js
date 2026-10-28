(() => {
  const nonce = __NONCE_JSON__;
  const platform = __PLATFORM_JSON__;
  const targetUrl = __TARGET_URL_JSON__;
  const platformLabel = {instagram:"Instagram",twitter:"X/Twitter",tiktok:"TikTok",reddit:"Reddit",tumblr:"Tumblr",pinterest:"Pinterest"}[platform] || platform;
  const prefix = "__JANE_SOCIAL_PHOTO_CAPTURE__" + nonce + "__";
  const ackKey = "__JANE_SOCIAL_PHOTO_ACK__" + nonce;
  let currentAck = 0;
  const checkEarlyFinish = () => {
    if (!finished && expectedCount !== null && !countConflict && photos.size === expectedCount && !waiting && !pending.length) {
      finishPhotos(pageTitle());
      return true;
    }
    return false;
  };
  try {
    Object.defineProperty(window, ackKey, {
      get: () => currentAck,
      set: (val) => {
        currentAck = val;
        if (waiting && currentAck === waiting) {
          waiting = 0;
          inFlight = null;
          if (pending.length) {
            flush(pageTitle());
          } else {
            checkEarlyFinish();
          }
        }
      },
      configurable: true,
    });
  } catch (_) {
    window[ackKey] = 0;
  }
  const photos = new Map();
  const originalTitle = document.title;
  let expectedCount = null;
  let countConflict = false;
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
  const send = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    document.title = prefix + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  };
  const sendFinal = (value) => {
    finished = true;
    let retries = 0;
    const publish = () => {
      send({...value,retry:retries++});
      if (retries < 4) setTimeout(publish, 700);
    };
    publish();
  };
  const isCdn = (value) => {
    try {
      const parsed = new URL(value, location.href);
      const host = parsed.hostname.toLowerCase();
      const suffixes = {
        instagram: ["fbcdn.net", "fbsbx.com", "cdninstagram.com"],
        twitter: ["pbs.twimg.com"],
        tiktok: ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "ibyteimg.com", "ibytedtos.com"],
        reddit: ["redd.it", "redditmedia.com"],
        tumblr: ["media.tumblr.com"],
        pinterest: ["pinimg.com"]
      }[platform] || [];
      if (!suffixes.some(suffix => host === suffix || host.endsWith("." + suffix))) return false;
      if (platform === "instagram") {
        const lowerUrl = parsed.href.toLowerCase();
        if (host.startsWith("static.") || parsed.pathname.toLowerCase().includes("/rsrc.php")) return false;
        if (lowerUrl.includes("giphy.com") || lowerUrl.includes("/giphy") || parsed.pathname.toLowerCase().endsWith(".gif")) return false;
        if (/\/s(?:150x150|100x100|64x64|40x40|32x32)\b/i.test(lowerUrl)) return false;
      }
      return true;
    } catch (_) { return false; }
  };
  const isInstagramCommentOrChromeImage = (image, container) => {
    if (platform !== "instagram") return false;
    const alt = (image.getAttribute("alt") || "").trim();
    if (/profile picture|avatar|giphy|sticker/i.test(alt)) return true;
    for (let el = image.parentElement; el && el !== container && el !== document.body; el = el.parentElement) {
      if (el.tagName === "HEADER") return true;
      if (el.tagName === "UL" && el.querySelector('a[href*="/c/"]')) return true;
      const role = el.getAttribute("role") || "";
      if (role === "complementary") return true;
    }
    return false;
  };
  const chooseImage = (image) => {
    const candidates = [];
    const add = (url, width) => {
      if (url && isCdn(url)) {
        let effectiveWidth = Number(width) || 0;
        if (platform === "pinterest") {
          const match = /\/(\d+)x\//.exec(url);
          if (match) effectiveWidth = Math.max(effectiveWidth, Number(match[1]) || 0);
        }
        candidates.push({url, width: effectiveWidth});
      }
    };
    add(image.currentSrc, image.naturalWidth);
    add(image.src, image.naturalWidth);
    add(image.getAttribute("data-src"), image.naturalWidth);
    for (const entry of (image.getAttribute("srcset") || "").split(",")) {
      const parts = entry.trim().split(/\s+/);
      if (parts[0]) {
        const desc = parts[1] || "";
        let w = 0;
        if (desc.endsWith("w")) w = parseInt(desc, 10);
        else if (desc.endsWith("x")) w = Math.round(parseFloat(desc) * (image.naturalWidth || 236));
        else w = parseInt(desc, 10) || 0;
        add(parts[0], w);
      }
    }
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0] || null;
  };
  const isPostCandidateImage = (image, container) => {
    if (isInstagramCommentOrChromeImage(image, container)) return false;
    const rect = image.getBoundingClientRect();
    const minSize = platform === "instagram" ? 220 : 120;
    if (rect.width < minSize || rect.height < minSize) return false;
    return chooseImage(image);
  };
  const imageId = (value) => {
    try {
      const url = new URL(value, location.href);
      const name = url.pathname.split("/").filter(Boolean).pop() || "";
      return name.replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
    } catch (_) { return ""; }
  };
  const pageTitle = () => {
    const meta = document.querySelector('meta[property="og:title"]');
    const article = document.querySelector("article");
    const text = article && article.innerText ? article.innerText.slice(0, 140) : "";
    const fallback = {instagram:"Instagram Post",twitter:"X Post",tiktok:"TikTok Photo Post",reddit:"Reddit Gallery",tumblr:"Tumblr Photo Post",pinterest:"Pinterest Collection"}[platform];
    let candidate = ((meta && meta.content) || text || originalTitle || fallback).trim();
    if (platform === "pinterest" && candidate.toLowerCase() === "pinterest") {
      candidate = fallback;
    }
    return candidate.slice(0, 200);
  };
  const closeGuestPrompt = () => {
    // Social photo viewers use the same generic close label as account
    // prompts. Require login language and account controls before closing so
    // the scan cannot dismiss its own post viewer or carousel.
    const promptPatterns = {
      instagram: /log in to instagram|sign in to instagram|sign up for instagram/i,
      twitter: /log in to x|sign in to x|sign up for x/i,
      tiktok: /log in to tiktok|sign in to tiktok|sign up for tiktok/i,
      reddit: /log in to reddit|sign in to reddit|sign up for reddit/i,
      tumblr: /log in to tumblr|sign in to tumblr|sign up for tumblr/i,
      pinterest: /log in to pinterest|sign in to pinterest|sign up for pinterest/i
    };
    const promptPattern = promptPatterns[platform];
    const commonPromptPattern = /log in or sign up|sign in or sign up|log in to continue|sign in to continue|see more from|see more on/i;
    const prompt = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).find((dialog) => {
      const text = dialog.innerText || "";
      const hasLoginForm = !!dialog.querySelector('input[type="password"], input[name="password"], input[name="pass"], input[autocomplete="current-password"]');
      const hasAccountAction = Array.from(dialog.querySelectorAll('button, [role="button"]')).some((action) =>
        /log in|sign in|sign up|continue with/i.test((action.innerText || "") + " " + (action.getAttribute("aria-label") || ""))
      );
      const identifiesPrompt = (promptPattern && promptPattern.test(text)) || commonPromptPattern.test(text);
      return identifiesPrompt && (hasLoginForm || hasAccountAction);
    });
    if (prompt) {
      let overlay = prompt;
      for (let parent = prompt.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const rect = parent.getBoundingClientRect();
        if (getComputedStyle(parent).position === "fixed"
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
  const postContainer = () => {
    const articles = Array.from(document.querySelectorAll("article"));
    if (platform === "instagram") {
      const postId = location.pathname.match(/\/(?:p|reels?)\/([^/]+)\/?$/i)?.[1];
      const permalink = postId && Array.from(document.querySelectorAll("a[href]")).find(anchor => {
        try { return new URL(anchor.href, location.href).pathname.match(/\/(?:p|reels?)\/([^/]+)\/?$/i)?.[1] === postId; }
        catch (_) { return false; }
      });
      if (permalink) {
        for (let container = permalink.parentElement; container && container !== document.body && container.tagName !== "MAIN"; container = container.parentElement) {
          const hasPublicPostImage = Array.from(container.querySelectorAll("img")).some(image => !!isPostCandidateImage(image, container));
          if (hasPublicPostImage) return container;
        }
      }
      const legacyPost = articles[0] || document.querySelector('[role="dialog"]');
      if (legacyPost && Array.from(legacyPost.querySelectorAll("img, video")).some(media => {
        if (media.tagName === "VIDEO") {
          const rect = media.getBoundingClientRect();
          return rect.width >= 220 && rect.height >= 220;
        }
        return !!isPostCandidateImage(media, legacyPost);
      })) return legacyPost;
      if (permalink) {
        for (let container = permalink.parentElement; container && container !== document.body && container.tagName !== "MAIN"; container = container.parentElement) {
          const hasPublicPostVideo = Array.from(container.querySelectorAll("video")).some(video => {
            const rect = video.getBoundingClientRect();
            return rect.width >= 220 && rect.height >= 220;
          });
          if (hasPublicPostVideo) return container;
        }
      }
      return null;
    }
    if (platform === "pinterest") {
      const pinPath = location.pathname.toLowerCase();
      if (pinPath.startsWith("/pin/")) {
        const closeup = document.querySelector('[data-test-id="closeup-body"], [data-test-id="pin-closeup-image"], [data-test-id="visual-content-container"], [data-test-id="pin-closeup-container"], article');
        if (closeup) return closeup;
      }
      return document.querySelector('[data-test-id="board-pin-grid"], [data-test-id="pinGrid"], main') || document;
    }
    if (platform === "tiktok") {
      return document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="photo-post"], [data-e2e="browse-video"]')?.closest('article, [role="dialog"]')
        || document.querySelector('article, [role="dialog"], main') || document;
    }
    if (platform === "reddit") {
      return document.querySelector('shreddit-post[post-id], [data-testid="post-container"], article') || document.querySelector('main') || document;
    }
    if (platform === "tumblr") {
      return document.querySelector('article, .post, [data-testid="post"]') || document.querySelector('main') || document;
    }
    const statusId = location.pathname.match(/\/status\/(\d+)/i)?.[1];
    const matching = articles.find(article => !statusId || Array.from(article.querySelectorAll('a[href*="/status/"]')).some(link => link.href.includes("/status/" + statusId)));
    return matching || articles[0] || document.querySelector('[role="dialog"]') || document;
  };
  const hasVideoPost = () => {
    if (platform === "instagram" && /^\/(?:[^/]+\/)?reels?\//i.test(location.pathname)) return true;
    const container = postContainer();
    const visibleVideo = !!container && Array.from(container.querySelectorAll("video")).some((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width >= 100 && rect.height >= 100 && (video.currentSrc || video.src || video.readyState > 0 || video.poster);
    });
    const hasTwitterVideo = platform === "twitter" && !!(
      (container && container.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]'))
      || document.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]')
      || Array.from(document.querySelectorAll('img[src*="video_thumb"], img[src*="amplify_video_thumb"]')).length > 0
      || Array.from(document.querySelectorAll('a[href*="/video/"]')).length > 0
    );
    return visibleVideo || hasTwitterVideo || !!document.querySelector('meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player"]');
  };
  const collectPhotos = () => {
    const container = postContainer();
    if (!container) return;
    const images = Array.from(container.querySelectorAll("img"));
    const candidates = [];
    for (const image of images) {
      const selected = isPostCandidateImage(image, container);
      if (!selected) continue;
      const rect = image.getBoundingClientRect();
      candidates.push({image, selected, area: rect.width * rect.height, width: rect.width});
    }
    if (platform === "instagram" && candidates.length > 1) {
      const maxWidth = Math.max(...candidates.map(item => item.width));
      // Filter out smaller auxiliary thumbnails or comment stickers when the main post image is present
      const filtered = candidates.filter(item => item.width >= maxWidth * 0.65);
      candidates.length = 0;
      candidates.push(...filtered);
    }
    for (const {selected} of candidates) {
      const id = imageId(selected.url);
      if (!id) continue;
      const existing = photos.get(id);
      if (!existing || selected.width > existing.width) {
        const photo = {id, url:selected.url, width:selected.width};
        photos.set(id, photo);
        const pendingIndex = pending.findIndex(item => item.id === id);
        if (pendingIndex >= 0) pending[pendingIndex] = photo;
        else pending.push(photo);
      }
    }
  };
  const nextButton = () => {
    const container = postContainer();
    if (!container) return null;
    const nextLabelPattern = /^(next|next photo|next image|next slide|next image \(.*\)|go to next (photo|image|slide)|التالي|다음|次へ|下一步|下一张|下一張|siguiente|suivant|weiter|далее|avanti|próximo|ileri|berikutnya|tiếp|ถัดไป|הבא)$/i;
    return Array.from(container.querySelectorAll('button[aria-label], [role="button"][aria-label], button._afxw'))
      .find(button => button.classList.contains("_afxw") || nextLabelPattern.test((button.getAttribute("aria-label") || "").trim()));
  };
  const flush = (title) => {
    if (!pending.length || waiting) return false;
    const batch = pending.splice(0, 15);
    waiting = ++sequence;
    inFlight = {kind:"photos",sequence,photos:batch,title,platform};
    retryCount = 0;
    retryAfterAttempt = attempts + 3;
    send(inFlight);
    return true;
  };
  const observeCount = () => {
    const container = postContainer();
    if (!container) return;
    const counts = [];
    for (const node of container.querySelectorAll('[aria-setsize], [aria-label]')) {
      const size = Number(node.getAttribute("aria-setsize"));
      if (Number.isInteger(size) && size > 0 && size <= 500) counts.push(size);
      const label = node.getAttribute("aria-label") || "";
      const match = /(?:photo|image|slide)\s*\d+\s*(?:of|\/)\s*(\d+)/i.exec(label);
      if (match && Number(match[1]) > 0) counts.push(Number(match[1]));
    }
    // Read declarative media lists only when they identify this exact post.
    // A page-wide list of recommendations cannot certify this collection.
    const postPath = (value) => {
      if (!value || typeof value !== "string") return "";
      try { const url = new URL(value, location.href); return url.origin + url.pathname.replace(/\/$/, ""); } catch (_) { return ""; }
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const entries = Array.isArray(data) ? data : data["@graph"] || [data];
        for (const entry of entries) {
          if (!entry || postPath(entry.url || entry["@id"] || "") !== postPath(location.href)) continue;
          if (!["Article", "SocialMediaPosting", "ImageGallery", "ImageObject", "ItemList"].includes(entry["@type"])) continue;
          if (Array.isArray(entry.image) && entry.image.length) counts.push(entry.image.length);
          if (entry["@type"] === "ImageObject" && entry.contentUrl) counts.push(1);
          if (entry["@type"] === "ItemList" && Number.isInteger(entry.numberOfItems) && entry.numberOfItems > 0) counts.push(entry.numberOfItems);
        }
      } catch (_) {}
    }
    if (platform === "pinterest") {
      const isSinglePin = location.pathname.toLowerCase().startsWith("/pin/");
      if (isSinglePin) {
        if (!counts.length) counts.push(1);
      } else {
        const titleSources = [
          document.title,
          document.querySelector('meta[property="og:title"]')?.content,
          document.querySelector('meta[name="twitter:title"]')?.content,
        ];
        for (const candidate of titleSources) {
          if (!candidate) continue;
          const match = /(?:^|\b)(\d{1,3})\s+(?:ideas?|pins?)\b/i.exec(candidate);
          if (match) {
            const num = Number(match[1]);
            if (num > 0 && num <= 500) counts.push(num);
          }
        }
        for (const script of document.querySelectorAll('script:not([type="application/ld+json"])')) {
          const text = script.textContent || "";
          if (text.includes('"pin_count"')) {
            const m = /"pin_count":\s*(\d+)/.exec(text);
            if (m) {
              const num = Number(m[1]);
              if (num > 0 && num <= 500) counts.push(num);
            }
          }
        }
        for (const el of document.querySelectorAll('h1, h2, [role="heading"], [data-test-id*="count"], [data-test-id*="pin"]')) {
          const text = el.innerText || "";
          const m = /(?:^|\b)(\d{1,3})\s+(?:ideas?|pins?)\b/i.exec(text);
          if (m) {
            const num = Number(m[1]);
            if (num > 0 && num <= 500) counts.push(num);
          }
        }
      }
    }
    if (platform === "twitter" && !counts.length) {
      if (container.querySelector('div[aria-label="Image"]')) counts.push(1);
    }
    for (const count of counts) {
      if (expectedCount !== null && expectedCount !== count) countConflict = true;
      expectedCount = count;
    }
  };
  const finishPhotos = (title) => {
    const complete = !countConflict && expectedCount === photos.size;
    sendFinal({kind:"done",count:photos.size,title,platform,expectedCount,endConfirmed:complete,countConflict,
      completion:complete ? "complete" : expectedCount === null ? "unknown" : "incomplete"});
  };
  const scan = () => {
    if (finished) return;
    if (window.__JANE_CAPTURE_PAUSED__) {
      setTimeout(scan, 300);
      return;
    }
    attempts += 1;
    if (waiting && window[ackKey] === waiting) {
      waiting = 0;
      inFlight = null;
    } else if (waiting && inFlight && attempts >= retryAfterAttempt) {
      retryCount += 1;
      send({...inFlight,retry:retryCount});
      retryAfterAttempt = attempts + 3;
    }
    closeGuestPrompt();
    const path = location.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    const isRootOrFeed = path === "/" || path === "/home" || path === "/feed" || path === "/today" || path === "/explore";
    if (isRootOrFeed) {
      sendFinal({kind:"error",error:platformLabel + " redirected to the home feed. This post or collection is either private, requires sign-in, or was moved. Use Browser Capture with your active browser session."});
      return;
    }
    const loginPath = path.includes("/accounts/login")
      || path.includes("/i/flow/login")
      || path.includes("/challenge/")
      || path.includes("/checkpoint/")
      || path.includes("/login")
      || path.startsWith("/news_hub")
      || path.startsWith("/notifications");
    if (loginPath) {
      const isNotification = path.startsWith("/news_hub") || path.startsWith("/notifications");
      sendFinal({
        kind: "error",
        error: isNotification
          ? platformLabel + " notification collections require account sign-in. In Pinterest, use the Share button to copy a public share link, or use Browser Capture with your active browser session."
          : platformLabel + " requires sign-in to view this collection. JaneConverter only captures photos visible to logged-out visitors."
      });
      return;
    }
    collectPhotos();
    observeCount();
    const title = pageTitle();
    if (platform === "twitter" && hasVideoPost()) {
      sendFinal({kind:"video",count:0,title,platform});
      return;
    }
    if (!photos.size && !pending.length && attempts >= 3 && hasVideoPost()) {
      sendFinal({kind:"video",count:0,title,platform});
      return;
    }
    if (pending.length && !waiting) { flush(title); }
    if (checkEarlyFinish()) return;
    const currentCount = photos.size;
    if (currentCount === lastCount) unchanged = Math.min(unchanged + 1, 20);
    else unchanged = 0;
    lastCount = currentCount;
    if (["instagram", "tiktok", "reddit"].includes(platform) && photos.size < 500 && !waiting && !pending.length) {
      const next = nextButton();
      if (next && next.getAttribute("aria-disabled") !== "true" && !next.disabled) {
        next.click();
        unchanged = 0;
        setTimeout(scan, 500);
        return;
      }
    }
    const isPinterestBoard = platform === "pinterest" && !path.startsWith("/pin/");
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;
    if (isPinterestBoard && (expectedCount === null || photos.size < expectedCount) && photos.size < 500) {
      window.scrollTo(0, Math.min(window.scrollY + Math.max(400, window.innerHeight * 0.8), document.documentElement.scrollHeight));
    }
    const noPhotoWait = platform === "instagram" && !postContainer() ? 15 : isPinterestBoard ? 16 : 6;
    const settled = isPinterestBoard ? atBottom && unchanged >= 8 : unchanged >= 3;
    if (photos.size >= 500 && !waiting && !pending.length) {
      const capNextButton = nextButton();
      const hasMoreSlides = ["instagram", "tiktok", "reddit"].includes(platform)
        && capNextButton
        && capNextButton.getAttribute("aria-disabled") !== "true"
        && !capNextButton.disabled;
      if (hasMoreSlides || (isPinterestBoard && !(atBottom && unchanged >= 8))) {
        sendFinal({kind:"error",error:platformLabel + " collection exceeds the 500-photo capture limit; nothing was saved."});
      } else if (settled) {
        if (isPinterestBoard && atBottom && unchanged >= 8 && expectedCount === null) {
          expectedCount = photos.size;
        }
        finishPhotos(title);
      }
      if (finished) return;
    }
    if (attempts >= noPhotoWait && settled && !waiting && !pending.length) {
      if (platform === "twitter" && hasVideoPost()) sendFinal({kind:"video",count:0,title,platform});
      else if (photos.size) {
        if (isPinterestBoard && atBottom && unchanged >= 8 && expectedCount === null) {
          expectedCount = photos.size;
        }
        finishPhotos(title);
      }
      else if (hasVideoPost()) sendFinal({kind:"video",count:0,title,platform});
      else if (platform === "twitter") sendFinal({kind:"no_photos",count:0,title,platform});
      else sendFinal({kind:"error",error:"No public " + platformLabel + " photos were visible in this post."});
      return;
    }
    if (attempts >= 80) {
      sendFinal({kind:"error",error:platformLabel + " did not expose a complete public photo collection in time."});
      return;
    }
    setTimeout(scan, 450);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(scan, 350), {once:true});
  else setTimeout(scan, 350);
})();