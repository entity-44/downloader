/**
 * Keepsake media relay (Cloudflare Worker).
 *
 * Fetches media files (images, videos, Reddit DASH manifests/streams) from
 * Instagram's and Reddit's file servers for the Keepsake site, so downloads
 * work even when those servers don't allow the browser to read them directly.
 *
 * It only accepts requests from the Keepsake site's origin, only fetches from
 * the media CDNs below over HTTPS, never sends cookies or credentials, and
 * It can also look up public post data from two public sources, by ID only:
 *  - /tweet?id=   X's public embed data (cdn.syndication.twimg.com, used by embedded tweets)
 *  - /redgifs?id= RedGIFs' public API (anonymous temporary token, as their site uses)
 *  - /pixiv?id=   Pixiv's public work data (logged out; adults-only works are refused by Pixiv)
 *  - /snapchat?url= a public Snapchat page's link-preview metadata (JSON-LD / Open Graph)
 * It never calls Instagram's private API.
 */
const ALLOWED_ORIGINS = new Set(["https://entity-44.github.io", "http://localhost:5173", "http://localhost:4173"]);
const MEDIA_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net|redd\.it|redditmedia\.com|twimg\.com|redgifs\.com|pximg\.net|sc-cdn\.net)$/i;
const OK_TYPES = /^(image|video|audio)\/|dash\+xml|octet-stream|binary|application\/zip/i;
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

/** Pixiv's image server only serves files to requests coming from pixiv.net. */
function upstreamHeaders(u) {
  const h = { "User-Agent": UA, Accept: "image/*,video/*,audio/*,application/dash+xml,*/*;q=0.5" };
  if (/(^|\.)pximg\.net$/i.test(u.hostname)) h.Referer = "https://www.pixiv.net/";
  return h;
}

const json = (status, data, cors) => new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** Token formula used by X's own embed widget for the syndication endpoint. */
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

async function tweet(id, cors) {
  if (!/^\d{1,25}$/.test(id)) return text(400, "Invalid post id.", cors);
  const u = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`;
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (r.status === 404) return json(404, { error: "not_found" }, cors);
  if (!r.ok) return json(502, { error: "upstream", status: r.status }, cors);
  return json(200, await r.json(), cors);
}

let redgifsToken = null;
async function redgifs(id, cors) {
  if (!/^[a-z]{3,80}$/i.test(id)) return text(400, "Invalid RedGIFs id.", cors);
  const getToken = async () => {
    if (redgifsToken && redgifsToken.exp > Date.now()) return redgifsToken.value;
    const t = await fetch("https://api.redgifs.com/v2/auth/temporary", { headers: { "User-Agent": UA } });
    if (!t.ok) throw new Error("token");
    const value = (await t.json()).token;
    redgifsToken = { value, exp: Date.now() + 20 * 3600_000 };
    return value;
  };
  let r;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetch(`https://api.redgifs.com/v2/gifs/${id.toLowerCase()}`, { headers: { "User-Agent": UA, Authorization: `Bearer ${await getToken()}` } });
    if (r.status !== 401) break;
    redgifsToken = null; // expired token: get a fresh one once
  }
  if (r.status === 404 || r.status === 410) return json(404, { error: "not_found" }, cors);
  if (!r.ok) return json(502, { error: "upstream", status: r.status }, cors);
  return json(200, await r.json(), cors);
}

async function pixiv(id, cors) {
  if (!/^\d{1,12}$/.test(id)) return text(400, "Invalid Pixiv id.", cors);
  const get = async (p) => {
    const r = await fetch("https://www.pixiv.net/ajax/illust/" + id + p, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.pixiv.net/" } });
    const j = await r.json().catch(() => null);
    return j && !j.error ? j.body : null;
  };
  const illust = await get("");
  if (!illust) return json(404, { error: "not_found_or_login_required" }, cors);
  const out = { illust, pages: null, ugoira: null };
  if (illust.illustType === 2) out.ugoira = await get("/ugoira_meta");
  if ((illust.pageCount ?? 1) > 1) out.pages = await get("/pages");
  return json(200, out, cors);
}

const SNAP_HOST = /^(?:www\.|story\.|t\.)?snapchat\.com$/i;
async function snapchat(raw, cors) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return text(400, "Invalid Snapchat link.", cors);
  }
  if (u.protocol !== "https:" || !SNAP_HOST.test(u.hostname)) return text(400, "Only snapchat.com links are supported.", cors);
  let r;
  for (let hop = 0; hop < 4; hop++) {
    r = await fetch(u.toString(), { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" } });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      u = new URL(loc, u);
      if (!SNAP_HOST.test(u.hostname)) return text(502, "Snapchat redirected somewhere unexpected.", cors);
      continue;
    }
    break;
  }
  if (r.status === 404) return json(404, { error: "not_found" }, cors);
  if (!r.ok) return json(502, { error: "upstream", status: r.status }, cors);
  const html = (await r.text()).slice(0, 3_000_000);
  const ld = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      ld.push(JSON.parse(m[1]));
    } catch {}
  }
  const og = {};
  for (const m of html.matchAll(/<meta[^>]+property="og:([a-z:_]+)"[^>]+content="([^"]*)"/gi)) og[m[1]] = m[2].replace(/&amp;/g, "&");
  let next = null;
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nd) {
    try {
      next = JSON.parse(nd[1])?.props?.pageProps ?? null;
    } catch {}
  }
  return json(200, { url: u.toString(), ld, og, next }, cors);
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
    if (url.pathname === "/tweet") return tweet(url.searchParams.get("id") ?? "", cors);
    if (url.pathname === "/redgifs") return redgifs(url.searchParams.get("id") ?? "", cors);
    if (url.pathname === "/pixiv") return pixiv(url.searchParams.get("id") ?? "", cors);
    if (url.pathname === "/snapchat") return snapchat(url.searchParams.get("url") ?? "", cors);
    if (url.pathname !== "/media") return text(404, "Not found", cors);

    let target = allowedTarget(url.searchParams.get("u") ?? "");
    if (!target) return text(400, "Only HTTPS media from supported file servers (Instagram, Reddit, X, RedGIFs, Pixiv, Snapchat) is allowed.", cors);

    // Follow redirects manually so every hop stays on an allowed host.
    let upstream;
    for (let hop = 0; hop < 4; hop++) {
      upstream = await fetch(target.toString(), {
        redirect: "manual",
        headers: upstreamHeaders(target),
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
