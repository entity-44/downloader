import { parseInstagramHtml, parseInstagramJson, parseInstagramProfile, parseInstagramReel, parsePageJson } from "./instagram";
import { parseRedditJson } from "./reddit";
import { UserError, type Post } from "./types";

/** Data collected on the Instagram/Reddit page by the bookmark or the iOS Shortcut. */
export type Collected = {
  platform: "instagram" | "reddit";
  url: string;
  kind?: "post" | "reel" | "profile";
  reelLabel?: string;
  username?: string;
  shortcode?: string;
  pageJson?: string[];
  raw?: unknown;
  html?: string;
  error?: string;
  keepsake?: number;
};

export function parseCollected(msg: Collected): Post {
  if (msg.error) throw new UserError(msg.error);
  if (msg.platform === "reddit") return parseRedditJson(msg.raw);
  if (msg.kind === "reel") return parseInstagramReel(msg.raw, msg.reelLabel ?? "stories", msg.url);
  if (msg.kind === "profile") return parseInstagramProfile(msg.raw, msg.username ?? "", msg.url);
  if (msg.pageJson?.length) return parsePageJson(msg.pageJson, msg.url, msg.shortcode);
  if (msg.raw) return parseInstagramJson(msg.raw, msg.url, msg.shortcode);
  if (msg.html) return parseInstagramHtml(msg.html, msg.shortcode);
  throw new UserError("No post data was received.");
}

/** Recognizes text copied by the iOS Shortcut. */
export function asCollected(json: unknown): Collected | null {
  const o = json as Collected | null;
  return o && typeof o === "object" && o.keepsake === 1 && (o.platform === "instagram" || o.platform === "reddit" || typeof o.error === "string") ? o : null;
}
