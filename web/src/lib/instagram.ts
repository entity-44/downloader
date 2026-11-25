import { UserError, type MediaItem, type Post } from "./types";

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
const thumb = (c?: Candidate[]) => {
  if (!c?.length) return undefined;
  const sorted = [...c].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((x) => (x.width ?? 0) >= 320) ?? sorted[sorted.length - 1]).url;
};

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
  carousel_media?: V1Item[];
};

function v1Media(it: V1Item): MediaItem | null {
  const img = best(it.image_versions2?.candidates);
  const vid = best(it.video_versions);
  if (vid) return { kind: "VIDEO", url: vid.url, width: vid.width, height: vid.height, thumbUrl: thumb(it.image_versions2?.candidates), durationSec: it.video_duration };
  if (img) return { kind: "IMAGE", url: img.url, width: img.width, height: img.height, thumbUrl: thumb(it.image_versions2?.candidates) };
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
  const small = n.display_resources?.find((r) => (r.config_width ?? 0) >= 320)?.src;
  if (n.is_video && n.video_url) return { kind: "VIDEO", url: n.video_url, width: w, height: h, thumbUrl: small ?? n.display_url, durationSec: n.video_duration };
  if (n.display_url) return { kind: "IMAGE", url: n.display_url, width: w, height: h, thumbUrl: small };
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
