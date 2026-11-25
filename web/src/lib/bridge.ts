/**
 * Message bridge between the bookmarklet (running on instagram.com / reddit.com)
 * and this app (opened by the bookmarklet in a new tab).
 *
 * Security: messages are accepted only from window.opener AND only from
 * these exact origins. Replies are sent only to the opener's origin.
 */
export const TRUSTED_ORIGINS = new Set([
  "https://www.instagram.com",
  "https://instagram.com",
  "https://www.reddit.com",
  "https://old.reddit.com",
  "https://new.reddit.com",
  "https://sh.reddit.com",
  "https://www.pixiv.net",
  "https://www.tiktok.com",
]);

export type Incoming =
  | { type: "keepsake:post"; platform: "instagram" | "reddit" | "pixiv" | "tiktok"; url: string; file?: ArrayBuffer; mime?: string; kind?: "post" | "reel" | "profile" | "storypage" | "screen"; reelLabel?: string; pageJson?: string[]; storyId?: string; media?: unknown[]; error?: string; username?: string; raw?: unknown; html?: string; shortcode?: string }
  | { type: "keepsake:file"; reqId: string; buffer: ArrayBuffer; mime: string }
  | { type: "keepsake:file-error"; reqId: string; error: string };

let openerOrigin: string | null = null;

export function isTrustedMessage(e: MessageEvent, opener: Window | null): boolean {
  return !!opener && e.source === opener && TRUSTED_ORIGINS.has(e.origin) && typeof e.data === "object" && e.data !== null && typeof e.data.type === "string" && e.data.type.startsWith("keepsake:");
}

/** Waits for the bookmarklet to send post data. */
export function receivePost(timeoutMs = 45_000): Promise<Extract<Incoming, { type: "keepsake:post" }>> {
  return new Promise((resolve, reject) => {
    const opener = window.opener as Window | null;
    if (!opener) return reject(new Error("no-opener"));
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("timeout"));
    }, timeoutMs);
    function onMsg(e: MessageEvent) {
      if (!isTrustedMessage(e, opener) || e.data.type !== "keepsake:post") return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      openerOrigin = e.origin;
      resolve(e.data);
    }
    window.addEventListener("message", onMsg);
    // The "ready" ping carries no data, so "*" is safe; the bookmarklet checks our origin.
    opener.postMessage({ type: "keepsake:ready" }, "*");
  });
}

export function bridgeAvailable() {
  return !!openerOrigin && !!window.opener && !(window.opener as Window).closed;
}

/** Asks the bookmarklet tab to fetch a file from its own origin (Instagram's CDN may only allow instagram.com). */
export function bridgeFetch(url: string, timeoutMs = 120_000): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const opener = window.opener as Window | null;
    if (!opener || !openerOrigin || opener.closed) return reject(new Error("The original tab was closed."));
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("Timed out waiting for the original tab."));
    }, timeoutMs);
    function onMsg(e: MessageEvent) {
      if (!isTrustedMessage(e, opener) || e.data.reqId !== reqId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (e.data.type === "keepsake:file") resolve(new Blob([e.data.buffer], { type: e.data.mime || "application/octet-stream" }));
      else reject(new Error(e.data.error || "Fetch failed in the original tab."));
    }
    window.addEventListener("message", onMsg);
    opener.postMessage({ type: "keepsake:fetch", reqId, url }, openerOrigin);
  });
}
