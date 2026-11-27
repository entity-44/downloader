import { parseDashManifest } from "./reddit";
import { UserError, type MediaItem, type Post, type Variant } from "./types";

const HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export type IgLink = { kind: "post" | "reel" | "tv"; shortcode: string; canonicalUrl: string };

export function isInstagramHost(host: string) {
  return HOSTS.has(host.toLowerCase());
}

export function parseInstagramUrl(input: string): IgLink | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!isInstagramHost(url.hostname)) return null;
  const seg = url.pathname.split("/").filter(Boolean);
  const i = seg.findIndex((s, idx) => idx <= 1 && ["p", "reel", "reels", "tv"].includes(s.toLowerCase()));
  if (i < 0) return null;
  const code = seg[i + 1];
  if (!code || !/^[A-Za-z0-9_-]{5,64}$/.test(code)) return null;
  const t = seg[i].toLowerCase();
  const kind = t === "p" ? "post" : t === "tv" ? "tv" : "reel";
  return { kind, shortcode: code, canonicalUrl: `https://www.instagram.com/${kind === "post" ? "p" : kind}/${code}/` };
}

/** Instagram shortcodes are base64-encoded media ids (first 11 chars for private-post codes). */
export function shortcodeToMediaId(shortcode: string): string {
  let id = 0n;
  for (const ch of shortcode.slice(0, 11)) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new UserError("Invalid Instagram shortcode.");
    id = id * 64n + BigInt(v);
  }
  return id.toString();
}

export function mediaIdToShortcode(id: string): string {
  let n = BigInt(id);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 64n)] + out;
    n /= 64n;
  }
  return out;
}

type Candidate = { url: string; width?: number; height?: number };
const best = (c?: Candidate[]) => (c?.length ? [...c].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] : undefined);
/** Preview image: the full-resolution version, so previews stay sharp on high-density screens. */
const thumb = (c?: Candidate[]) => best(c)?.url;

// ---- v1 API shape (/api/v1/media/{id}/info/ and the post page's embedded data) ----
type V1Item = {
  pk?: string | number;
  id?: string;
  code?: string;
  media_type?: number;
  taken_at?: number;
  caption?: { text?: string } | null;
  user?: { username?: string };
  owner?: { username?: string };
  image_versions2?: { candidates?: Candidate[] };
  video_versions?: Candidate[];
  video_duration?: number;
  video_dash_manifest?: string;
  carousel_media?: V1Item[];
};

