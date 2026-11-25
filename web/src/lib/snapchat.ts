import { RELAY_URL } from "./config";
import { deepFind } from "./instagram";
import { UserError, type MediaItem, type Post } from "./types";

export function parseSnapchatUrl(input: string): { url: string } | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!/^(?:www\.|story\.|t\.)?snapchat\.com$/i.test(url.hostname)) return null;
  url.protocol = "https:";
  return { url: url.toString() };
}

type LD = { "@type"?: string | string[]; contentUrl?: string; thumbnailUrl?: string | string[]; name?: string; uploadDate?: string; url?: string; creator?: { alternateName?: string; name?: string } };
type Snap = { snapUrls?: { mediaUrl?: string; mediaPreviewUrl?: { value?: string } | string }; snapMediaType?: number; timestampInSec?: { value?: string } };

const isType = (o: LD, t: string) => (Array.isArray(o["@type"]) ? o["@type"].includes(t) : o["@type"] === t);
const decode = (s?: string) => s?.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export function parseSnapchat(json: unknown, sourceUrl: string): Post {
  const j = (json ?? {}) as { url?: string; ld?: LD[]; og?: Record<string, string>; next?: unknown };
  const page = j.url ?? sourceUrl;
  const author = page.match(/snapchat\.com\/(?:@|add\/)([A-Za-z0-9._-]+)/)?.[1];
  const items: MediaItem[] = [];
  const videos = (j.ld ?? []).flatMap((x) => (Array.isArray(x) ? x : [x])).filter((x) => x && isType(x, "VideoObject") && x.contentUrl);
  const ogW = Number(j.og?.["video:width"]) || undefined;
  const ogH = Number(j.og?.["video:height"]) || undefined;
  for (const v of videos) {
    const thumb = Array.isArray(v.thumbnailUrl) ? v.thumbnailUrl[0] : v.thumbnailUrl;
    items.push({ kind: "VIDEO", url: v.contentUrl!, width: ogW, height: ogH, thumbUrl: thumb, hasAudio: true });
  }
  // Public story pages: a list of snaps in the page data.
  if (!items.length && j.next) {
    const list = deepFind(j.next, (o): o is Snap[] => Array.isArray(o) && o.length > 0 && o.every((s) => !!(s as Snap)?.snapUrls?.mediaUrl));
    for (const s of list ?? []) {
      const prev = s.snapUrls?.mediaPreviewUrl;
      items.push({ kind: s.snapMediaType === 1 ? "VIDEO" : "IMAGE", url: s.snapUrls!.mediaUrl!, thumbUrl: typeof prev === "string" ? prev : prev?.value, hasAudio: s.snapMediaType === 1 });
    }
  }
  if (!items.length && (j.og?.["video:secure_url"] || j.og?.video)) {
    items.push({ kind: "VIDEO", url: decode(j.og["video:secure_url"] ?? j.og.video)!, width: ogW, height: ogH, hasAudio: true });
  }
  if (!items.length) throw new UserError("Couldn't find a video or picture on that Snapchat page. Only public Spotlight and public Stories are supported.");
  const v = videos[0];
  return {
    platform: "snapchat",
    id: (page.match(/spotlight\/([A-Za-z0-9_-]{8,})/)?.[1] ?? "snap").slice(0, 40),
    url: page,
    author,
    title: decode(v?.name ?? j.og?.description),
    takenAt: v?.uploadDate,
    items,
  };
}

export async function fetchSnapchat(url: string, fetcher: typeof fetch = fetch): Promise<Post> {
  const res = await fetcher(`${RELAY_URL}/snapchat?url=${encodeURIComponent(url)}`, { credentials: "omit" });
  if (res.status === 404) throw new UserError("That Snapchat page wasn't found. It may be private or expired.");
  if (!res.ok) throw new UserError("Couldn't reach Snapchat right now. Try again in a moment.");
  return parseSnapchat(await res.json(), url);
}
