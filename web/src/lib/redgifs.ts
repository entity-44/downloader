import { RELAY_URL } from "./config";
import { UserError, type Post, type Variant } from "./types";

export function parseRedgifsUrl(input: string): { id: string; canonicalUrl: string } | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!/(^|\.)redgifs\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/(?:watch|ifr|i)\/([a-zA-Z]{3,80})/);
  return m ? { id: m[1].toLowerCase(), canonicalUrl: `https://www.redgifs.com/watch/${m[1].toLowerCase()}` } : null;
}

type RGif = { id?: string; urls?: { hd?: string; sd?: string; poster?: string; thumbnail?: string }; width?: number; height?: number; duration?: number; userName?: string; createDate?: number; description?: string; tags?: string[] };

export function parseRedgifs(json: unknown, sourceUrl: string): Post {
  const g = (json as { gif?: RGif })?.gif;
  if (!g?.urls?.hd && !g?.urls?.sd) throw new UserError("Couldn't find a video for that RedGIFs link.");
  const variants: Variant[] = [];
  if (g.urls.hd) variants.push({ url: g.urls.hd, width: g.width, height: g.height });
  if (g.urls.sd && g.urls.sd !== g.urls.hd) {
    const scale = g.width && g.height ? Math.min(1, 480 / Math.min(g.width, g.height)) : undefined;
    variants.push({ url: g.urls.sd, width: scale && g.width ? Math.round(g.width * scale) : undefined, height: scale && g.height ? Math.round(g.height * scale) : undefined });
  }
  return {
    platform: "redgifs",
    id: g.id ?? "gif",
    url: g.id ? `https://www.redgifs.com/watch/${g.id}` : sourceUrl,
    author: g.userName,
    caption: g.description || (g.tags?.length ? g.tags.slice(0, 8).join(", ") : undefined),
    takenAt: g.createDate ? new Date(g.createDate * 1000).toISOString() : undefined,
    items: [{ kind: "VIDEO", url: variants[0].url, width: g.width, height: g.height, durationSec: g.duration, thumbUrl: g.urls.poster ?? g.urls.thumbnail, hasAudio: true, variants }],
  };
}

export async function fetchRedgifs(id: string, sourceUrl: string, fetcher: typeof fetch = fetch): Promise<Post> {
  const res = await fetcher(`${RELAY_URL}/redgifs?id=${encodeURIComponent(id)}`, { credentials: "omit" });
  if (res.status === 404) throw new UserError("That RedGIFs video wasn't found. It may have been removed.");
  if (!res.ok) throw new UserError("Couldn't reach RedGIFs right now. Try again in a moment.");
  return parseRedgifs(await res.json(), sourceUrl);
}
