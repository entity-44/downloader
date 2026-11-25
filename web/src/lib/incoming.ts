import { parseInstagramHtml, parseInstagramJson, parseInstagramProfile, parseInstagramReel, parsePageJson, parseStoryData, type StoryLink } from "./instagram";
import { parseRedditJson } from "./reddit";
import { UserError, type MediaItem, type Post } from "./types";

/** Data collected on the Instagram/Reddit page by the bookmark or the iOS Shortcut. */
export type Collected = {
  platform: "instagram" | "reddit";
  url: string;
  kind?: "post" | "reel" | "profile" | "storypage" | "screen";
  reelLabel?: string;
  username?: string;
  storyId?: string;
  media?: MediaItem[];
  shortcode?: string;
  pageJson?: string[];
  raw?: unknown;
  html?: string;
  error?: string;
  keepsake?: number;
  /** Collector code version (missing on codes saved before versioning). */
  v?: number;
};

export function parseCollected(msg: Collected): Post {
  if (msg.error) throw new UserError(msg.error);
  if (msg.platform === "reddit") return parseRedditJson(msg.raw);
  if (msg.kind === "reel") return parseInstagramReel(msg.raw, msg.reelLabel ?? "stories", msg.url);
  if (msg.kind === "profile") return parseInstagramProfile(msg.raw, msg.username ?? "", msg.url);
  if (msg.kind === "storypage" || msg.kind === "screen") {
    const isHighlight = msg.reelLabel?.startsWith("highlight_");
    const link: StoryLink = {
      kind: isHighlight ? "highlight" : "story",
      username: msg.username,
      storyId: msg.storyId,
      highlightId: isHighlight ? msg.reelLabel!.slice(10) : undefined,
      canonicalUrl: msg.url,
    };
    if (msg.kind === "storypage") {
      const blocks = (msg.pageJson ?? []).map((b) => {
        try {
          return JSON.parse(b);
        } catch {
          return null;
        }
      });
      try {
        return parseStoryData(blocks, link);
      } catch (e) {
        // Page data in an unexpected format: use what was on screen instead.
        if (!msg.media?.length) throw e;
      }
    }
    const items = (msg.media ?? []).filter((m) => typeof m?.url === "string" && /^https:\/\//.test(m.url) && (m.kind === "IMAGE" || m.kind === "VIDEO"));
    if (!items.length) throw new UserError("No media was found on the screen.");
    return {
      platform: "instagram",
      id: (msg.reelLabel ?? "story").replace(/[^\w.-]/g, "_"),
      url: msg.url,
      author: msg.username,
      title: "From your screen",
      items: items.map((m) => ({ kind: m.kind, url: m.url, width: m.width, height: m.height, thumbUrl: m.thumbUrl })),
      notes: items.some((m) => m.kind === "IMAGE") && !items.some((m) => m.kind === "VIDEO") ? ["Saved what's visible on screen. If this story is a video, Instagram may only expose its preview image here."] : undefined,
    };
  }
  if (msg.pageJson?.length) return parsePageJson(msg.pageJson, msg.url, msg.shortcode);
  if (msg.raw) return parseInstagramJson(msg.raw, msg.url, msg.shortcode);
  if (msg.html) return parseInstagramHtml(msg.html, msg.shortcode);
  throw new UserError("No post data was received.");
}

/** Extracts post data from a Keepsake Shortcut link (…#/paste/<data>), if the text is one. */
export function fromPasteLink(text: string): unknown | undefined {
  // "?paste=<data>" (current) or "#/paste/<data>" (earlier); Shortcuts may encode "#" as %23.
  const m = text.match(/(?:[?&]paste=|(?:#|%23)\/paste\/)([^\s&]+)/);
  if (!m) return undefined;
  // The data may have been percent-encoded more than once along the way.
  let v = m[1];
  for (let i = 0; i < 4; i++) {
    try {
      return JSON.parse(v);
    } catch {
      /* not JSON yet */
    }
    try {
      const d = decodeURIComponent(v);
      if (d === v) break;
      v = d;
    } catch {
      break;
    }
  }
  return undefined;
}

/** Recognizes text copied by the iOS Shortcut. */
export function asCollected(json: unknown): Collected | null {
  const o = json as Collected | null;
  return o && typeof o === "object" && o.keepsake === 1 && (o.platform === "instagram" || o.platform === "reddit" || typeof o.error === "string") ? o : null;
}
