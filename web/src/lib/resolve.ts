import { parseInstagramHtml, parseInstagramJson, parseInstagramUrl, type IgLink } from "./instagram";
import { fetchRedditPost, parseRedditJson, parseRedditUrl, resolveVreddit } from "./reddit";
import { setting } from "./router";
import { UserError, type Post } from "./types";

/** Instagram post link: the user opens a data link in their own signed-in browser and pastes the result. */
export class NeedsGuidedPaste extends Error {
  constructor(readonly link: IgLink) {
    super("guided-paste");
  }
}

/** Thrown when a link needs the one-click button (no way to read it from this site). */
export class NeedsButton extends Error {
  constructor(readonly platform: "instagram" | "reddit", message: string) {
    super(message);
  }
}

export async function resolveInput(input: string): Promise<Post> {
  const text = input.trim();
  if (!text) throw new UserError("Paste a link first.");

  // Pasted data (manual backup method)
  if (text.startsWith("{") || text.startsWith("[")) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new UserError("That looks like JSON but couldn't be read. Make sure you copied all of it.");
    }
    try {
      return parseRedditJson(json);
    } catch {
      return parseInstagramJson(json);
    }
  }
  if (/<html|<script/i.test(text)) return parseInstagramHtml(text);

  const ig = parseInstagramUrl(text);
  if (ig) throw new NeedsGuidedPaste(ig);
  if (/instagram\.com\/stories\//i.test(text)) {
    throw new NeedsButton("instagram", "Stories can't be read from a pasted link, even with the copy-and-paste steps. Open the story on instagram.com and tap the Keepsake button. It works for private stories you can see.");
  }
  const rd = parseRedditUrl(text);
  if (rd?.kind === "vreddit") return resolveVreddit(rd.videoId);
  if (rd?.kind === "share") throw new NeedsButton("reddit", "Reddit share links (/s/…) can't be opened from here. Open the link, then tap the Keepsake button or copy the full post address.");
  if (rd?.kind === "post") {
    const clientId = setting("reddit_client_id");
    if (clientId) return fetchRedditPost(rd.id, clientId);
    throw new NeedsButton("reddit", "Open this post on reddit.com and tap the Keepsake button, or add a free Reddit client ID in Settings to paste Reddit links directly.");
  }
  throw new UserError("Paste an Instagram or Reddit post link (or a v.redd.it video link).");
}

/**
 * The post's normal page, viewed as source. We deliberately avoid the
 * "?__a=1" data address: Instagram flags it as automated ({"spam":true}).
 */
export function dataLinks(link: IgLink) {
  return {
    post: `https://www.instagram.com/p/${link.shortcode}/`,
    pageSource: `view-source:https://www.instagram.com/p/${link.shortcode}/`,
  };
}

/** Parses text the user copied from Instagram, with helpful errors for common mistakes. */
export function parsePastedInstagram(text: string, link?: IgLink): Post {
  const t = text.trim();
  if (!t) throw new UserError("Paste the text you copied first.");
  if (t.startsWith("{") || t.startsWith("[")) {
    let json: unknown;
    try {
      json = JSON.parse(t);
    } catch {
      throw new UserError("That text is incomplete. Make sure you selected all of it (Select All) before copying.");
    }
    const msg = (json as { message?: string; require_login?: boolean; status?: string ; spam?: boolean }) ?? {};
    if (msg.spam) throw new UserError("Instagram flagged that page as automated (\"spam\": true). Don't retry it. Use the page-source steps above or the one-click button instead, and give it a while before trying again.");
    if (msg.require_login || /login/i.test(msg.message ?? "")) throw new UserError("Instagram says you're not signed in. Sign in to instagram.com in this browser, then open the link again.");
    if (/useragent mismatch|not available|please wait/i.test(msg.message ?? "")) throw new UserError(`Instagram refused that request ("${msg.message}"). Try again in a minute, use the other link below, or use the one-click button.`);
    return parseInstagramJson(json, link?.canonicalUrl, link?.shortcode);
  }
  if (/<html|<script/i.test(t)) {
    if (/"loginForm"|accounts\/login|LoginAndSignupPage/i.test(t) && !/image_versions2|video_versions|display_url/.test(t)) {
      throw new UserError("That's Instagram's sign-in page. Sign in to instagram.com in this browser first, then try again.");
    }
    return parseInstagramHtml(t, link?.shortcode);
  }
  throw new UserError("That doesn't look like the text from the Instagram link. Open the link, select all, copy, and paste here.");
}
