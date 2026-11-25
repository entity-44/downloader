import { UserError, type MediaItem, type Post } from "./types";

const HOSTS = /^(?:(?:www|old|new|np|m|sh)\.)?reddit\.com$/i;

export type RedditLink =
  | { kind: "post"; id: string; canonicalUrl: string }
  | { kind: "vreddit"; videoId: string; canonicalUrl: string }
  | { kind: "share"; canonicalUrl: string };

export function isRedditHost(host: string) {
  return HOSTS.test(host) || /^(?:v\.|i\.)?redd\.it$/i.test(host);
}

export function parseRedditUrl(input: string): RedditLink | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const seg = url.pathname.split("/").filter(Boolean);
  if (host === "v.redd.it" && seg[0] && /^[a-z0-9]{5,20}$/i.test(seg[0])) {
    return { kind: "vreddit", videoId: seg[0], canonicalUrl: `https://v.redd.it/${seg[0]}` };
  }
  if (host === "redd.it" && seg[0] && /^[a-z0-9]{3,12}$/i.test(seg[0])) {
    return { kind: "post", id: seg[0].toLowerCase(), canonicalUrl: `https://www.reddit.com/comments/${seg[0].toLowerCase()}/` };
  }
  if (!HOSTS.test(host)) return null;
  const c = seg.indexOf("comments");
  if (c >= 0 && seg[c + 1] && /^[a-z0-9]{3,12}$/i.test(seg[c + 1])) {
    const id = seg[c + 1].toLowerCase();
    return { kind: "post", id, canonicalUrl: `https://www.reddit.com/comments/${id}/` };
  }
  if (seg[0] === "r" && seg[2] === "s" && seg[3]) return { kind: "share", canonicalUrl: url.toString() };
  return null;
}

const unescape = (s: string) => s.replace(/&amp;/g, "&");

type RVideo = { fallback_url?: string; dash_url?: string; hls_url?: string; has_audio?: boolean; width?: number; height?: number; duration?: number; is_gif?: boolean };
type RMeta = { status?: string; e?: string; m?: string; s?: { u?: string; gif?: string; mp4?: string; x?: number; y?: number } };
type RPost = {
  id: string;
  name?: string;
  title?: string;
  author?: string;
  subreddit?: string;
  permalink?: string;
  created_utc?: number;
  url?: string;
  url_overridden_by_dest?: string;
  post_hint?: string;
  is_video?: boolean;
  is_gallery?: boolean;
  domain?: string;
  selftext?: string;
  secure_media?: { reddit_video?: RVideo } | null;
  media?: { reddit_video?: RVideo } | null;
  preview?: { images?: Array<{ source?: { url: string; width: number; height: number }; variants?: { mp4?: { source?: { url: string } } } }>; reddit_video_preview?: RVideo };
  gallery_data?: { items?: Array<{ media_id: string; caption?: string }> };
  media_metadata?: Record<string, RMeta>;
  crosspost_parent_list?: RPost[];
  thumbnail?: string;
};

function videoItem(v: RVideo, thumbUrl?: string): MediaItem | null {
  if (!v.fallback_url) return null;
  const url = unescape(v.fallback_url).split("?")[0];
  return {
    kind: "VIDEO",
    url,
    width: v.width,
    height: v.height,
    durationSec: v.duration,
    thumbUrl,
    dashUrl: v.dash_url ? unescape(v.dash_url).split("?")[0] : undefined,
    hasAudio: v.has_audio !== false && !v.is_gif,
  };
}

function extFromMime(m?: string) {
  const t = (m ?? "image/jpg").split("/")[1] ?? "jpg";
  return t === "jpeg" ? "jpg" : t;
}

