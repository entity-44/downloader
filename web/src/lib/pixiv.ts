import { RELAY_URL } from "./config";
import { UserError, type MediaItem, type Post, type Variant } from "./types";

export function parsePixivUrl(input: string): { id: string; canonicalUrl: string } | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!/^(?:www\.)?pixiv\.net$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/(?:[a-z]{2}\/)?(?:artworks|i)\/(\d{1,12})/) ?? (url.pathname.endsWith("member_illust.php") ? [null, url.searchParams.get("illust_id") ?? ""] : null);
  const id = m?.[1];
  return id && /^\d{1,12}$/.test(id) ? { id, canonicalUrl: `https://www.pixiv.net/artworks/${id}` } : null;
}

type PUrls = { original?: string; regular?: string; small?: string; thumb_mini?: string; mini?: string; thumb?: string };
type PIllust = { illustId?: string; id?: string; illustTitle?: string; title?: string; userName?: string; userAccount?: string; createDate?: string; uploadDate?: string; illustType?: number; pageCount?: number; width?: number; height?: number; urls?: PUrls; description?: string };
type PPage = { urls?: PUrls; width?: number; height?: number };
export type UgoiraFrame = { file: string; delay: number };
type PUgoira = { src?: string; originalSrc?: string; frames?: UgoiraFrame[]; mime_type?: string };

function imageItem(urls: PUrls | undefined, width?: number, height?: number): MediaItem | null {
  if (!urls?.original && !urls?.regular) return null;
  const variants: Variant[] = [];
  if (urls.original) variants.push({ url: urls.original, width, height, label: width && height ? `${width}×${height} · original` : "Original" });
  if (urls.regular) variants.push({ url: urls.regular, label: "Large (1200px)" });
  if (urls.small) variants.push({ url: urls.small, label: "Small (540px)" });
  return { kind: "IMAGE", url: variants[0].url, width, height, thumbUrl: urls.regular ?? urls.original, variants };
}

export function parsePixiv(json: unknown, sourceUrl: string): Post {
  const { illust, pages, ugoira } = (json ?? {}) as { illust?: PIllust; pages?: PPage[] | null; ugoira?: PUgoira | null };
  if (!illust) throw new UserError("Couldn't read that Pixiv work.");
  const id = illust.illustId ?? illust.id ?? "work";
  const items: MediaItem[] = [];
  if (illust.illustType === 2 && ugoira?.frames?.length && (ugoira.originalSrc || ugoira.src)) {
    const variants: Variant[] = [];
    if (ugoira.originalSrc) variants.push({ url: ugoira.originalSrc, width: illust.width, height: illust.height, label: `MP4 · original${illust.width ? ` (${illust.width}×${illust.height})` : ""}` });
    if (ugoira.src && ugoira.src !== ugoira.originalSrc) variants.push({ url: ugoira.src, label: "MP4 · 600px" });
    variants.push({ url: ugoira.originalSrc ?? ugoira.src!, label: "Original frames (ZIP)", raw: true });
    const totalMs = ugoira.frames.reduce((s, f) => s + (f.delay || 0), 0);
    items.push({
      kind: "VIDEO",
      url: variants[0].url,
      width: illust.width,
      height: illust.height,
      thumbUrl: illust.urls?.regular ?? illust.urls?.original,
      durationSec: totalMs ? totalMs / 1000 : undefined,
      hasAudio: false,
      ugoira: { frames: ugoira.frames },
      variants,
    });
  } else if (pages?.length) {
    for (const p of pages) {
      const it = imageItem(p.urls, p.width, p.height);
      if (it) items.push(it);
    }
  } else {
    const it = imageItem(illust.urls, illust.width, illust.height);
    if (it) items.push(it);
  }
  return {
    platform: "pixiv",
    id: String(id),
    url: `https://www.pixiv.net/artworks/${id}`,
    author: illust.userName,
    title: illust.illustTitle ?? illust.title,
    takenAt: illust.createDate ?? illust.uploadDate,
    items,
    notes: items.length ? undefined : ["This work has no downloadable images."],
  };
}

export async function fetchPixiv(id: string, sourceUrl: string, fetcher: typeof fetch = fetch): Promise<Post> {
  const res = await fetcher(`${RELAY_URL}/pixiv?id=${encodeURIComponent(id)}`, { credentials: "omit" });
  if (res.status === 404) throw new UserError("That Pixiv work wasn't found, or it needs a Pixiv login (for example, adults-only works). Those aren't supported yet.");
  if (!res.ok) throw new UserError("Couldn't reach Pixiv right now. Try again in a moment.");
  return parsePixiv(await res.json(), sourceUrl);
}
