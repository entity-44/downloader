import { AppError } from "../http/errors";

export type ParsedInstagramUrl =
  | { kind: "post" | "reel" | "tv"; shortcode: string; canonicalUrl: string }
  | { kind: "story"; username: string; storyId: string | null; canonicalUrl: string }
  | { kind: "profile"; username: string; canonicalUrl: string };

const HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);
const SHORTCODE = /^[A-Za-z0-9_-]{5,64}$/;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const RESERVED = new Set(["explore", "accounts", "direct", "about", "legal", "developer", "share", "s", "web", "api", "graphql", "oauth"]);
const MAX_URL_LENGTH = 2048;

/**
 * Strictly parses an Instagram URL. Only instagram.com hosts over http(s) are
 * accepted; the URL is never fetched by this function.
 */
export function parseInstagramUrl(input: string): ParsedInstagramUrl {
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) throw new AppError("UNSUPPORTED_URL");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new AppError("UNSUPPORTED_URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AppError("UNSUPPORTED_URL");
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) throw new AppError("UNSUPPORTED_URL");
  if (!HOSTS.has(url.hostname.toLowerCase())) throw new AppError("UNSUPPORTED_URL", "Only instagram.com links are supported.");

  const seg = url.pathname.split("/").filter(Boolean);
  if (seg.length === 0) throw new AppError("UNSUPPORTED_URL");

  // /p/{code}, /reel/{code}, /reels/{code}, /tv/{code}
  // and the newer /{username}/p/{code}, /{username}/reel/{code}
  const typeIdx = seg.findIndex((s, i) => i <= 1 && ["p", "reel", "reels", "tv"].includes(s.toLowerCase()));
  if (typeIdx >= 0 && (typeIdx === 0 || USERNAME.test(seg[0]))) {
    const type = seg[typeIdx].toLowerCase();
    const code = seg[typeIdx + 1];
    if (!code || !SHORTCODE.test(code)) throw new AppError("UNSUPPORTED_URL", "The post code in this link is invalid.");
    const kind = type === "p" ? "post" : type === "tv" ? "tv" : "reel";
    const pathType = kind === "post" ? "p" : kind;
    return { kind, shortcode: code, canonicalUrl: `https://www.instagram.com/${pathType}/${code}/` };
  }

  if (seg[0].toLowerCase() === "stories" && seg[1] && USERNAME.test(seg[1])) {
    const storyId = seg[2] && /^\d{1,30}$/.test(seg[2]) ? seg[2] : null;
    return {
      kind: "story",
      username: seg[1].toLowerCase(),
      storyId,
      canonicalUrl: `https://www.instagram.com/stories/${seg[1]}/${storyId ? `${storyId}/` : ""}`,
    };
  }

  if (seg[0].toLowerCase() === "share") {
    throw new AppError("UNSUPPORTED_URL", "Share links can't be resolved. Open the link in Instagram and copy the post's full address (it contains /p/ or /reel/).");
  }

  if (seg.length === 1 && USERNAME.test(seg[0]) && !RESERVED.has(seg[0].toLowerCase())) {
    return { kind: "profile", username: seg[0].toLowerCase(), canonicalUrl: `https://www.instagram.com/${seg[0]}/` };
  }

  throw new AppError("UNSUPPORTED_URL");
}

/** Extracts the shortcode from a Graph API permalink, if any. */
export function shortcodeFromPermalink(permalink: string | undefined | null): string | null {
  if (!permalink) return null;
  try {
    const p = parseInstagramUrl(permalink);
    return "shortcode" in p ? p.shortcode : null;
  } catch {
    return null;
  }
}