function postItems(p: RPost): { items: MediaItem[]; notes: string[] } {
  const notes: string[] = [];
  const previewThumb = p.preview?.images?.[0]?.source?.url ? unescape(p.preview.images[0].source.url) : undefined;
  const rv = p.secure_media?.reddit_video ?? p.media?.reddit_video;
  if (rv) {
    const v = videoItem(rv, previewThumb);
    return { items: v ? [v] : [], notes };
  }
  if (p.is_gallery && p.gallery_data?.items && p.media_metadata) {
    const items: MediaItem[] = [];
    for (const g of p.gallery_data.items) {
      const meta = p.media_metadata[g.media_id];
      if (!meta || meta.status === "failed") continue;
      if (meta.e === "AnimatedImage" && (meta.s?.mp4 || meta.s?.gif)) {
        const mp4 = meta.s.mp4 ? unescape(meta.s.mp4) : undefined;
        items.push(mp4 ? { kind: "VIDEO", url: mp4, width: meta.s.x, height: meta.s.y, hasAudio: false } : { kind: "IMAGE", url: unescape(meta.s.gif!), width: meta.s.x, height: meta.s.y });
      } else {
        items.push({ kind: "IMAGE", url: `https://i.redd.it/${g.media_id}.${extFromMime(meta.m)}`, width: meta.s?.x, height: meta.s?.y, thumbUrl: meta.s?.u ? unescape(meta.s.u) : undefined });
      }
    }
    return { items, notes };
  }
  const dest = unescape(p.url_overridden_by_dest ?? p.url ?? "");
  if (/^https:\/\/i\.redd\.it\//.test(dest) || /\.(jpe?g|png|webp)$/i.test(dest)) {
    if (/\.gif$/i.test(dest) && p.preview?.images?.[0]?.variants?.mp4?.source?.url) {
      return { items: [{ kind: "VIDEO", url: unescape(p.preview.images[0].variants.mp4.source.url), hasAudio: false }], notes };
    }
    const src = p.preview?.images?.[0]?.source;
    return { items: [{ kind: "IMAGE", url: dest, width: src?.width, height: src?.height, thumbUrl: previewThumb }], notes };
  }
  if (p.preview?.reddit_video_preview?.fallback_url) {
    const v = videoItem({ ...p.preview.reddit_video_preview, has_audio: false }, previewThumb);
    if (v) return { items: [v], notes: [`Converted preview of an external video (${p.domain}).`] };
  }
  if (dest && !dest.includes("reddit.com")) notes.push(`This post links to an external site (${p.domain ?? new URL(dest).hostname}), which isn't supported.`);
  else notes.push("This post has no images or videos.");
  return { items: [], notes };
}

function findPost(json: unknown): RPost | undefined {
  // /comments/{id}.json → [listing, comments]; /api/info → listing
  const listings = Array.isArray(json) ? json : [json];
  for (const l of listings) {
    const child = (l as { data?: { children?: Array<{ kind?: string; data?: RPost }> } })?.data?.children?.find((c) => c.kind === "t3");
    if (child?.data) return child.data;
  }
  return undefined;
}

export function parseRedditJson(json: unknown): Post {
  const post = findPost(json);
  if (!post) throw new UserError("Couldn't find a Reddit post in that data.");
  const source = post.crosspost_parent_list?.[0] ?? post;
  let { items, notes } = postItems(source);
  if (!items.length && source !== post) ({ items, notes } = postItems(post));
  return {
    platform: "reddit",
    id: post.id,
    url: post.permalink ? `https://www.reddit.com${post.permalink}` : `https://www.reddit.com/comments/${post.id}/`,
    author: post.author,
    title: post.title,
    caption: post.subreddit ? `r/${post.subreddit}` : undefined,
    takenAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
    items,
    notes: notes.length ? notes : undefined,
  };
}

// ---- DASH manifests (v.redd.it) ----

export type DashTracks = { videos: Array<{ url: string; height: number; bandwidth: number }>; audios: Array<{ url: string; bandwidth: number }> };