/** Every distinct size, largest first. */
function sizes(c?: Candidate[]): Variant[] {
  const seen = new Set<string>();
  return [...(c ?? [])]
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
    .filter((x) => {
      const k = `${x.width}x${x.height}`;
      if (!x.url || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((x) => ({ url: x.url, width: x.width, height: x.height }));
}

/**
 * Every video resolution: the ready-made files (with sound) plus the DASH
 * manifest's video-only tracks, which get the audio track merged in on download.
 * Largest first; for equal heights the ready-made file wins.
 */
function videoVariants(it: V1Item): Variant[] {
  const muxed = sizes(it.video_versions);
  let dash: Variant[] = [];
  if (typeof it.video_dash_manifest === "string" && it.video_dash_manifest.includes("<MPD")) {
    try {
      const t = parseDashManifest(it.video_dash_manifest, "https://scontent.cdninstagram.com/");
      const audio = t.audios[0]?.url;
      dash = t.videos.map((v) => ({ url: v.url, width: v.width, height: v.height || undefined, audioUrl: audio }));
    } catch {
      /* malformed manifest: ready-made files only */
    }
  }
  const byHeight = new Map<number, Variant>();
  for (const v of [...muxed, ...dash]) {
    const h = v.height ?? v.width ?? 0;
    if (!byHeight.has(h)) byHeight.set(h, v);
  }
  const all = [...byHeight.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
  // Drop entries without any size info when labelled sizes exist (they show up as a confusing "Original").
  const sized = all.filter((v) => v.width || v.height);
  return sized.length ? sized : all;
}

function v1Media(it: V1Item): MediaItem | null {
  const img = best(it.image_versions2?.candidates);
  const vid = best(it.video_versions);
  if (vid) return { kind: "VIDEO", url: vid.url, width: vid.width, height: vid.height, thumbUrl: thumb(it.image_versions2?.candidates), durationSec: it.video_duration, variants: videoVariants(it), thumbVariants: sizes(it.image_versions2?.candidates) };
  if (img) return { kind: "IMAGE", url: img.url, width: img.width, height: img.height, thumbUrl: thumb(it.image_versions2?.candidates), variants: sizes(it.image_versions2?.candidates) };
  return null;
}

function fromV1(it: V1Item, sourceUrl?: string): Post {
  const parts = it.carousel_media?.length ? it.carousel_media : [it];
  const items = parts.map(v1Media).filter((x): x is MediaItem => !!x);
  const code = it.code ?? (it.pk ? mediaIdToShortcode(String(it.pk).split("_")[0]) : undefined);
  return {
    platform: "instagram",
    id: code ?? String(it.pk ?? it.id ?? "post"),
    url: code ? `https://www.instagram.com/p/${code}/` : (sourceUrl ?? ""),
    author: it.user?.username ?? it.owner?.username,
    caption: it.caption?.text ?? undefined,
    takenAt: it.taken_at ? new Date(it.taken_at * 1000).toISOString() : undefined,
    items,
  };
}

// ---- GraphQL shape (shortcode_media) ----
type GqlNode = {
  __typename?: string;
  shortcode?: string;
  is_video?: boolean;
  display_url?: string;
  video_url?: string;
  dimensions?: { width?: number; height?: number };
  display_resources?: Array<{ src: string; config_width?: number }>;
  owner?: { username?: string };
  taken_at_timestamp?: number;
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
  edge_sidecar_to_children?: { edges?: Array<{ node: GqlNode }> };
  video_duration?: number;
};

function gqlMedia(n: GqlNode): MediaItem | null {
  const w = n.dimensions?.width;
  const h = n.dimensions?.height;
  const small = [...(n.display_resources ?? [])].sort((a, b) => (b.config_width ?? 0) - (a.config_width ?? 0))[0]?.src;
  if (n.is_video && n.video_url) return { kind: "VIDEO", url: n.video_url, width: w, height: h, thumbUrl: small ?? n.display_url, durationSec: n.video_duration };
  if (n.display_url) return { kind: "IMAGE", url: n.display_url, width: w, height: h, thumbUrl: small, variants: n.display_resources?.length ? sizes(n.display_resources.map((r) => ({ url: r.src, width: r.config_width, height: (r as { config_height?: number }).config_height }))) : undefined };
  return null;
}

function fromGql(n: GqlNode): Post {
  const parts = n.edge_sidecar_to_children?.edges?.map((e) => e.node) ?? [n];
  return {
    platform: "instagram",
    id: n.shortcode ?? "post",
    url: n.shortcode ? `https://www.instagram.com/p/${n.shortcode}/` : "",
    author: n.owner?.username,
    caption: n.edge_media_to_caption?.edges?.[0]?.node?.text,
    takenAt: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : undefined,
    items: parts.map(gqlMedia).filter((x): x is MediaItem => !!x),
  };
}

const isV1Item = (o: unknown): o is V1Item => {
  const x = o as V1Item;
  return !!x && typeof x === "object" && (!!x.image_versions2 || !!x.video_versions || !!x.carousel_media) && (x.code !== undefined || x.pk !== undefined);
};
const isGql = (o: unknown): o is GqlNode => {
  const x = o as GqlNode;
  return !!x && typeof x === "object" && typeof x.shortcode === "string" && (!!x.display_url || !!x.edge_sidecar_to_children);
};

/** Depth-first search for the first object matching a predicate. */
export function deepFind<T>(root: unknown, pred: (o: unknown) => o is T, maxDepth = 40): T | undefined {
  const stack: Array<[unknown, number]> = [[root, 0]];
  const seen = new Set<unknown>();
  while (stack.length) {
    const [node, d] = stack.pop()!;
    if (!node || typeof node !== "object" || seen.has(node) || d > maxDepth) continue;
    seen.add(node);
    if (pred(node)) return node;
    const vals = Array.isArray(node) ? node : Object.values(node);
    for (let i = vals.length - 1; i >= 0; i--) stack.push([vals[i], d + 1]);
  }
  return undefined;
}

/** Parses Instagram JSON (API response or any blob containing post data). */
export function parseInstagramJson(json: unknown, sourceUrl?: string, preferCode?: string): Post {
  const match = preferCode ? (o: unknown): o is V1Item => isV1Item(o) && (o as V1Item).code === preferCode : isV1Item;
  const v1 = deepFind(json, match) ?? deepFind(json, isV1Item);
  if (v1) return fromV1(v1, sourceUrl);
  const g = deepFind(json, isGql);
  if (g) return fromGql(g);
  throw new UserError("Couldn't find Instagram post data in that text. Instagram may have changed its format.");
}

/** Extracts JSON blocks from a pasted page source and finds the post. */
export function parseInstagramHtml(html: string, preferCode?: string): Post {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      /* not JSON */
    }
  }
  for (const b of blocks) {
    try {
      return parseInstagramJson(b, undefined, preferCode);
    } catch {
      /* keep looking */
    }
  }
  throw new UserError("Couldn't find Instagram post data in that page source. Use the one-click button instead.");
}

// ---- Story trays: highlights and a user's current stories (/api/v1/feed/reels_media/) ----
type ReelMedia = { id?: string | number; title?: string; user?: { username?: string }; items?: V1Item[] };

/** Parses a highlight or story tray; every item in it becomes a downloadable file. */
export function parseInstagramReel(json: unknown, label: string, sourceUrl: string): Post {
  const j = json as { reels?: Record<string, ReelMedia>; reels_media?: ReelMedia[] } | null;
  const reel = (j?.reels && Object.values(j.reels)[0]) ?? j?.reels_media?.[0];
  if (!reel?.items?.length) throw new UserError("There are no stories to save here (they may have expired).");
  const items = reel.items.map(v1Media).filter((x): x is MediaItem => !!x);
  const latest = Math.max(...reel.items.map((i) => i.taken_at ?? 0));
  return {
    platform: "instagram",
    id: label.replace(/[^\w.-]/g, "_"),
    url: sourceUrl,
    author: reel.user?.username,
    title: reel.title ? `Highlight: ${reel.title}` : label.startsWith("stories_") ? "Current stories" : undefined,
    takenAt: latest ? new Date(latest * 1000).toISOString() : undefined,
    items,
  };
}

// ---- Profile pictures ----
type ProfileRaw = {
  profile?: { data?: { user?: { username?: string; full_name?: string; profile_pic_url_hd?: string; profile_pic_url?: string } } } | null;
  info?: { user?: { username?: string; hd_profile_pic_url_info?: Candidate; hd_profile_pic_versions?: Candidate[]; profile_pic_url?: string } } | null;
};

/** Picks the largest available profile picture (usually 1080px). */
export function parseInstagramProfile(raw: unknown, username: string, sourceUrl: string): Post {
  type PageUser = { username?: string; full_name?: string; profile_pic_url?: string; profile_pic_url_hd?: string; hd_profile_pic_url_info?: Candidate; hd_profile_pic_versions?: Candidate[] };
  const r = raw as ProfileRaw & { stories?: unknown; highlights?: unknown; tray?: { tray?: Array<{ id?: string; title?: string }> } | null; page?: { user?: PageUser | null; items?: string[] }; fails?: string[] };
  const pu = r?.page?.user ?? undefined;
  const info = r?.info?.user;
  const prof = r?.profile?.data?.user as (NonNullable<ProfileRaw["profile"]>["data"] & { user?: { edge_owner_to_timeline_media?: { edges?: Array<{ node: GqlNode }> } } })["user"];
  const candidates: Candidate[] = [
    ...(info?.hd_profile_pic_url_info?.url ? [info.hd_profile_pic_url_info] : []),
    ...(info?.hd_profile_pic_versions ?? []),
    ...(prof?.profile_pic_url_hd ? [{ url: prof.profile_pic_url_hd, width: 320 }] : []),
    ...(prof?.profile_pic_url ? [{ url: prof.profile_pic_url, width: 150 }] : []),
    ...(pu?.hd_profile_pic_url_info?.url ? [pu.hd_profile_pic_url_info] : []),
    ...(pu?.hd_profile_pic_versions ?? []),
    ...(pu?.profile_pic_url_hd ? [{ url: pu.profile_pic_url_hd, width: 320 }] : []),
    ...(pu?.profile_pic_url ? [{ url: pu.profile_pic_url, width: 150 }] : []),
  ];
  const pic = best(candidates);
  const name = info?.username ?? prof?.username ?? pu?.username ?? username;
  const items: MediaItem[] = [];
  if (pic) items.push({ kind: "IMAGE", url: pic.url, width: pic.width, height: pic.height, group: "Profile picture" });

  // Current stories.
  const storyReel = (r?.stories as { reels?: Record<string, ReelMedia>; reels_media?: ReelMedia[] } | null | undefined);
  const sr = (storyReel?.reels && Object.values(storyReel.reels)[0]) ?? storyReel?.reels_media?.[0];
  for (const it of sr?.items ?? []) {
    const m = v1Media(it);
    if (m) items.push({ ...m, group: "Stories" });
  }

  // Highlights, in the order of the profile's highlight tray.
  const hl = r?.highlights as { reels?: Record<string, ReelMedia>; reels_media?: ReelMedia[] } | null | undefined;
  const reels: ReelMedia[] = hl?.reels ? Object.values(hl.reels) : (hl?.reels_media ?? []);
  const order = (r?.tray?.tray ?? []).map((t) => t.id);
  reels.sort((a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id)));
  for (const reel of reels) {
    for (const it of reel.items ?? []) {
      const m = v1Media(it);
      if (m) items.push({ ...m, group: `Highlight: ${reel.title || "Untitled"}` });
    }
  }

  // Recent posts served with the profile (carousels expanded).
  let videoWithoutFile = 0;
  for (const e of prof?.edge_owner_to_timeline_media?.edges ?? []) {
    const parts = e.node.edge_sidecar_to_children?.edges?.map((c) => c.node) ?? [e.node];
    for (const n of parts) {
      if (n.is_video && !n.video_url) {
        videoWithoutFile++;
        continue;
      }
      const m = gqlMedia(n);
      if (m) items.push({ ...m, group: "Posts" });
    }
  }
  // Posts already on the page (used when the profile request was refused, or to add to it).
  const seen = new Set(items.map((i) => i.url));
  for (const b of r?.page?.items ?? []) {
    let o: unknown;
    try {
      o = JSON.parse(b);
    } catch {
      continue;
    }
    const post = isV1Item(o) ? fromV1(o, sourceUrl) : isGql(o) ? fromGql(o) : null;
    for (const m of post?.items ?? []) {
      if (seen.has(m.url)) continue;
      seen.add(m.url);
      items.push({ ...m, group: "Posts" });
    }
  }
  if (!items.length) throw new UserError("Couldn't find anything to save on this profile." + (r?.fails?.length ? ` Instagram said: ${r.fails.join("; ")}` : ""));
  const notes: string[] = [];
  const missing = [!items.some((i) => i.group === "Stories") && r?.stories === null ? "stories" : "", r?.tray === null ? "highlights" : ""].filter(Boolean);
  if (missing.length && r?.fails?.length) notes.push(`Couldn't load ${missing.join(" and ")}. Instagram said: ${r.fails.join("; ")}`);
  if (videoWithoutFile) notes.push(`${videoWithoutFile} post video(s) weren't included in the profile data. Open those posts to save them.`);
  if ((prof?.edge_owner_to_timeline_media?.edges?.length ?? 0) >= 12) notes.push("Shows the most recent posts. Open older posts individually to save them.");
  return {
    platform: "instagram",
    id: `profile_${name}`,
    url: sourceUrl,
    author: name,
    title: (prof?.full_name ?? pu?.full_name) ? `${prof?.full_name ?? pu?.full_name} (@${name})` : `@${name}`,
    items,
    notes: notes.length ? notes : undefined,
  };
}

/** Post data the bookmarklet found already embedded in the page (no extra request made). */
export function parsePageJson(blocks: string[], sourceUrl: string, shortcode?: string): Post {
  const parsed = blocks.map((b) => {
    try {
      return JSON.parse(b) as unknown;
    } catch {
      return null;
    }
  });
  // Pages often hold several posts (e.g. the next reels): only accept the exact one.
  if (shortcode) {
    for (const j of parsed) {
      const v1 = deepFind(j, (o): o is V1Item => isV1Item(o) && (o as V1Item).code === shortcode);
      if (v1) return fromV1(v1, sourceUrl);
      const g = deepFind(j, (o): o is GqlNode => isGql(o) && (o as GqlNode).shortcode === shortcode);
      if (g) return fromGql(g);
    }
    throw new UserError("Couldn't find this exact post on the page. Reload the post on Instagram (so it's the only one open) and try again.");
  }
  for (const j of parsed) {
    try {
      return parseInstagramJson(j, sourceUrl);
    } catch {
      /* try the next block */
    }
  }
  throw new UserError("Couldn't find the post data on that page. Reload the post on Instagram and tap the button again.");
}

// ---- Story / highlight links (pasted) ----
export type StoryLink = { kind: "story" | "highlight"; username?: string; storyId?: string; highlightId?: string; canonicalUrl: string };

export function parseStoryUrl(input: string): StoryLink | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!isInstagramHost(url.hostname)) return null;
  const seg = url.pathname.split("/").filter(Boolean);
  if (seg[0]?.toLowerCase() !== "stories" || !seg[1]) return null;
  if (seg[1].toLowerCase() === "highlights" && /^\d{1,30}$/.test(seg[2] ?? "")) {
    return { kind: "highlight", highlightId: seg[2], canonicalUrl: `https://www.instagram.com/stories/highlights/${seg[2]}/` };
  }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(seg[1])) return null;
  const storyId = /^\d{1,30}$/.test(seg[2] ?? "") ? seg[2] : undefined;
  return { kind: "story", username: seg[1], storyId, canonicalUrl: `https://www.instagram.com/stories/${seg[1]}/${storyId ? `${storyId}/` : ""}` };
}

