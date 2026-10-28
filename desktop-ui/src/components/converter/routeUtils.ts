import type { IntentPreset } from "../../options";

export type SocialPhotoPlatform = "instagram" | "twitter" | "tiktok" | "reddit" | "tumblr" | "pinterest";

export const SOCIAL_PHOTO_PLATFORM_LABELS: Record<SocialPhotoPlatform, string> = {
  instagram: "Instagram",
  twitter: "X/Twitter",
  tiktok: "TikTok",
  reddit: "Reddit",
  tumblr: "Tumblr",
  pinterest: "Pinterest",
};

export function socialPhotoPlatformLabel(platform: SocialPhotoPlatform): string {
  return SOCIAL_PHOTO_PLATFORM_LABELS[platform];
}

export function isEphemeralStoryUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const isIg = host === "instagram.com" || host.endsWith(".instagram.com");
    if (isIg && (path.includes("/stories/") || path.includes("/stories/highlights/"))) {
      return true;
    }
    const isFb = host === "facebook.com" || host.endsWith(".facebook.com");
    if (isFb && /^\/stories\/\d+/.test(path)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function groupIndexesByPreset(
  indexesStr: string,
  fallbackPreset: IntentPreset | undefined,
  itemOverrides?: Record<number, IntentPreset>
): Array<{ indexes: string; preset: IntentPreset | undefined }> {
  const idxList = indexesStr
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  if (idxList.length === 0) return [];

  if (!itemOverrides || Object.keys(itemOverrides).length === 0) {
    return [{ indexes: idxList.join(","), preset: fallbackPreset }];
  }

  const groups = new Map<string, { preset: IntentPreset | undefined; indexes: number[] }>();

  for (const idx of idxList) {
    const preset = itemOverrides[idx] ?? fallbackPreset;
    const key = preset ? preset.id : "current";
    if (!groups.has(key)) {
      groups.set(key, { preset, indexes: [] });
    }
    groups.get(key)!.indexes.push(idx);
  }

  return Array.from(groups.values()).map((g) => ({
    indexes: g.indexes.sort((a, b) => a - b).join(","),
    preset: g.preset,
  }));
}

export function isFacebookPostLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return (
      (host === "facebook.com" || host.endsWith(".facebook.com")) &&
      (path.startsWith("/share/p/") ||
        path.includes("/permalink/") ||
        path.includes("/posts/") ||
        path.endsWith("/story.php") ||
        path.includes("/photo") ||
        path.includes("/photos/") ||
        path.includes("/media/set"))
    );
  } catch {
    return false;
  }
}

export function isInstagramVideoRoute(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (!(host === "instagram.com" || host.endsWith(".instagram.com"))) return false;
    return /^\/(?:[^/]+\/)?reels?\/[^/]+\/?$/.test(path);
  } catch {
    return false;
  }
}

export function isPinterestNotificationRoute(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (!(host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it")) return false;
    const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    return (
      host === "pin.it" ||
      (segs.length >= 1 &&
        (segs[0] === "news_hub" ||
          segs[0] === "notifications" ||
          segs[0] === "multi-pin-share" ||
          segs[0] === "pin" ||
          (segs.length >= 2 && segs[1] === "pin")))
    );
  } catch {
    return false;
  }
}

export function socialPhotoPlatform(value: string): SocialPhotoPlatform | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (
      (host === "instagram.com" || host.endsWith(".instagram.com")) &&
      /^\/(?:(?!(?:accounts|explore|stories|direct|about|developer)\/)[^/]+\/)?(?:p|reels?)\/[^/]+\/?$/.test(path)
    )
      return "instagram";
    if (
      (host === "x.com" || host === "www.x.com" || host === "twitter.com" || host === "www.twitter.com") &&
      /\/status\/\d+/.test(path)
    )
      return "twitter";
    if (
      (host === "tiktok.com" || host.endsWith(".tiktok.com")) &&
      (/\/photo\/\d+/.test(path) || path.startsWith("/t/") || path.startsWith("/share/photo/"))
    )
      return "tiktok";
    if (
      (host === "reddit.com" || host.endsWith(".reddit.com")) &&
      (/\/comments\//.test(path) || path.startsWith("/gallery/"))
    )
      return "reddit";
    if (
      (host === "tumblr.com" || host.endsWith(".tumblr.com")) &&
      (/\/post\/\d+/.test(path) || /^\/[^/]+\/\d+/.test(path))
    )
      return "tumblr";
    if (host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it") {
      if (host === "pin.it" || path.startsWith("/pin/") || path.startsWith("/multi-pin-share/")) return "pinterest";
      const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
      if (
        segs.length >= 2 &&
        segs.length <= 3 &&
        !/^(?:search|ideas|explore|business|news_hub|notifications|settings|messages|edit|following|feed|today|login|signup|logout|about|resource|multi-pin-share)$/i.test(
          segs[0]
        )
      ) {
        return "pinterest";
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeDroppedPath(value: string): string {
  const clean = value.trim();
  if (!/^file:\/\//i.test(clean)) return clean;
  try {
    const url = new URL(clean);
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) return `\\\\${url.hostname}${pathname.replace(/\//g, "\\")}`;
    return pathname.replace(/^\/([a-z]:)/i, "$1").replace(/\//g, "\\");
  } catch {
    return clean.replace(/^file:\/\/\/?/i, "").replace(/\//g, "\\");
  }
}