/** Minimal regex-based MPD parser (works in workers/tests without DOMParser). */
export function parseDashManifest(xml: string, manifestUrl: string): DashTracks {
  const base = manifestUrl.replace(/[^/]*$/, "");
  const out: DashTracks = { videos: [], audios: [] };
  const sets = xml.match(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g) ?? [];
  for (const set of sets) {
    const head = set.match(/<AdaptationSet[^>]*>/)?.[0] ?? "";
    const isAudio = /contentType="audio"|mimeType="audio\//.test(head) || (/mimeType="audio\//.test(set) && !/mimeType="video\//.test(set));
    for (const rep of set.match(/<Representation[\s\S]*?(?:<\/Representation>|\/>)/g) ?? []) {
      const baseUrl = rep.match(/<BaseURL>([^<]+)<\/BaseURL>/)?.[1]?.trim();
      if (!baseUrl) continue;
      const url = new URL(baseUrl.replace(/&amp;/g, "&"), base).toString();
      const bandwidth = Number(rep.match(/bandwidth="(\d+)"/)?.[1] ?? 0);
      const repAudio = isAudio || /mimeType="audio\//.test(rep);
      if (repAudio) out.audios.push({ url, bandwidth });
      else out.videos.push({ url, bandwidth, height: Number(rep.match(/height="(\d+)"/)?.[1] ?? 0) });
    }
  }
  out.videos.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  out.audios.sort((a, b) => b.bandwidth - a.bandwidth);
  return out;
}

/** Fetches a v.redd.it manifest (v.redd.it allows cross-origin reads). */
export async function resolveVreddit(videoId: string, fetcher: typeof fetch = fetch): Promise<Post> {
  const manifest = `https://v.redd.it/${videoId}/DASHPlaylist.mpd`;
  const res = await fetcher(manifest);
  if (!res.ok) throw new UserError(res.status === 403 || res.status === 404 ? "That Reddit video is unavailable or was removed." : `Reddit returned an error (${res.status}).`);
  const tracks = parseDashManifest(await res.text(), manifest);
  const v = tracks.videos[0];
  if (!v) throw new UserError("Couldn't find a video stream for that link.");
  return {
    platform: "reddit",
    id: videoId,
    url: `https://v.redd.it/${videoId}`,
    items: [{ kind: "VIDEO", url: v.url, height: v.height, dashUrl: manifest, hasAudio: tracks.audios.length > 0 }],
  };
}

// ---- Optional official API (installed-app client id, no secret) ----

export async function redditAppToken(clientId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const cached = sessionStorage.getItem("reddit_token");
  if (cached) {
    const { token, exp } = JSON.parse(cached) as { token: string; exp: number };
    if (exp > Date.now() + 60_000) return token;
  }
  let device = localStorage.getItem("reddit_device");
  if (!device) {
    device = crypto.randomUUID().replace(/-/g, "").slice(0, 30);
    localStorage.setItem("reddit_device", device);
  }
  const res = await fetcher("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${clientId}:`)}` },
    body: new URLSearchParams({ grant_type: "https://oauth.reddit.com/grants/installed_client", device_id: device }),
  });
  if (!res.ok) throw new UserError("Reddit rejected the client ID. Check it in Settings (it must be an “installed app”).");
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new UserError("Reddit didn't return an access token.");
  sessionStorage.setItem("reddit_token", JSON.stringify({ token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }));
  return j.access_token;
}

export async function fetchRedditPost(id: string, clientId: string, fetcher: typeof fetch = fetch): Promise<Post> {
  const token = await redditAppToken(clientId, fetcher);
  const res = await fetcher(`https://oauth.reddit.com/comments/${id}?raw_json=1&limit=1`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404 || res.status === 403) throw new UserError("That Reddit post is unavailable, private or removed.");
  if (!res.ok) throw new UserError(`Reddit returned an error (${res.status}).`);
  return parseRedditJson(await res.json());
}

/** Every resolution a Reddit video offers (audio is merged at download time). */
export async function redditVideoVariants(dashUrl: string, fetcher: typeof fetch = fetch): Promise<Array<{ url: string; height?: number }>> {
  const res = await fetcher(dashUrl, { credentials: "omit" });
  if (!res.ok) return [];
  return parseDashManifest(await res.text(), dashUrl).videos.map((v) => ({ url: v.url, height: v.height || undefined }));
}
