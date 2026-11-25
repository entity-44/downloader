import { RELAY_URL } from "./config";
import { UserError, type MediaItem, type Post } from "./types";

/** X / Twitter post links (x.com, twitter.com and common mirrors). */
export function parseXUrl(input: string): { id: string; canonicalUrl: string } | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!/^(?:(?:www|mobile)\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx)\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status(?:es)?\/(\d{1,25})/);
  return m ? { id: m[1], canonicalUrl: `https://x.com/i/status/${m[1]}` } : null;
}

type XVariant = { bitrate?: number; content_type?: string; url: string };
type XMedia = { type?: "photo" | "video" | "animated_gif"; media_url_https?: string; original_info?: { width?: number; height?: number }; video_info?: { variants?: XVariant[]; duration_millis?: number } };
type XTweet = { __typename?: string; id_str?: string; text?: string; created_at?: string; user?: { screen_name?: string }; mediaDetails?: XMedia[]; tombstone?: unknown };

const dims = (u: string) => {
  const m = u.match(/\/(\d{2,5})x(\d{2,5})\//);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {};
};

function photo(m: XMedia): MediaItem | null {
  if (!m.media_url_https) return null;
  const base = m.media_url_https.replace(/\?.*$/, "");
  return { kind: "IMAGE", url: `${base}?name=orig`, width: m.original_info?.width, height: m.original_info?.height, thumbUrl: `${base}?name=large` };
}

function video(m: XMedia): MediaItem | null {
  const mp4 = (m.video_info?.variants ?? []).filter((v) => v.content_type === "video/mp4" && v.url).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  if (!mp4.length) return null;
  const variants = mp4.map((v) => ({ url: v.url, ...dims(v.url) }));
  return {
    kind: "VIDEO",
    url: variants[0].url,
    width: variants[0].width ?? m.original_info?.width,
    height: variants[0].height ?? m.original_info?.height,
    thumbUrl: m.media_url_https,
    durationSec: m.video_info?.duration_millis ? m.video_info.duration_millis / 1000 : undefined,
    variants,
  };
}

export function parseTweet(json: unknown, sourceUrl: string): Post {
  const t = json as XTweet;
  if (!t || t.__typename === "TweetTombstone" || t.tombstone) throw new UserError("That post isn't available publicly (it may be deleted, private, or age-restricted).");
  const items = (t.mediaDetails ?? []).map((m) => (m.type === "photo" ? photo(m) : video(m))).filter((x): x is MediaItem => !!x);
  return {
    platform: "x",
    id: t.id_str ?? "post",
    url: t.user?.screen_name && t.id_str ? `https://x.com/${t.user.screen_name}/status/${t.id_str}` : sourceUrl,
    author: t.user?.screen_name,
    caption: t.text,
    takenAt: t.created_at ? new Date(t.created_at).toISOString() : undefined,
    items,
    notes: items.length ? undefined : ["This post has no photos or videos."],
  };
}

export async function fetchTweet(id: string, sourceUrl: string, fetcher: typeof fetch = fetch): Promise<Post> {
  const res = await fetcher(`${RELAY_URL}/tweet?id=${encodeURIComponent(id)}`, { credentials: "omit" });
  if (res.status === 404) throw new UserError("That post wasn't found. It may be deleted or from a private account.");
  if (!res.ok) throw new UserError("Couldn't reach X right now. Try again in a moment.");
  return parseTweet(await res.json(), sourceUrl);
}