const pkOf = (it: V1Item) => String(it.pk ?? it.id ?? "").split("_")[0];

/**
 * Finds story media in pasted data (page source or JSON). With a story id,
 * returns that story; otherwise every story item found in the tray.
 */
export function parseStoryData(json: unknown, link: StoryLink): Post {
  if (link.storyId) {
    const one = deepFind(json, (o): o is V1Item => isV1Item(o) && pkOf(o as V1Item) === link.storyId);
    if (one) return { ...fromV1(one, link.canonicalUrl), id: `story_${link.storyId}`, url: link.canonicalUrl };
  }
  const isTray = (o: unknown): o is ReelMedia => {
    const items = (o as ReelMedia)?.items;
    return Array.isArray(items) && items.length > 0 && items.every(isV1Item);
  };
  // Prefer the tray belonging to the person in the link (pages can include other people's stories).
  const tray =
    link.username
      ? deepFind(json, (o): o is ReelMedia => isTray(o) && (o as ReelMedia).user?.username?.toLowerCase() === link.username!.toLowerCase())
      : deepFind(json, isTray); // never fall back to someone else's stories
  if (tray?.items?.length) {
    const label = link.kind === "highlight" ? `highlight_${link.highlightId}` : `stories_${link.username}`;
    return parseInstagramReel({ reels_media: [tray] }, label, link.canonicalUrl);
  }
  throw new UserError("That page didn't include the story's media. This can happen with stories. Use the one-click button on the story instead.");
}
