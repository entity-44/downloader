import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS worker module
import worker from "../../relay/worker.js";

const SITE = "https://entity-44.github.io";
const call = (path: string, init: RequestInit & { origin?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set("Origin", init.origin ?? SITE);
  return worker.fetch(new Request(`https://relay.example${path}`, { ...init, headers }));
};
const media = (u: string) => `/media?u=${encodeURIComponent(u)}`;

afterEach(() => vi.unstubAllGlobals());

describe("media relay worker", () => {
  it("relays media from allowed CDNs with CORS for the site only", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg", "content-length": "3" } }));
    vi.stubGlobal("fetch", f);
    const r = await call(media("https://scontent-lax3-1.cdninstagram.com/v/a.jpg?x=1"));
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    const init = (f.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.stringify(init.headers)).not.toMatch(/cookie|authorization|x-ig-app-id/i);
  });

  it("refuses other origins, other hosts and non-media", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })));
    expect((await call(media("https://scontent.cdninstagram.com/a.jpg"), { origin: "https://evil.example" })).status).toBe(403);
    expect((await call(media("https://scontent.cdninstagram.com/a.jpg"), { origin: null })).status).toBe(403);
    for (const bad of ["https://www.instagram.com/graphql/query", "https://evil.com/a.jpg", "http://scontent.cdninstagram.com/a.jpg", "https://169.254.169.254/", "https://cdninstagram.com.evil.com/a.jpg", "not a url"]) {
      expect((await call(media(bad))).status).toBe(400);
    }
    expect((await call(media("https://i.redd.it/a.jpg"))).status).toBe(415);
    expect((await call("/other")).status).toBe(404);
    expect((await call(media("https://i.redd.it/a.jpg"), { method: "POST" })).status).toBe(405);
  });

  it("re-checks every redirect hop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.com/x.mp4" } })));
    expect((await call(media("https://v.redd.it/abc/DASH_720.mp4"))).status).toBe(502);
  });

  it("answers CORS preflight", async () => {
    const r = await call("/media", { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-methods")).toContain("GET");
  });
});

describe("site download fallback", () => {
  it("uses the relay when the CDN blocks the browser, and only for media URLs", async () => {
    const { fetchFile } = await import("../src/lib/fetchmedia");
    const { RELAY_URL } = await import("../src/lib/config");
    const calls: string[] = [];
    const fake = (async (u: string) => {
      calls.push(String(u));
      if (String(u).startsWith(RELAY_URL)) return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
      throw new TypeError("Failed to fetch"); // what a CORS block looks like
    }) as typeof fetch;
    const blob = await fetchFile("https://scontent.cdninstagram.com/v/a.jpg?x=1", fake);
    expect(blob.size).toBe(3);
    expect(calls[1]).toBe(`${RELAY_URL}/media?u=${encodeURIComponent("https://scontent.cdninstagram.com/v/a.jpg?x=1")}`);
    await expect(fetchFile("https://evil.com/a.jpg", fake)).rejects.toThrow(/Unexpected media host/);
  });
});

describe("relay lookups", () => {
  it("/tweet accepts only numeric ids and calls X's public embed data", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ __typename: "Tweet", id_str: "20" }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    expect((await call("/tweet?id=abc")).status).toBe(400);
    expect((await call("/tweet?id=1;rm")).status).toBe(400);
    const r = await call("/tweet?id=20");
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=20&lang=en&token=/);
  });

  it("/redgifs accepts only letter ids and retries once with a fresh token", async () => {
    let gifCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      if (String(u).includes("/auth/temporary")) return new Response(JSON.stringify({ token: "t" }));
      gifCalls++;
      return gifCalls === 1 ? new Response("", { status: 401 }) : new Response(JSON.stringify({ gif: { id: "abcdef" } }));
    }));
    expect((await call("/redgifs?id=abc123")).status).toBe(400);
    const r = await call("/redgifs?id=abcdef");
    expect(r.status).toBe(200);
    expect(gifCalls).toBe(2);
  });

  it("sends pixiv's Referer only to pixiv's image server", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", f);
    await call(media("https://i.pximg.net/img-original/img/2024/01/01/00/00/00/1_p0.jpg"));
    expect(((f.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> }).headers.Referer).toBe("https://www.pixiv.net/");
    await call(media("https://pbs.twimg.com/media/A.jpg"));
    expect(((f.mock.calls[1] as unknown[])[1] as { headers: Record<string, string> }).headers.Referer).toBeUndefined();
  });
});

describe("relay: Pixiv and Snapchat", () => {
  it("/pixiv accepts only numeric ids and adds ugoira data", async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify({ error: false, body: String(u).endsWith("/ugoira_meta") ? { frames: [{ file: "0.jpg", delay: 100 }] } : { illustType: 2, pageCount: 1 } })));
    vi.stubGlobal("fetch", f);
    expect((await call("/pixiv?id=abc")).status).toBe(400);
    const r = await call("/pixiv?id=44298467");
    expect(r.status).toBe(200);
    expect((await r.json()).ugoira.frames).toHaveLength(1);
    expect(((f.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> }).headers.Referer).toBe("https://www.pixiv.net/");
  });

  it("/snapchat only fetches snapchat.com and extracts link-preview metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<html><head><meta property="og:video:width" content="540"/><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://bolt-gcdn.sc-cdn.net/y/a.mp4"}</script></head></html>`, { headers: { "content-type": "text/html" } })));
    expect((await call("/snapchat?url=" + encodeURIComponent("https://evil.com/x"))).status).toBe(400);
    expect((await call("/snapchat?url=" + encodeURIComponent("http://www.snapchat.com/x"))).status).toBe(400);
    const r = await call("/snapchat?url=" + encodeURIComponent("https://www.snapchat.com/spotlight/ABC"));
    const j = await r.json();
    expect(j.ld[0].contentUrl).toBe("https://bolt-gcdn.sc-cdn.net/y/a.mp4");
    expect(j.og["video:width"]).toBe("540");
  });

  it("relays Pixiv ugoira ZIPs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { headers: { "content-type": "application/zip" } })));
    expect((await call(media("https://i.pximg.net/img-zip-ugoira/img/x_ugoira600x600.zip"))).status).toBe(200);
  });
});
