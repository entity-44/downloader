import { parseInstagramHtml, parseInstagramJson, parseInstagramUrl } from "./instagram";
import { fetchRedditPost, parseRedditJson, parseRedditUrl, resolveVreddit } from "./reddit";
import { setting } from "./router";
import { UserError, type Post } from "./types";

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
  if (ig) {
    throw new NeedsButton(
      "instagram",
      "Instagram doesn't let other websites read posts, so open this post on instagram.com and tap the Keepsake button. It takes one tap once it's set up.",
    );
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
