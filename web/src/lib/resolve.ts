import { parseInstagramHtml, parseInstagramJson, parseInstagramUrl, parseStoryData, parseStoryUrl, type IgLink, type StoryLink } from "./instagram";
import { fetchRedditPost, parseRedditJson, parseRedditUrl, resolveVreddit } from "./reddit";
import { asCollected, fromPasteLink, parseCollected } from "./incoming";
import { fetchRedgifs, parseRedgifsUrl } from "./redgifs";
import { setting } from "./router";
import { fetchTweet, parseXUrl } from "./x";
import { UserError, type Post } from "./types";

/** Instagram post link: the user opens a data link in their own signed-in browser and pastes the result. */
export class NeedsGuidedPaste extends Error {
  constructor(readonly link: IgLink | StoryLink) {
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

  // A Keepsake Shortcut link with the post data inside it.
  const linked = fromPasteLink(text);
  if (linked !== undefined) {
    const c = asCollected(linked);
    if (c) return parseCollected(c);
  }

  // Pasted data (manual backup method)
  if (text.startsWith("{") || text.startsWith("[")) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new UserError("That looks like JSON but couldn't be read. Make sure you copied all of it.");
    }
    const collected = asCollected(json);
    if (collected) return parseCollected(collected);
    try {
      return parseRedditJson(json);
    } catch {
      return parseInstagramJson(json);
    }
  }
  if (/<html|<script/i.test(text)) return parseInstagramHtml(text);

  const xLink = parseXUrl(text);
  if (xLink) return fetchTweet(xLink.id, xLink.canonicalUrl);
  const rg = parseRedgifsUrl(text);
  if (rg) return fetchRedgifs(rg.id, rg.canonicalUrl);

  const ig = parseInstagramUrl(text);
  if (ig) throw new NeedsGuidedPaste(ig);
  const story = parseStoryUrl(text);
  if (story) throw new NeedsGuidedPaste(story);
  const rd = parseRedditUrl(text);
  if (rd?.kind === "vreddit") return resolveVreddit(rd.videoId);
  if (rd?.kind === "share") throw new NeedsButton("reddit", "Reddit share links (/s/…) can't be opened from here. Open the link, then tap the Keepsake button or copy the full post address.");
  if (rd?.kind === "post") {
    const clientId = setting("reddit_client_id");
    if (clientId) return fetchRedditPost(rd.id, clientId);
    throw new NeedsButton("reddit", "Open this post on reddit.com and tap the Keepsake button, or add a free Reddit client ID in Settings to paste Reddit links directly.");
  }
  throw new UserError("Paste a link from Instagram, Reddit, X (Twitter) or RedGIFs.");
}

/**
 * The post's normal page, viewed as source. We deliberately avoid the
 * "?__a=1" data address: Instagram flags it as automated ({"spam":true}).
 */
const isStory = (l: IgLink | StoryLink): l is StoryLink => l.kind === "story" || l.kind === "highlight";

export function dataLinks(link: IgLink | StoryLink) {
  const page = isStory(link) ? link.canonicalUrl : `https://www.instagram.com/p/${link.shortcode}/`;
  // data: the Snapinsta-style JSON link (posts only). Offered as an opt-in alternative because
  // Instagram sometimes answers it with {"spam":true}; the page-source route is the default.
  return { post: page, pageSource: `view-source:${page}`, data: isStory(link) ? undefined : `https://www.instagram.com/p/${link.shortcode}/?__a=1&__d=dis` };
}

/** Extracts every JSON block from a pasted page source. */
function jsonBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* not JSON */
    }
  }
  return out;
}

/** Parses text the user copied from Instagram, with helpful errors for common mistakes. */
export function parsePastedInstagram(text: string, link?: IgLink | StoryLink): Post {
  const story = link && isStory(link) ? link : undefined;
  const post = link && !isStory(link) ? link : undefined;
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
    return story ? parseStoryData(json, story) : parseInstagramJson(json, post?.canonicalUrl, post?.shortcode);
  }
  if (/<html|<script/i.test(t)) {
    if (/"loginForm"|accounts\/login|LoginAndSignupPage/i.test(t) && !/image_versions2|video_versions|display_url/.test(t)) {
      throw new UserError("That's Instagram's sign-in page. Sign in to instagram.com in this browser first, then try again.");
    }
    return story ? parseStoryData(jsonBlocks(t), story) : parseInstagramHtml(t, post?.shortcode);
  }
  throw new UserError("That doesn't look like the text from the Instagram link. Open the link, select all, copy, and paste here.");
}
