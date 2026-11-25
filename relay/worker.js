/**
 * Keepsake media relay (Cloudflare Worker).
 *
 * Fetches media files (images, videos, Reddit DASH manifests/streams) from
 * Instagram's and Reddit's file servers for the Keepsake site, so downloads
 * work even when those servers don't allow the browser to read them directly.
 *
 * It only accepts requests from the Keepsake site's origin, only fetches from
 * the media CDNs below over HTTPS, never sends cookies or credentials, and
 * does not look up posts or call any private API.
 */
const ALLOWED_ORIGINS = new Set(["https://entity-44.github.io", "http://localhost:5173", "http://localhost:4173"]);
const MEDIA_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net|redd\.it|redditmedia\.com)$/i;
const OK_TYPES = /^(image|video|audio)\/|dash\+xml|octet-stream|binary/i;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function allowedTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password || !MEDIA_HOST.test(u.hostname)) return null;
  return u;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Length, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const text = (status, body, headers = {}) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return text(403, "Forbidden");
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return text(405, "Method not allowed", cors);

    const url = new URL(request.url);
    if (url.pathname === "/health") return text(200, "ok", cors);
    if (url.pathname !== "/media") return text(404, "Not found", cors);

    let target = allowedTarget(url.searchParams.get("u") ?? "");
    if (!target) return text(400, "Only HTTPS media from Instagram or Reddit file servers is allowed.", cors);

    // Follow redirects manually so every hop stays on an allowed host.
    let upstream;
    for (let hop = 0; hop < 4; hop++) {
      upstream = await fetch(target.toString(), {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "image/*,video/*,audio/*,application/dash+xml,*/*;q=0.5" },
      });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("location")) {
        target = allowedTarget(new URL(upstream.headers.get("location"), target).toString());
        if (!target) return text(502, "Upstream redirected to a disallowed host.", cors);
        continue;
      }
      break;
    }
    if (!upstream || (upstream.status >= 300 && upstream.status < 400)) return text(502, "Too many redirects.", cors);
    if (!upstream.ok) return text(upstream.status === 404 || upstream.status === 403 || upstream.status === 410 ? upstream.status : 502, "Media unavailable.", cors);

    const type = upstream.headers.get("content-type") ?? "application/octet-stream";
    if (!OK_TYPES.test(type)) return text(415, "Not a media file.", cors);
    const headers = { ...cors, "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" };
    const len = upstream.headers.get("content-length");
    if (len) headers["content-length"] = len;
    return new Response(upstream.body, { status: 200, headers });
  },
};
