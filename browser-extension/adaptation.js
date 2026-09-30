(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JaneStoryAdaptation = api;
}(typeof globalThis === "object" ? globalThis : this, function () {
  const VERSION = 1;
  const MAX_ENTRIES = 64;
  const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const STRATEGIES = ["session-fetch", "rendered", "direct-fetch", "page-fetch"];
  const VALID_KEY = /^[a-z0-9.-]+\|(image|video)\|-?\d+(?::-?\d+){3}\|\d+x\d+$/;

  function layoutKey(pageUrl, item) {
    if (!item || item.storyCandidate !== true || !/^-?\d+(?::-?\d+){3}$/.test(item.surface || "")) return null;
    try {
      const parsed = new URL(pageUrl);
      if (parsed.protocol !== "https:" || !/^[a-z0-9.-]+$/i.test(parsed.hostname)) return null;
      const kind = ["image", "video"].includes(item.mediaKind) ? item.mediaKind : null;
      if (!kind) return null;
      const width = Number(item.width || 0);
      const height = Number(item.height || 0);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return null;
      return [parsed.hostname.toLowerCase(), kind, item.surface,
        Math.min(64, Math.round(width / 128)) + "x" + Math.min(64, Math.round(height / 128))].join("|");
    } catch (_) {
      return null;
    }
  }

  function cleanStore(value, now) {
    const entries = value && value.version === VERSION && Array.isArray(value.entries) ? value.entries : [];
    return { version: VERSION, entries: entries.filter(function (entry) {
      return entry && typeof entry.key === "string"
        && VALID_KEY.test(entry.key)
        && STRATEGIES.includes(entry.strategy)
        && Number.isInteger(entry.successes) && entry.successes >= 0 && entry.successes <= 1000
        && Number.isInteger(entry.failures) && entry.failures >= 0 && entry.failures <= 1000
        && Number.isFinite(entry.updatedAt) && entry.updatedAt <= now
        && now - entry.updatedAt < MAX_AGE_MS;
    }).sort(function (left, right) { return right.updatedAt - left.updatedAt; }).slice(0, MAX_ENTRIES) };
  }

  function preferredStrategy(value, key, now) {
    if (!key) return null;
    const matches = cleanStore(value, now).entries.filter(function (entry) {
      return entry.key === key && entry.successes > entry.failures;
    });
    matches.sort(function (left, right) {
      return (right.successes - right.failures) - (left.successes - left.failures)
        || right.updatedAt - left.updatedAt;
    });
    return matches.length ? matches[0].strategy : null;
  }

  function recordOutcome(value, key, strategy, succeeded, now) {
    const store = cleanStore(value, now);
    if (!VALID_KEY.test(key || "") || !STRATEGIES.includes(strategy)) return store;
    let entry = store.entries.find(function (candidate) {
      return candidate.key === key && candidate.strategy === strategy;
    });
    if (!entry) {
      entry = { key: key, strategy: strategy, successes: 0, failures: 0, updatedAt: now };
      store.entries.push(entry);
    }
    if (succeeded) entry.successes = Math.min(1000, entry.successes + 1);
    else entry.failures = Math.min(1000, entry.failures + 1);
    entry.updatedAt = now;
    store.entries.sort(function (left, right) { return right.updatedAt - left.updatedAt; });
    store.entries.length = Math.min(store.entries.length, MAX_ENTRIES);
    return store;
  }

  return { cleanStore, layoutKey, preferredStrategy, recordOutcome };
}));
