import { UserError, type MediaItem, type Post } from "./types";

type TikTokMeta = { id?: string; author?: string; desc?: string; createTime?: number | string; width?: number; height?: number; duration?: number; cover?: string; images?: string[] };

/**
 * TikTok data collected in the TikTok tab. Videos arrive already downloaded
 * (TikTok only serves the file to the visit that loaded the page); photo
 * slideshows arrive as image links.
 */
export function parseTikTok(raw: unknown, sourceUrl: string, video?: Blob): Post {
  const m = (raw ?? {}) as TikTokMeta;
  const items: MediaItem[] = [];
  if (video) {
    items.push({ kind: "VIDEO", url: "local:tiktok", blob: video, width: m.width, height: m.height, durationSec: m.duration, thumbUrl: m.cover, hasAudio: true });
  } else {
    for (const u of m.images ?? []) if (typeof u === "string" && /^https:\/\//.test(u)) items.push({ kind: "IMAGE", url: u });
  }
  if (!items.length) throw new UserError("Couldn't get this TikTok. Reload the TikTok page and try again.");
  const t = Number(m.createTime);
  return {
    platform: "tiktok",
    id: m.id ?? "video",
    url: m.author && m.id ? `https://www.tiktok.com/@${m.author}/video/${m.id}` : sourceUrl,
    author: m.author,
    caption: m.desc,
    takenAt: t ? new Date(t * 1000).toISOString() : undefined,
    items,
  };
}

export function isTikTokUrl(input: string): boolean {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    return /^(?:www\.|m\.|vm\.|vt\.)?tiktok\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}
