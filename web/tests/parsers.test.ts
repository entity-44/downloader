import { describe, expect, it } from "vitest";
import { mediaIdToShortcode, parseInstagramHtml, parseInstagramJson, parseInstagramUrl, shortcodeToMediaId } from "../src/lib/instagram";
import { parseDashManifest, parseRedditJson, parseRedditUrl, resolveVreddit } from "../src/lib/reddit";
import { bookmarkletHref, bookmarkletSource } from "../src/lib/bookmarklet";
import { buildMetadataIndex, fixMojibake, lookupMeta } from "../src/lib/metadata";
import { normalizeEntryPath } from "../src/lib/archive";
import { sniff } from "../src/lib/sniff";
import { postFilename, sanitize } from "../src/lib/files";
import { isTrustedMessage, TRUSTED_ORIGINS } from "../src/lib/bridge";

const CDN = "https://scontent-lax3-1.cdninstagram.com/v/t51";
/** The Shortcut returns a link to the paste page with the data inside it. */
const decodeShortcut = (link: string) => {
  expect(link.startsWith("https://entity-44.github.io/downloader/?paste=")).toBe(true);
  // Only one address for Shortcuts to find: the data is letters, digits, "-" and "_".
  expect(/^[A-Za-z0-9_-]+$/.test(link.split("?paste=")[1])).toBe(true);
  const b64 = link.split("?paste=")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
};

describe("Instagram", () => {
  it("parses post/reel/story-adjacent URLs", () => {
    expect(parseInstagramUrl("https://www.instagram.com/p/CxYz123AbC/?igsh=1")).toMatchObject({ kind: "post", shortcode: "CxYz123AbC" });
    expect(parseInstagramUrl("instagram.com/reels/C9abcDEF12")).toMatchObject({ kind: "reel", canonicalUrl: "https://www.instagram.com/reel/C9abcDEF12/" });
    expect(parseInstagramUrl("https://www.instagram.com/someone/p/CxYz123AbC/")?.shortcode).toBe("CxYz123AbC");
    expect(parseInstagramUrl("https://evil.com/p/CxYz123AbC/")).toBeNull();
    expect(parseInstagramUrl("https://instagram.com.evil.com/p/CxYz123AbC/")).toBeNull();
  });

  it("converts shortcodes to media ids and back", () => {
    expect(shortcodeToMediaId("B")).toBe("1");
    expect(shortcodeToMediaId("BA")).toBe("64");
    const id = shortcodeToMediaId("CxYz123AbC");
    expect(mediaIdToShortcode(id)).toBe("CxYz123AbC");
    // Private-post shortcodes are longer; only the first 11 chars encode the id.
    expect(shortcodeToMediaId("CxYz123AbCdEXTRASTUFFFORPRIVATEPOSTS")).toBe(shortcodeToMediaId("CxYz123AbCd"));
  });

  const v1 = {
    items: [
      {
        pk: "3312345678901234567",
        code: "CARO00001xy",
        media_type: 8,
        taken_at: 1709467200,
        caption: { text: "Weekend 🌊" },
        user: { username: "someone" },
        carousel_media: [
          { pk: "1", media_type: 1, image_versions2: { candidates: [{ url: `${CDN}/small.jpg`, width: 320, height: 320 }, { url: `${CDN}/big.jpg`, width: 1440, height: 1440 }, { url: `${CDN}/tiny.jpg`, width: 150, height: 150 }] } },
          { pk: "2", media_type: 2, video_duration: 12.4, image_versions2: { candidates: [{ url: `${CDN}/vthumb.jpg`, width: 640, height: 1136 }] }, video_versions: [{ url: `${CDN}/low.mp4`, width: 480, height: 852 }, { url: `${CDN}/high.mp4`, width: 720, height: 1280 }] },
        ],
      },
    ],
    num_results: 1,
  };

  it("parses the v1 API response (carousel)", () => {
    const p = parseInstagramJson(v1);
    expect(p).toMatchObject({ platform: "instagram", id: "CARO00001xy", author: "someone", caption: "Weekend 🌊", url: "https://www.instagram.com/p/CARO00001xy/" });
    expect(p.takenAt).toBe("2024-03-03T12:00:00.000Z");
    expect(p.items).toMatchObject([
      { kind: "IMAGE", url: `${CDN}/big.jpg`, width: 1440, height: 1440, thumbUrl: `${CDN}/big.jpg` },
      { kind: "VIDEO", url: `${CDN}/high.mp4`, width: 720, height: 1280, thumbUrl: `${CDN}/vthumb.jpg`, durationSec: 12.4 },
    ]);
    // Every size is offered, largest (HD) first; the default download is the first.
    expect(p.items[0].variants?.map((v) => v.width)).toEqual([1440, 320, 150]);
    expect(p.items[1].variants?.map((v) => v.url)).toEqual([`${CDN}/high.mp4`, `${CDN}/low.mp4`]);
    expect(p.items[0].variants?.[0].url).toBe(p.items[0].url);
  });

  it("parses single reels and GraphQL shapes", () => {
    const reel = parseInstagramJson({ items: [{ code: "REEL00001", media_type: 2, user: { username: "me" }, video_versions: [{ url: `${CDN}/r.mp4`, width: 720 }], image_versions2: { candidates: [{ url: `${CDN}/t.jpg`, width: 640 }] } }] });
    expect(reel.items).toHaveLength(1);
    expect(reel.items[0].kind).toBe("VIDEO");
    const gql = parseInstagramJson({ data: { xdt_shortcode_media: { shortcode: "GQL000001", owner: { username: "g" }, taken_at_timestamp: 1700000000, edge_media_to_caption: { edges: [{ node: { text: "hi" } }] }, edge_sidecar_to_children: { edges: [{ node: { display_url: `${CDN}/a.jpg`, dimensions: { width: 1080, height: 1080 } } }, { node: { is_video: true, video_url: `${CDN}/b.mp4`, display_url: `${CDN}/b.jpg` } }] } } } });
    expect(gql).toMatchObject({ id: "GQL000001", author: "g", caption: "hi" });
    expect(gql.items.map((i) => i.kind)).toEqual(["IMAGE", "VIDEO"]);
  });

  it("finds the right post inside a pasted page source", () => {
    const html = `<html><script type="application/json" data-sjs>{"require":[["x",{"__bbox":{"result":{"data":{"xdt_api__v1__media__shortcode__web_info":${JSON.stringify(v1)}}}}}]]}</script></html>`;
    expect(parseInstagramHtml(html, "CARO00001xy").items).toHaveLength(2);
    expect(() => parseInstagramHtml("<html>nothing</html>")).toThrow(/Couldn't find/);
  });
});

describe("Reddit", () => {
  it("parses Reddit URLs", () => {
    expect(parseRedditUrl("https://www.reddit.com/r/videos/comments/1abc2de/some_title/")).toMatchObject({ kind: "post", id: "1abc2de" });
    expect(parseRedditUrl("https://old.reddit.com/r/x/comments/1ABC2DE/")).toMatchObject({ kind: "post", id: "1abc2de" });
    expect(parseRedditUrl("https://redd.it/1abc2de")).toMatchObject({ kind: "post", id: "1abc2de" });
    expect(parseRedditUrl("https://v.redd.it/abcdef12345")).toMatchObject({ kind: "vreddit", videoId: "abcdef12345" });
    expect(parseRedditUrl("https://www.reddit.com/r/pics/s/AbCdEf")).toMatchObject({ kind: "share" });
    expect(parseRedditUrl("https://reddit.com.evil.com/comments/abc/")).toBeNull();
    expect(parseRedditUrl("https://evil.com/r/x/comments/abc123/")).toBeNull();
  });

  const listing = (data: object) => [{ kind: "Listing", data: { children: [{ kind: "t3", data: { id: "1abc2de", permalink: "/r/videos/comments/1abc2de/t/", author: "op", subreddit: "videos", created_utc: 1700000000, title: "Cool clip", ...data } }] } }, { kind: "Listing", data: { children: [] } }];

  it("parses a video post with a separate audio track", () => {
    const p = parseRedditJson(listing({ is_video: true, secure_media: { reddit_video: { fallback_url: "https://v.redd.it/vid123/DASH_720.mp4?source=fallback", dash_url: "https://v.redd.it/vid123/DASHPlaylist.mpd?a=1&amp;v=1", has_audio: true, width: 1280, height: 720, duration: 31 } }, preview: { images: [{ source: { url: "https://preview.redd.it/x.jpg?a=1&amp;b=2", width: 1280, height: 720 } }] } }));
    expect(p).toMatchObject({ platform: "reddit", id: "1abc2de", author: "op", title: "Cool clip", url: "https://www.reddit.com/r/videos/comments/1abc2de/t/" });
    expect(p.items[0]).toMatchObject({ kind: "VIDEO", url: "https://v.redd.it/vid123/DASH_720.mp4", dashUrl: "https://v.redd.it/vid123/DASHPlaylist.mpd", hasAudio: true, durationSec: 31, thumbUrl: "https://preview.redd.it/x.jpg?a=1&b=2" });
  });

  it("parses galleries (images + animated) in order", () => {
    const p = parseRedditJson(listing({ is_gallery: true, gallery_data: { items: [{ media_id: "aaa" }, { media_id: "bbb" }, { media_id: "ccc" }] }, media_metadata: { aaa: { status: "valid", e: "Image", m: "image/jpg", s: { u: "https://preview.redd.it/aaa.jpg?x=1&amp;y=2", x: 2000, y: 1500 } }, bbb: { status: "valid", e: "AnimatedImage", m: "image/gif", s: { mp4: "https://preview.redd.it/bbb.gif?format=mp4&amp;s=1", x: 400, y: 300 } }, ccc: { status: "valid", e: "Image", m: "image/png", s: { x: 10, y: 10 } } } }));
    expect(p.items.map((i) => [i.kind, i.url])).toEqual([
      ["IMAGE", "https://i.redd.it/aaa.jpg"],
      ["VIDEO", "https://preview.redd.it/bbb.gif?format=mp4&s=1"],
      ["IMAGE", "https://i.redd.it/ccc.png"],
    ]);
  });

  it("parses image posts, crossposts and external links", () => {
    expect(parseRedditJson(listing({ post_hint: "image", url_overridden_by_dest: "https://i.redd.it/pic.jpeg" })).items[0]).toMatchObject({ kind: "IMAGE", url: "https://i.redd.it/pic.jpeg" });
    const cross = parseRedditJson(listing({ crosspost_parent_list: [{ id: "orig", is_video: true, secure_media: { reddit_video: { fallback_url: "https://v.redd.it/orig/DASH_480.mp4", has_audio: false } } }] }));
    expect(cross.items[0]).toMatchObject({ url: "https://v.redd.it/orig/DASH_480.mp4", hasAudio: false });
    const ext = parseRedditJson(listing({ url: "https://www.youtube.com/watch?v=x", domain: "youtube.com" }));
    expect(ext.items).toHaveLength(0);
    expect(ext.notes?.[0]).toMatch(/youtube\.com/);
    expect(() => parseRedditJson({})).toThrow();
  });

  it("parses DASH manifests (new and legacy formats)", () => {
    const modern = `<?xml version="1.0"?><MPD><Period><AdaptationSet contentType="video" mimeType="video/mp4"><Representation bandwidth="1200000" height="480" width="854" id="1"><BaseURL>DASH_480.mp4</BaseURL></Representation><Representation bandwidth="4000000" height="1080" width="1920" id="2"><BaseURL>DASH_1080.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4"><Representation bandwidth="64000" id="3"><BaseURL>DASH_AUDIO_64.mp4</BaseURL></Representation><Representation bandwidth="128000" id="4"><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
    const t = parseDashManifest(modern, "https://v.redd.it/vid123/DASHPlaylist.mpd");
    expect(t.videos[0]).toEqual({ url: "https://v.redd.it/vid123/DASH_1080.mp4", height: 1080, width: 1920, bandwidth: 4000000 });
    expect(t.audios[0].url).toBe("https://v.redd.it/vid123/DASH_AUDIO_128.mp4");
    const legacy = `<MPD><Period><AdaptationSet><Representation height="720" bandwidth="2000" mimeType="video/mp4"><BaseURL>DASH_720</BaseURL></Representation></AdaptationSet><AdaptationSet><Representation mimeType="audio/mp4" bandwidth="100"><BaseURL>audio</BaseURL></Representation></AdaptationSet></Period></MPD>`;
    const l = parseDashManifest(legacy, "https://v.redd.it/old1/DASHPlaylist.mpd");
    expect(l.videos[0].url).toBe("https://v.redd.it/old1/DASH_720");
    expect(l.audios[0].url).toBe("https://v.redd.it/old1/audio");
  });

  it("resolves v.redd.it links via the manifest", async () => {
    const fake = (async () => new Response(`<MPD><AdaptationSet contentType="video"><Representation height="720" bandwidth="1"><BaseURL>DASH_720.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation bandwidth="1"><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet></MPD>`)) as typeof fetch;
    const p = await resolveVreddit("abc123xyz", fake);
    expect(p.items[0]).toMatchObject({ url: "https://v.redd.it/abc123xyz/DASH_720.mp4", hasAudio: true });
    const gone = (async () => new Response("", { status: 403 })) as typeof fetch;
    await expect(resolveVreddit("abc123xyz", gone)).rejects.toThrow(/unavailable/);
  });
});

describe("bookmarklet", () => {
  it("is valid single-line JavaScript bound to the app origin", () => {
    const src = bookmarkletSource("https://entity-44.github.io/downloader/");
    expect(src).not.toContain("\n");
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('"https://entity-44.github.io"');
    expect(src).toContain('"https://entity-44.github.io/downloader/"');
    // Replies only to the app origin, never "*".
    expect(src).not.toMatch(/postMessage\([^)]*"\*"/);
    // Only fetches from media CDNs on request.
    expect(src).toContain("cdninstagram");
    const href = bookmarkletHref("https://entity-44.github.io/downloader/");
    expect(href.startsWith("javascript:")).toBe(true);
    expect(decodeURIComponent(href.slice(11))).toBe(src);
  });
});

describe("message bridge", () => {
  it("accepts only trusted origins from the opener", () => {
    const opener = {} as Window;
    const ok = { source: opener, origin: "https://www.instagram.com", data: { type: "keepsake:post" } } as unknown as MessageEvent;
    expect(isTrustedMessage(ok, opener)).toBe(true);
    expect(isTrustedMessage({ ...ok, origin: "https://evil.com" } as MessageEvent, opener)).toBe(false);
    expect(isTrustedMessage({ ...ok, source: {} } as unknown as MessageEvent, opener)).toBe(false);
    expect(isTrustedMessage({ ...ok, data: "x" } as unknown as MessageEvent, opener)).toBe(false);
    expect(isTrustedMessage(ok, null)).toBe(false);
    expect([...TRUSTED_ORIGINS].every((o) => o.startsWith("https://"))).toBe(true);
  });
});

describe("export metadata & helpers", () => {
  it("indexes Instagram export JSON", () => {
    const idx = buildMetadataIndex(new Map<string, unknown>([["your_instagram_activity/content/posts_1.json", [{ media: [{ uri: "media/posts/202301/a.jpg", creation_timestamp: 1672600000 }], title: "CafÃ©" }]]]));
    expect(lookupMeta(idx, "root/media/posts/202301/a.jpg")).toMatchObject({ caption: "Café", category: "post" });
    expect(fixMojibake("ð\u009f\u008e\u0089")).toBe("🎉");
  });
  it("rejects unsafe archive paths", () => {
    expect(normalizeEntryPath("media/posts/a.jpg")).toBe("media/posts/a.jpg");
    expect(normalizeEntryPath("../x.jpg")).toBeNull();
    expect(normalizeEntryPath("/abs.jpg")).toBeNull();
  });
  it("sniffs media and builds safe names", () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniff(new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypisom")]))?.kind).toBe("VIDEO");
    expect(sniff(new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("moof")]))?.kind).toBe("VIDEO");
    expect(sniff(new TextEncoder().encode("<html>"))).toBeNull();
    expect(postFilename({ platform: "reddit", author: "op", id: "1abc2de", takenAt: "2023-11-14T22:13:20Z", index: 0, total: 2, ext: "mp4" })).toBe("keepsake_reddit_op_1abc2de_2023-11-14_01.mp4");
    expect(sanitize("../../a b/c")).toBe("a_b_c");
  });
});

import { parseInstagramProfile, parseInstagramReel } from "../src/lib/instagram";

describe("Instagram highlights, stories and profiles", () => {
  const item = (pk: string, video = false) => ({
    pk,
    media_type: video ? 2 : 1,
    taken_at: 1709467200 + Number(pk),
    image_versions2: { candidates: [{ url: `${CDN}/${pk}.jpg`, width: 1080, height: 1920 }] },
    ...(video ? { video_versions: [{ url: `${CDN}/${pk}.mp4`, width: 720, height: 1280 }] } : {}),
  });

  it("saves every item of a highlight", () => {
    const raw = { reels: { "highlight:17900000000000000": { id: "highlight:17900000000000000", title: "Summer", user: { username: "me" }, items: [item("1"), item("2", true), item("3")] } } };
    const p = parseInstagramReel(raw, "highlight_17900000000000000", "https://www.instagram.com/stories/highlights/17900000000000000/");
    expect(p).toMatchObject({ id: "highlight_17900000000000000", author: "me", title: "Highlight: Summer" });
    expect(p.items.map((i) => i.kind)).toEqual(["IMAGE", "VIDEO", "IMAGE"]);
    expect(p.items[1].url).toBe(`${CDN}/2.mp4`);
  });

  it("handles the reels_media shape and expired trays", () => {
    const p = parseInstagramReel({ reels_media: [{ user: { username: "friend" }, items: [item("5")] }] }, "stories_friend", "https://www.instagram.com/stories/friend/");
    expect(p).toMatchObject({ author: "friend", title: "Current stories" });
    expect(() => parseInstagramReel({ reels: {} }, "stories_x", "")).toThrow(/expired/);
  });

  it("picks the full-size profile picture", () => {
    const raw = {
      profile: { data: { user: { username: "someone", full_name: "Some One", profile_pic_url_hd: `${CDN}/320.jpg` } } },
      info: { user: { username: "someone", hd_profile_pic_url_info: { url: `${CDN}/1080.jpg`, width: 1080, height: 1080 }, hd_profile_pic_versions: [{ url: `${CDN}/640.jpg`, width: 640, height: 640 }] } },
    };
    const p = parseInstagramProfile(raw, "someone", "https://www.instagram.com/someone/");
    expect(p).toMatchObject({ id: "profile_someone", title: "Profile picture: Some One" });
    expect(p.items).toEqual([{ kind: "IMAGE", url: `${CDN}/1080.jpg`, width: 1080, height: 1080 }]);
    // Falls back to the 320px picture when the detailed info isn't available.
    expect(parseInstagramProfile({ profile: raw.profile, info: null }, "someone", "").items[0].url).toBe(`${CDN}/320.jpg`);
    expect(() => parseInstagramProfile({}, "x", "")).toThrow();
  });
});

describe("bookmarklet page detection", () => {
  // Runs the real bookmarklet against a fake page and records which endpoints it calls.
  async function run(pathname: string, responses: Record<string, unknown> = {}, pageScripts: string[] = []) {
    const calls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    let opened: string | null = null;
    const toastEl = { style: {}, remove() {}, textContent: "" } as unknown as HTMLElement & { _t?: number };
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, window: g.window, fetch: g.fetch };
    g.location = { hostname: "www.instagram.com", pathname, href: `https://www.instagram.com${pathname}` };
    g.document = { cookie: "csrftoken=abc123", querySelectorAll: () => pageScripts.map((t) => ({ textContent: t })), getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} }, documentElement: { outerHTML: "<html></html>" } };
    const win = { postMessage() {} };
    let listener: ((e: unknown) => Promise<void>) | null = null;
    g.window = { open: (u: string) => ((opened = u), win), addEventListener: (_: string, fn: (e: unknown) => Promise<void>) => (listener = fn) };
    g.fetch = async (u: string, init?: { headers?: Record<string, string> }) => {
      calls.push(u);
      headers.push(init?.headers ?? {});
      const key = Object.keys(responses).find((k) => u.includes(k));
      return key ? new Response(JSON.stringify(responses[key])) : new Response("{}", { status: 404 });
    };
    try {
      await new Function(`return (async () => { ${bookmarkletSource("https://entity-44.github.io/downloader/").replace(/^\(async\s*\(\)\s*=>\s*\{/, "").replace(/\}\)\(\);$/, "")} })()`)();
      await (listener as ((e: unknown) => Promise<void>) | null)?.({ source: win, origin: "https://entity-44.github.io", data: { type: "keepsake:ready" } });
    } finally {
      Object.assign(g, saved);
    }
    return { calls, headers, opened, toast: toastEl.textContent };
  }

  it("reads highlights via the story-tray endpoint", async () => {
    const r = await run("/stories/highlights/17900000000000000/", { "reel_ids=highlight:17900000000000000": { reels: {} } });
    expect(r.calls).toEqual(["/api/v1/feed/reels_media/?reel_ids=highlight:17900000000000000"]);
    expect(r.opened).toBe("https://entity-44.github.io/downloader/#/receive");
  });

  it("reads a single story by its id", async () => {
    const r = await run("/stories/someone/3312345678901234567/", { "/media/": { items: [] } });
    expect(r.calls).toEqual(["/api/v1/media/3312345678901234567/info/"]);
  });

  it("reads all current stories when no story id is in the address", async () => {
    const r = await run("/stories/someone/", { web_profile_info: { data: { user: { id: "42" } } }, "reel_ids=42": { reels: {} } });
    expect(r.calls).toEqual(["/api/v1/users/web_profile_info/?username=someone", "/api/v1/feed/reels_media/?reel_ids=42"]);
  });

  it("reads full-size profile pictures on profile pages", async () => {
    const r = await run("/someone/", { web_profile_info: { data: { user: { id: "42" } } }, "/users/42/info/": { user: {} } });
    expect(r.calls).toEqual(["/api/v1/users/web_profile_info/?username=someone", "/api/v1/users/42/info/"]);
  });

  it("refuses non-content pages", async () => {
    const r = await run("/explore/");
    expect(r.calls).toEqual([]);
    expect(r.calls).toEqual([]);
    expect(r.toast).toMatch(/Open a post, reel, story, highlight or profile/);
  });
});

describe("avoiding Instagram's spam flag", () => {
  async function runPage(pathname: string, responses: Record<string, unknown>, pageScripts: string[] = []) {
    const calls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    let opened: string | null = null;
    const toastEl = { style: {}, remove() {}, textContent: "" } as unknown as HTMLElement;
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, window: g.window, fetch: g.fetch };
    g.location = { hostname: "www.instagram.com", pathname, href: `https://www.instagram.com${pathname}` };
    g.document = { cookie: "csrftoken=abc123; other=1", querySelectorAll: () => pageScripts.map((t) => ({ textContent: t })), getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} }, documentElement: { outerHTML: "<html></html>" } };
    const win = { postMessage() {} };
    let listener: ((e: unknown) => Promise<void>) | null = null;
    g.window = { open: (u: string) => ((opened = u), win), addEventListener: (_: string, fn: (e: unknown) => Promise<void>) => (listener = fn) };
    g.fetch = async (u: string, init?: { headers?: Record<string, string> }) => {
      calls.push(u);
      headers.push(init?.headers ?? {});
      const key = Object.keys(responses).find((k) => u.includes(k));
      return key ? new Response(JSON.stringify(responses[key])) : new Response("{}", { status: 404 });
    };
    try {
      await new Function(`return (async () => { ${bookmarkletSource("https://entity-44.github.io/downloader/").replace(/^\(async\s*\(\)\s*=>\s*\{/, "").replace(/\}\)\(\);$/, "")} })()`)();
      await (listener as ((e: unknown) => Promise<void>) | null)?.({ source: win, origin: "https://entity-44.github.io", data: { type: "keepsake:ready" } });
    } finally {
      Object.assign(g, saved);
    }
    return { calls, headers, opened, toast: (toastEl as unknown as { textContent: string }).textContent };
  }

  it("uses post data already on the page without sending any request", async () => {
    const embedded = JSON.stringify({ require: [{ items: [{ code: "CxYz123AbC", media_type: 1, image_versions2: { candidates: [{ url: `${CDN}/a.jpg`, width: 1080 }] } }] }] });
    const r = await runPage("/p/CxYz123AbC/", {}, ["{\"unrelated\":true}", embedded]);
    expect(r.calls).toEqual([]);
    expect(r.opened).toBe("https://entity-44.github.io/downloader/#/receive");
  });

  it("sends Instagram's own web headers when it must make a request", async () => {
    const r = await runPage("/p/CxYz123AbC/", { "/media/": { items: [] } });
    expect(r.calls).toHaveLength(1);
    expect(r.headers[0]).toMatchObject({ "x-ig-app-id": "936619743392459", "x-csrftoken": "abc123", "x-requested-with": "XMLHttpRequest" });
    expect(r.calls[0]).not.toContain("__a=1");
  });

  it("stops immediately (no retry, no tab) when Instagram answers spam:true", async () => {
    const r = await runPage("/stories/highlights/1790/", { reels_media: { message: "", spam: true, status: "fail" } });
    expect(r.calls).toHaveLength(1);
    expect(r.toast).toMatch(/flagged that request as automated/);
  });

  it("explains a pasted spam response; ?__a=1 only appears as the opt-in data link", async () => {
    const { parsePastedInstagram, dataLinks } = await import("../src/lib/resolve");
    expect(() => parsePastedInstagram('{"message":"","spam":true,"status":"fail"}')).toThrow(/flagged that page as automated/);
    const links = dataLinks({ kind: "post", shortcode: "CxYz123AbC", canonicalUrl: "" });
    // The default route never uses ?__a=1; it is only the opt-in Data link.
    expect(links.pageSource).not.toContain("__a=1");
    expect(links.data).toBe("https://www.instagram.com/p/CxYz123AbC/?__a=1&__d=dis");
    expect(links.pageSource).toBe("view-source:https://www.instagram.com/p/CxYz123AbC/");
  });
});

describe("pasted story and highlight links", () => {
  it("parses story and highlight URLs", async () => {
    const { parseStoryUrl } = await import("../src/lib/instagram");
    expect(parseStoryUrl("https://www.instagram.com/stories/some.one/3312345678901234567/?utm_source=ig_story_item_share")).toEqual({ kind: "story", username: "some.one", storyId: "3312345678901234567", canonicalUrl: "https://www.instagram.com/stories/some.one/3312345678901234567/" });
    expect(parseStoryUrl("instagram.com/stories/highlights/17900000000000000/")).toMatchObject({ kind: "highlight", highlightId: "17900000000000000" });
    expect(parseStoryUrl("https://www.instagram.com/stories/someone/")).toMatchObject({ kind: "story", storyId: undefined });
    expect(parseStoryUrl("https://evil.com/stories/x/1/")).toBeNull();
  });

  it("offers the copy-and-paste steps for stories instead of refusing", async () => {
    const { resolveInput, NeedsGuidedPaste, dataLinks } = await import("../src/lib/resolve");
    const err = await resolveInput("https://www.instagram.com/stories/someone/3312345678901234567/").catch((e) => e);
    expect(err).toBeInstanceOf(NeedsGuidedPaste);
    expect(dataLinks(err.link).pageSource).toBe("view-source:https://www.instagram.com/stories/someone/3312345678901234567/");
  });

  const story = (pk: string, video = false) => ({ pk, id: `${pk}_42`, media_type: video ? 2 : 1, taken_at: 1709467200, user: { username: "someone" }, image_versions2: { candidates: [{ url: `${CDN}/s${pk}.jpg`, width: 1080 }] }, ...(video ? { video_versions: [{ url: `${CDN}/s${pk}.mp4`, width: 720 }] } : {}) });
  const page = (data: unknown) => `<html><script type="application/json" data-sjs>${JSON.stringify({ require: [["x", { result: data }]] })}</script></html>`;

  it("picks the exact story by id from a pasted page source", async () => {
    const { parsePastedInstagram } = await import("../src/lib/resolve");
    const { parseStoryUrl } = await import("../src/lib/instagram");
    const link = parseStoryUrl("https://www.instagram.com/stories/someone/222/")!;
    const p = parsePastedInstagram(page({ reels_media: [{ user: { username: "someone" }, items: [story("111"), story("222", true), story("333")] }] }), link);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ kind: "VIDEO", url: `${CDN}/s222.mp4` });
    expect(p.id).toBe("story_222");
  });

  it("returns every item for highlights and explains when the page has no media", async () => {
    const { parsePastedInstagram } = await import("../src/lib/resolve");
    const { parseStoryUrl } = await import("../src/lib/instagram");
    const hl = parseStoryUrl("https://www.instagram.com/stories/highlights/1790/")!;
    expect(parsePastedInstagram(page({ data: { items: [story("1"), story("2")] , title: "Trip" } }), hl).items).toHaveLength(2);
    expect(() => parsePastedInstagram(page({ nothing: true }), hl)).toThrow(/didn't include the story's media/);
  });
});

describe("iOS Shortcut", () => {
  async function runShortcut(pathname: string, pageScripts: string[] = [], responses: Record<string, unknown> = {}) {
    const calls: string[] = [];
    let result: string | null = null;
    const toastEl = { style: {}, remove() {}, textContent: "" } as unknown as HTMLElement;
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, fetch: g.fetch, completion: g.completion };
    g.location = { hostname: "www.instagram.com", pathname, href: `https://www.instagram.com${pathname}` };
    g.document = { cookie: "", querySelectorAll: () => pageScripts.map((t) => ({ textContent: t })), getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} }, documentElement: { outerHTML: "<html></html>" } };
    g.fetch = async (u: string) => {
      calls.push(u);
      const key = Object.keys(responses).find((k) => u.includes(k));
      return key ? new Response(JSON.stringify(responses[key])) : new Response("{}", { status: 404 });
    };
    const { shortcutSource } = await import("../src/lib/bookmarklet");
    try {
      await new Promise<void>((resolve) => {
        g.completion = () =>
          setTimeout(() => {
            result = String((g.location as { href: string }).href);
            resolve();
          }, 120);
        new Function(shortcutSource())();
      });
    } finally {
      Object.assign(g, saved);
    }
    return { calls, result: decodeShortcut(result!) };
  }

  it("returns page data the site can parse, without sending requests", async () => {
    const embedded = JSON.stringify({ items: [{ code: "CxYz123AbC", media_type: 1, user: { username: "me" }, image_versions2: { candidates: [{ url: `${CDN}/a.jpg`, width: 1080 }] } }] });
    const { calls, result } = await runShortcut("/p/CxYz123AbC/", [embedded]);
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ keepsake: 1, platform: "instagram", kind: "post", shortcode: "CxYz123AbC" });
    const { resolveInput } = await import("../src/lib/resolve");
    const post = await resolveInput(JSON.stringify(result));
    expect(post.items[0].url).toBe(`${CDN}/a.jpg`);
  });

  it("returns readable errors (e.g. spam flag) instead of failing silently", async () => {
    const { result } = await runShortcut("/stories/highlights/1790/", [], { reels_media: { spam: true, status: "fail" } });
    expect(result.error).toMatch(/flagged that request as automated/);
    const { resolveInput } = await import("../src/lib/resolve");
    await expect(resolveInput(JSON.stringify(result))).rejects.toThrow(/flagged/);
  });

  it("is valid single-line code with no app-specific secrets", async () => {
    const { shortcutSource } = await import("../src/lib/bookmarklet");
    const src = shortcutSource();
    expect(src).not.toContain("\n");
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain("completion(");
  });
});

describe("quality options", () => {
  it("lists every Reddit resolution from the manifest, best first", async () => {
    const { redditVideoVariants } = await import("../src/lib/reddit");
    const mpd = `<MPD><AdaptationSet contentType="video"><Representation height="480" bandwidth="1"><BaseURL>DASH_480.mp4</BaseURL></Representation><Representation height="1080" bandwidth="3"><BaseURL>DASH_1080.mp4</BaseURL></Representation><Representation height="720" bandwidth="2"><BaseURL>DASH_720.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation bandwidth="1"><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet></MPD>`;
    const v = await redditVideoVariants("https://v.redd.it/x1/DASHPlaylist.mpd", (async () => new Response(mpd)) as typeof fetch);
    expect(v.map((x) => x.height)).toEqual([1080, 720, 480]);
    expect(v[0].url).toBe("https://v.redd.it/x1/DASH_1080.mp4");
  });

  it("downloads the chosen size instead of the default", async () => {
    const { downloadItem } = await import("../src/lib/fetchmedia");
    const seen: string[] = [];
    const g = globalThis as unknown as { fetch: typeof fetch };
    const saved = g.fetch;
    g.fetch = (async (u: string) => {
      seen.push(String(u));
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    try {
      await downloadItem({ kind: "IMAGE", url: `${CDN}/big.jpg` }, undefined, `${CDN}/small.jpg`);
    } finally {
      g.fetch = saved;
    }
    expect(seen).toEqual([`${CDN}/small.jpg`]);
  });
});

describe("stories: page data, then request, then on-screen fallback", () => {
  type El = Record<string, unknown>;
  async function runWith(pathname: string, dom: { scripts?: string[]; videos?: El[]; imgs?: El[] }, responses: Record<string, unknown> = {}) {
    const calls: string[] = [];
    let opened: string | null = null;
    let posted: Record<string, unknown> | null = null;
    let listener: ((e: unknown) => void) | null = null;
    const toastEl = { style: {}, remove() {}, textContent: "" } as unknown as HTMLElement;
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, window: g.window, fetch: g.fetch };
    const win = { postMessage: (m: Record<string, unknown>) => (posted = m) };
    g.location = { hostname: "www.instagram.com", pathname, href: `https://www.instagram.com${pathname}` };
    g.document = {
      cookie: "",
      querySelectorAll: (sel: string) => (sel === "video" ? dom.videos ?? [] : sel === "img" ? dom.imgs ?? [] : (dom.scripts ?? []).map((t) => ({ textContent: t }))),
      getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} }, documentElement: { outerHTML: "" },
    };
    g.window = { open: (u: string) => ((opened = u), win), addEventListener: (_: string, fn: (e: unknown) => void) => (listener = fn) };
    g.fetch = async (u: string) => {
      calls.push(u);
      const key = Object.keys(responses).find((k) => u.includes(k));
      return key ? new Response(JSON.stringify(responses[key])) : new Response("{}", { status: 404 });
    };
    try {
      await new Function(`return (async () => { ${bookmarkletSource("https://entity-44.github.io/downloader/").replace(/^\(async\s*\(\)\s*=>\s*\{/, "").replace(/\}\)\(\);$/, "")} })()`)();
      // Simulate the app saying "ready" so the bookmark hands over its data.
      await (listener as unknown as (e: unknown) => Promise<void>)?.({ source: win, origin: "https://entity-44.github.io", data: { type: "keepsake:ready" } });
    } finally {
      Object.assign(g, saved);
    }
    return { calls, opened, posted: posted as Record<string, unknown> | null, toast: (toastEl as unknown as { textContent: string }).textContent };
  }
  const bigImg = { getBoundingClientRect: () => ({ width: 390, height: 693 }), currentSrc: `${CDN}/s_640.jpg`, src: `${CDN}/s_640.jpg`, naturalWidth: 640, srcset: `${CDN}/s_640.jpg 640w, ${CDN}/s_1080.jpg 1080w` };
  const avatar = { getBoundingClientRect: () => ({ width: 32, height: 32 }), src: `${CDN}/avatar.jpg`, srcset: "" };

  it("falls back to the media on screen when the address has no story number and Instagram doesn't answer", async () => {
    const r = await runWith("/stories/someone/", { imgs: [avatar, bigImg] });
    expect(r.opened).toBe("https://entity-44.github.io/downloader/#/receive");
    expect(r.posted).toMatchObject({ kind: "screen", username: "someone", media: [{ kind: "IMAGE", url: `${CDN}/s_1080.jpg`, width: 1080 }] });
    const { parseCollected } = await import("../src/lib/incoming");
    const post = parseCollected(r.posted as never);
    expect(post.items).toEqual([{ kind: "IMAGE", url: `${CDN}/s_1080.jpg`, width: 1080, height: undefined, thumbUrl: undefined }]);
  });

  it("prefers a playable video on screen", async () => {
    const vid = { getBoundingClientRect: () => ({ width: 390, height: 693 }), currentSrc: `${CDN}/story.mp4`, videoWidth: 720, videoHeight: 1280, poster: `${CDN}/poster.jpg` };
    const r = await runWith("/stories/someone/", { videos: [vid, { currentSrc: "blob:https://www.instagram.com/x", getBoundingClientRect: () => ({ width: 390 }) }] });
    expect((r.posted?.media as El[]).map((m) => m.url)).toEqual([`${CDN}/story.mp4`]);
  });

  it("uses story data already in the page first, with no requests", async () => {
    const tray = JSON.stringify({ reels_media: [{ user: { username: "other" }, items: [{ pk: "9", image_versions2: { candidates: [{ url: `${CDN}/other.jpg`, width: 1080 }] } }] }, { user: { username: "someone" }, items: [{ pk: "1", image_versions2: { candidates: [{ url: `${CDN}/mine.jpg`, width: 1080 }] } }] }] });
    // With a story number in the address, page data is used with no requests.
    const r = await runWith("/stories/someone/1/", { scripts: [tray] });
    expect(r.calls).toEqual([]);
    const { parseCollected } = await import("../src/lib/incoming");
    const post = parseCollected(r.posted as never);
    expect(post.items[0].url).toBe(`${CDN}/mine.jpg`); // the exact story by its number
  });

  it("explains clearly when nothing can be found", async () => {
    const r = await runWith("/stories/someone/", { imgs: [avatar] });
    expect(r.posted).toMatchObject({ error: expect.stringMatching(/Let it start playing/) });
    expect(r.toast).toMatch(/Let it start playing/);
  });
});

describe("iPhone pop-up rule", () => {
  it("opens the Keepsake tab before reading anything (while the tap still counts)", async () => {
    const order: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, window: g.window, fetch: g.fetch };
    const toastEl = { style: {}, remove() {}, textContent: "" };
    g.location = { hostname: "www.instagram.com", pathname: "/p/CxYz123AbC/", href: "https://www.instagram.com/p/CxYz123AbC/" };
    g.document = { cookie: "", querySelectorAll: () => [], getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} }, documentElement: { outerHTML: "" } };
    g.window = { open: () => (order.push("open"), { postMessage() {} }), addEventListener() {} };
    g.fetch = async () => (order.push("fetch"), new Response("{}", { status: 404 }));
    try {
      await new Function(bookmarkletSource("https://entity-44.github.io/downloader/"))();
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      Object.assign(g, saved);
    }
    expect(order[0]).toBe("open");
  });
});

describe("Instagram reel qualities from the DASH manifest", () => {
  const mpd = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet contentType="video" mimeType="video/mp4"><Representation id="1" bandwidth="4000000" width="1080" height="1920"><BaseURL>${CDN}/dash_1080.mp4?a=1&amp;b=2</BaseURL></Representation><Representation id="2" bandwidth="2000000" width="720" height="1280"><BaseURL>${CDN}/dash_720.mp4</BaseURL></Representation><Representation id="3" bandwidth="900000" width="480" height="852"><BaseURL>${CDN}/dash_480.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4"><Representation id="4" bandwidth="128000"><BaseURL>${CDN}/dash_audio.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
  const reel = {
    items: [{
      code: "REELQ0001", media_type: 2, user: { username: "me" },
      image_versions2: { candidates: [{ url: `${CDN}/t.jpg`, width: 1080, height: 1920 }] },
      video_versions: [{ url: `${CDN}/muxed_720.mp4`, width: 720, height: 1280 }, { url: `${CDN}/muxed_720b.mp4`, width: 720, height: 1280 }, { url: `${CDN}/muxed_720c.mp4`, width: 720, height: 1280 }],
      video_dash_manifest: mpd,
    }],
  };

  it("lists every resolution, highest first, with audio to merge for video-only tracks", () => {
    const v = parseInstagramJson(reel).items[0].variants!;
    expect(v.map((x) => x.height)).toEqual([1920, 1280, 852]);
    expect(v[0]).toEqual({ url: `${CDN}/dash_1080.mp4?a=1&b=2`, width: 1080, height: 1920, audioUrl: `${CDN}/dash_audio.mp4` });
    expect(v[1]).toEqual({ url: `${CDN}/muxed_720.mp4`, width: 720, height: 1280 }); // ready-made file wins at 720p
    expect(v[2].audioUrl).toBe(`${CDN}/dash_audio.mp4`);
  });

  it("still works without a manifest", () => {
    const { video_dash_manifest: _ignored, ...noDash } = reel.items[0];
    expect(parseInstagramJson({ items: [noDash] }).items[0].variants).toHaveLength(1);
  });

  it("merges the separate audio track when downloading a video-only quality", async () => {
    const { downloadItem } = await import("../src/lib/fetchmedia");
    const merge = await import("../src/lib/merge");
    const seen: string[] = [];
    const g = globalThis as unknown as { fetch: typeof fetch };
    const saved = g.fetch;
    const mp4 = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypisom"), 0, 0, 0, 0]);
    g.fetch = (async (u: string) => (seen.push(String(u)), new Response(mp4, { headers: { "content-type": "video/mp4" } }))) as typeof fetch;
    const spy = (await import("vitest")).vi.spyOn(merge, "mergeAudioVideo").mockResolvedValue(new Blob(["merged"], { type: "video/mp4" }));
    try {
      const r = await downloadItem({ kind: "VIDEO", url: `${CDN}/muxed_720.mp4` }, undefined, `${CDN}/dash_1080.mp4`, `${CDN}/dash_audio.mp4`);
      expect(r.mergedAudio).toBe(true);
      expect(seen).toEqual([`${CDN}/dash_1080.mp4`, `${CDN}/dash_audio.mp4`]);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      g.fetch = saved;
      spy.mockRestore();
    }
  });
});

describe("small payloads (Shortcut clipboard)", () => {
  it("sends only the matching post, not the whole page data", async () => {
    const filler = Array.from({ length: 3000 }, (_, k) => ({ code: `OTHER${k}xx`, media_type: 1, image_versions2: { candidates: [{ url: `${CDN}/o${k}.jpg`, width: 1080 }] }, caption: { text: "x".repeat(200) } }));
    const target = { code: "TARGET0001", media_type: 1, user: { username: "me" }, image_versions2: { candidates: [{ url: `${CDN}/target.jpg`, width: 1440 }] } };
    const page = JSON.stringify({ require: [{ feed: filler, post: { items: [target] } }] });
    expect(page.length).toBeGreaterThan(1_000_000);
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, fetch: g.fetch, completion: g.completion };
    let out = "";
    g.location = { hostname: "www.instagram.com", pathname: "/p/TARGET0001/", href: "https://www.instagram.com/p/TARGET0001/" };
    const toastEl = { style: {}, remove() {}, textContent: "" };
    g.document = { cookie: "", querySelectorAll: () => [{ textContent: page }], getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} }, documentElement: { outerHTML: "" } };
    g.fetch = async () => new Response("{}", { status: 404 });
    const { shortcutSource } = await import("../src/lib/bookmarklet");
    try {
      await new Promise<void>((resolve) => {
        g.completion = () => setTimeout(() => ((out = String((g.location as { href: string }).href)), resolve()), 120);
        new Function(shortcutSource())();
      });
    } finally {
      Object.assign(g, saved);
    }
    expect(out.length).toBeLessThan(5_000);
    const { resolveInput } = await import("../src/lib/resolve");
    expect((await resolveInput(out)).items[0].url).toBe(`${CDN}/target.jpg`);
  });
});

describe("quality list cleanup", () => {
  it("hides versions without size info when sized ones exist", () => {
    const p = parseInstagramJson({ items: [{ code: "CLEAN0001", media_type: 2, video_versions: [{ url: `${CDN}/a.mp4`, width: 720, height: 1280 }, { url: `${CDN}/nosize.mp4` }] }] });
    expect(p.items[0].variants!.map((v) => v.url)).toEqual([`${CDN}/a.mp4`]);
  });
});

describe("X (Twitter)", () => {
  it("recognizes post links", async () => {
    const { parseXUrl } = await import("../src/lib/x");
    expect(parseXUrl("https://x.com/someone/status/1790000000000000000?s=20")).toEqual({ id: "1790000000000000000", canonicalUrl: "https://x.com/i/status/1790000000000000000" });
    expect(parseXUrl("twitter.com/someone/status/20/photo/1")?.id).toBe("20");
    expect(parseXUrl("https://mobile.twitter.com/a/status/123")?.id).toBe("123");
    expect(parseXUrl("https://x.com/someone")).toBeNull();
    expect(parseXUrl("https://x.com.evil.com/a/status/1")).toBeNull();
  });

  it("parses photos and videos, best video quality first", async () => {
    const { parseTweet } = await import("../src/lib/x");
    const p = parseTweet({
      __typename: "Tweet", id_str: "123", text: "hello", created_at: "2024-05-01T10:00:00.000Z", user: { screen_name: "someone" },
      mediaDetails: [
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/ABC.jpg", original_info: { width: 4000, height: 3000 } },
        { type: "video", media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/t.jpg", video_info: { duration_millis: 12500, variants: [
          { content_type: "application/x-mpegURL", url: "https://video.twimg.com/x.m3u8" },
          { bitrate: 256000, content_type: "video/mp4", url: "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/480x270/a.mp4" },
          { bitrate: 2176000, content_type: "video/mp4", url: "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/b.mp4" },
        ] } },
      ],
    }, "https://x.com/i/status/123");
    expect(p).toMatchObject({ platform: "x", author: "someone", url: "https://x.com/someone/status/123", caption: "hello" });
    expect(p.items[0]).toMatchObject({ kind: "IMAGE", url: "https://pbs.twimg.com/media/ABC.jpg?name=orig", width: 4000 });
    expect(p.items[1].variants?.map((v) => `${v.width}x${v.height}`)).toEqual(["1280x720", "480x270"]);
    expect(p.items[1]).toMatchObject({ url: "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/b.mp4", durationSec: 12.5 });
  });

  it("explains unavailable posts", async () => {
    const { parseTweet } = await import("../src/lib/x");
    expect(() => parseTweet({ __typename: "TweetTombstone" }, "")).toThrow(/isn't available publicly/);
  });
});

describe("RedGIFs", () => {
  it("recognizes links and parses HD + SD", async () => {
    const { parseRedgifsUrl, parseRedgifs } = await import("../src/lib/redgifs");
    expect(parseRedgifsUrl("https://www.redgifs.com/watch/SomeFancyName")).toEqual({ id: "somefancyname", canonicalUrl: "https://www.redgifs.com/watch/somefancyname" });
    expect(parseRedgifsUrl("https://v3.redgifs.com/watch/abcdef")?.id).toBe("abcdef");
    expect(parseRedgifsUrl("https://www.redgifs.com/ifr/abcdef")?.id).toBe("abcdef");
    expect(parseRedgifsUrl("https://redgifs.com.evil.com/watch/abc")).toBeNull();
    const p = parseRedgifs({ gif: { id: "abcdef", width: 1080, height: 1920, duration: 9, userName: "creator", createDate: 1700000000, urls: { hd: "https://media.redgifs.com/Abcdef.mp4", sd: "https://media.redgifs.com/Abcdef-mobile.mp4", poster: "https://media.redgifs.com/Abcdef-poster.jpg" } } }, "");
    expect(p).toMatchObject({ platform: "redgifs", author: "creator", url: "https://www.redgifs.com/watch/abcdef" });
    expect(p.items[0].variants?.map((v) => v.url)).toEqual(["https://media.redgifs.com/Abcdef.mp4", "https://media.redgifs.com/Abcdef-mobile.mp4"]);
    expect(p.items[0].variants?.[1]).toMatchObject({ width: 480, height: 853 });
  });
});

describe("bookmark link is plain ASCII", () => {
  it("contains no characters iPhone's bookmark field could mangle", () => {
    const href = bookmarkletHref("https://entity-44.github.io/downloader/");
    expect(/^[\x20-\x7e]+$/.test(href)).toBe(true);
    expect(decodeURIComponent(href.slice(11))).toBe(bookmarkletSource("https://entity-44.github.io/downloader/"));
    expect(href.length).toBeLessThan(9000);
  });
});

describe("story opened over a profile (address stays /username/)", () => {
  it("detects the full-screen story and saves it instead of the profile", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, fetch: g.fetch, completion: g.completion, window: g.window };
    let out = "";
    const toastEl = { style: {}, remove() {}, textContent: "" };
    const storyVideo = { currentSrc: `${CDN}/story.mp4`, videoWidth: 720, videoHeight: 1280, poster: "", paused: false, getBoundingClientRect: () => ({ width: 390, height: 700, left: 0, right: 390, top: 72, bottom: 772 }) };
    g.location = { hostname: "www.instagram.com", pathname: "/someone/", href: "https://www.instagram.com/someone/" };
    g.window = { innerWidth: 390, innerHeight: 844 };
    g.document = { cookie: "", querySelectorAll: (sel: string) => (sel.includes("video") ? [storyVideo] : []), getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} }, documentElement: { outerHTML: "" } };
    g.fetch = async () => new Response("{}", { status: 404 }); // Instagram not answering, like on the phone
    const { shortcutSource } = await import("../src/lib/bookmarklet");
    try {
      await new Promise<void>((resolve) => {
        g.completion = () => setTimeout(() => ((out = String((g.location as { href: string }).href)), resolve()), 120);
        new Function(shortcutSource())();
      });
    } finally {
      Object.assign(g, saved);
    }
    const msg = decodeShortcut(out);
    expect(msg).toMatchObject({ kind: "screen", username: "someone", media: [{ kind: "VIDEO", url: `${CDN}/story.mp4` }] });
    const { resolveInput } = await import("../src/lib/resolve");
    expect((await resolveInput(out)).items[0].url).toBe(`${CDN}/story.mp4`);
  });
});

describe("never the wrong video", () => {
  const reel = (code: string) => ({ code, media_type: 2, video_versions: [{ url: `${CDN}/${code}.mp4`, width: 720, height: 1280 }], image_versions2: { candidates: [{ url: `${CDN}/${code}.jpg`, width: 720 }] } });

  it("picks the exact reel when the page holds several", async () => {
    const { parseCollected } = await import("../src/lib/incoming");
    const page = JSON.stringify({ items: [reel("NEXTREEL01"), reel("MYREEL0001"), reel("OTHERREEL1")] });
    const p = parseCollected({ platform: "instagram", url: "https://www.instagram.com/reel/MYREEL0001/", kind: "post", shortcode: "MYREEL0001", pageJson: [page] });
    expect(p.items[0].url).toBe(`${CDN}/MYREEL0001.mp4`);
  });

  it("refuses to guess when the exact reel isn't there", async () => {
    const { parseCollected } = await import("../src/lib/incoming");
    const page = JSON.stringify({ items: [reel("NEXTREEL01")] });
    expect(() => parseCollected({ platform: "instagram", url: "", kind: "post", shortcode: "MYREEL0001", pageJson: [page] })).toThrow(/exact post/);
  });

  it("takes the story playing at the centre, not preloaded neighbours", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, fetch: g.fetch, completion: g.completion, window: g.window };
    let out = "";
    const toastEl = { style: {}, remove() {}, textContent: "" };
    const at = (left: number) => () => ({ width: 390, height: 700, left, right: left + 390, top: 72, bottom: 772 });
    const prev = { currentSrc: `${CDN}/prev.mp4`, paused: true, getBoundingClientRect: at(-390) };
    const current = { currentSrc: `${CDN}/current.mp4`, paused: false, videoWidth: 720, videoHeight: 1280, getBoundingClientRect: at(0) };
    const next = { currentSrc: `${CDN}/next.mp4`, paused: true, getBoundingClientRect: at(390) };
    g.location = { hostname: "www.instagram.com", pathname: "/stories/someone/", href: "https://www.instagram.com/stories/someone/" };
    g.window = { innerWidth: 390, innerHeight: 844 };
    g.document = { cookie: "", querySelectorAll: (sel: string) => (sel === "video" ? [prev, next, current] : sel === "img" ? [] : []), getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} }, documentElement: { outerHTML: "" } };
    g.fetch = async () => new Response("{}", { status: 404 });
    const { shortcutSource } = await import("../src/lib/bookmarklet");
    try {
      await new Promise<void>((resolve) => {
        g.completion = () => setTimeout(() => ((out = String((g.location as { href: string }).href)), resolve()), 120);
        new Function(shortcutSource())();
      });
    } finally {
      Object.assign(g, saved);
    }
    expect(decodeShortcut(out).media).toEqual([{ kind: "VIDEO", url: `${CDN}/current.mp4`, width: 720, height: 1280 }]);
  });
});

describe("stories without a number in the address", () => {
  it("never takes another person's story set from the page", async () => {
    const { parseStoryData } = await import("../src/lib/instagram");
    const others = { reels_media: [{ user: { username: "someone_else" }, items: [{ pk: "9", image_versions2: { candidates: [{ url: `${CDN}/wrong.jpg`, width: 1080 }] } }] }] };
    expect(() => parseStoryData(others, { kind: "story", username: "someone", canonicalUrl: "" })).toThrow(/didn't include/);
  });
});

describe("story fallback and code version", () => {
  it("uses on-screen media when story page data isn't in a readable format", async () => {
    const { parseCollected } = await import("../src/lib/incoming");
    const p = parseCollected({
      platform: "instagram", url: "https://www.instagram.com/stories/someone/123/", kind: "storypage", storyId: "123", username: "someone",
      pageJson: [JSON.stringify({ unknown_format: { id: "123", display_url: `${CDN}/x.jpg` } })],
      media: [{ kind: "VIDEO", url: `${CDN}/onscreen.mp4` }],
    });
    expect(p.items[0].url).toBe(`${CDN}/onscreen.mp4`);
  });

  it("stamps the current code version on Shortcut results", async () => {
    const { shortcutSource, CODE_VERSION } = await import("../src/lib/bookmarklet");
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, completion: g.completion };
    let out = "";
    const toastEl = { style: {}, remove() {}, textContent: "" };
    g.location = { hostname: "example.com", pathname: "/", href: "https://example.com/" };
    g.document = { querySelectorAll: () => [], getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} } };
    try {
      await new Promise<void>((resolve) => {
        g.completion = () => setTimeout(() => ((out = String((g.location as { href: string }).href)), resolve()), 120);
        new Function(shortcutSource())();
      });
    } finally {
      Object.assign(g, saved);
    }
    expect(decodeShortcut(out)).toMatchObject({ keepsake: 1, v: CODE_VERSION, error: expect.stringMatching(/Instagram, Reddit or Pixiv/) });
  });
});

describe("Shortcut link opens straight to the post", () => {
  it("resolves the link itself, without the clipboard", async () => {
    const { resolveInput } = await import("../src/lib/resolve");
    const data = { keepsake: 1, v: 13, platform: "instagram", url: "https://www.instagram.com/stories/a/", kind: "screen", username: "a", media: [{ kind: "IMAGE", url: `${CDN}/s.jpg` }] };
    const link = "https://entity-44.github.io/downloader/#/paste/" + encodeURIComponent(JSON.stringify(data));
    expect((await resolveInput(link)).items[0].url).toBe(`${CDN}/s.jpg`);
  });
});

describe("Shortcut link survives Shortcuts' re-encoding", () => {
  it("accepts ?paste=, #/paste/, %23/paste/ and double-encoded data", async () => {
    const { fromPasteLink } = await import("../src/lib/incoming");
    const data = { keepsake: 1, platform: "instagram", url: "x" };
    const enc = encodeURIComponent(JSON.stringify(data));
    for (const link of [
      `https://entity-44.github.io/downloader/?paste=${enc}`,
      `https://entity-44.github.io/downloader/#/paste/${enc}`,
      `https://entity-44.github.io/downloader/%23/paste/${enc}`,
      `https://entity-44.github.io/downloader/?paste=${encodeURIComponent(enc)}`,
    ]) {
      expect(fromPasteLink(link)).toEqual(data);
    }
  });
});

describe("Shortcut link contains a single address", () => {
  it("decodes base64url data, including non-English text", async () => {
    const { fromPasteLink } = await import("../src/lib/incoming");
    const data = { keepsake: 1, platform: "instagram", url: "https://www.instagram.com/stories/a/", caption: "Café 🎉" };
    const b64 = Buffer.from(JSON.stringify(data), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const link = `https://entity-44.github.io/downloader/?paste=${b64}`;
    expect((link.match(/https?:|www\.|\.com/g) ?? []).length).toBe(1); // only the site's own "https:"
    expect(fromPasteLink(link)).toEqual(data);
  });
});

describe("Shortcut new tab and thumbnail sizes", () => {
  it("opens a new tab when allowed, without moving the Instagram tab", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, completion: g.completion, window: g.window };
    let opened = "";
    const toastEl = { style: {}, remove() {}, textContent: "" };
    g.location = { hostname: "example.com", pathname: "/", href: "https://example.com/" };
    g.window = { open: (u: string) => ((opened = u), {}) };
    g.document = { querySelectorAll: () => [], getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} } };
    const { shortcutSource } = await import("../src/lib/bookmarklet");
    try {
      await new Promise<void>((resolve) => {
        g.completion = () => setTimeout(resolve, 120);
        new Function(shortcutSource())();
      });
      expect(opened.startsWith("https://entity-44.github.io/downloader/?paste=")).toBe(true);
      expect((g.location as { href: string }).href).toBe("https://example.com/"); // Instagram tab untouched
    } finally {
      Object.assign(g, saved);
    }
  });

  it("lists every cover image size for videos, largest first", () => {
    const p = parseInstagramJson({ items: [{ code: "THUMBS0001", media_type: 2, video_versions: [{ url: `${CDN}/v.mp4`, width: 720, height: 1280 }], image_versions2: { candidates: [{ url: `${CDN}/c640.jpg`, width: 640, height: 1138 }, { url: `${CDN}/c1080.jpg`, width: 1080, height: 1920 }, { url: `${CDN}/c320.jpg`, width: 320, height: 569 }] } }] });
    expect(p.items[0].thumbVariants?.map((v) => v.width)).toEqual([1080, 640, 320]);
    expect(p.items[0].thumbUrl).toBe(`${CDN}/c1080.jpg`);
  });
});

describe("Pixiv", () => {
  it("recognizes work links", async () => {
    const { parsePixivUrl } = await import("../src/lib/pixiv");
    expect(parsePixivUrl("https://www.pixiv.net/en/artworks/44298467")).toEqual({ id: "44298467", canonicalUrl: "https://www.pixiv.net/artworks/44298467" });
    expect(parsePixivUrl("pixiv.net/artworks/123")?.id).toBe("123");
    expect(parsePixivUrl("https://www.pixiv.net/member_illust.php?mode=medium&illust_id=555")?.id).toBe("555");
    expect(parsePixivUrl("https://pixiv.net.evil.com/artworks/1")).toBeNull();
  });

  it("turns an ugoira into MP4 options plus the original frames ZIP", async () => {
    const { parsePixiv } = await import("../src/lib/pixiv");
    const p = parsePixiv({
      illust: { illustId: "44298467", illustTitle: "うごイラはじめました", userName: "pixiv事務局", illustType: 2, width: 1920, height: 1080, createDate: "2014-06-25T05:30:22+00:00", urls: { regular: "https://i.pximg.net/img-master/r.jpg", original: "https://i.pximg.net/img-original/o.jpg" } },
      ugoira: { src: "https://i.pximg.net/img-zip-ugoira/x_ugoira600x600.zip", originalSrc: "https://i.pximg.net/img-zip-ugoira/x_ugoira1920x1080.zip", frames: Array.from({ length: 12 }, (_, k) => ({ file: `${String(k).padStart(6, "0")}.jpg`, delay: 125 })) },
    }, "");
    expect(p).toMatchObject({ platform: "pixiv", id: "44298467", author: "pixiv事務局", title: "うごイラはじめました" });
    const it0 = p.items[0];
    expect(it0).toMatchObject({ kind: "VIDEO", url: "https://i.pximg.net/img-zip-ugoira/x_ugoira1920x1080.zip", durationSec: 1.5 });
    expect(it0.ugoira?.frames).toHaveLength(12);
    expect(it0.variants?.map((v) => v.label)).toEqual(["MP4 · original (1920×1080)", "MP4 · 600px", "Original frames (ZIP)"]);
    expect(it0.variants?.[2].raw).toBe(true);
  });

  it("lists every page of a multi-page work with size options", async () => {
    const { parsePixiv } = await import("../src/lib/pixiv");
    const page = (n: number) => ({ width: 2000, height: 3000, urls: { original: `https://i.pximg.net/img-original/p${n}.png`, regular: `https://i.pximg.net/img-master/p${n}.jpg`, small: `https://i.pximg.net/c/540x540_70/p${n}.jpg` } });
    const p = parsePixiv({ illust: { illustId: "9", illustType: 1, pageCount: 3, userName: "artist" }, pages: [page(0), page(1), page(2)] }, "");
    expect(p.items.map((i) => i.url)).toEqual([0, 1, 2].map((n) => `https://i.pximg.net/img-original/p${n}.png`));
    expect(p.items[0].variants?.map((v) => v.label)).toEqual(["2000×3000 · original", "Large (1200px)", "Small (540px)"]);
  });
});

describe("Snapchat", () => {
  it("recognizes snapchat links", async () => {
    const { parseSnapchatUrl } = await import("../src/lib/snapchat");
    expect(parseSnapchatUrl("https://www.snapchat.com/spotlight/ABC123")?.url).toBe("https://www.snapchat.com/spotlight/ABC123");
    expect(parseSnapchatUrl("story.snapchat.com/s/someone")).not.toBeNull();
    expect(parseSnapchatUrl("https://snapchat.com.evil.com/x")).toBeNull();
  });

  it("parses a public Spotlight page's video metadata", async () => {
    const { parseSnapchat } = await import("../src/lib/snapchat");
    const p = parseSnapchat({
      url: "https://www.snapchat.com/@jemmacrawford14/spotlight/W7_EDlXWTBiXAEEni",
      ld: [{ "@type": "BreadcrumbList" }, { "@type": "VideoObject", name: "Jemma&#x27;s Hair Styling Moment", contentUrl: "https://bolt-gcdn.sc-cdn.net/y/abc.27.IRZXSOY?mo=1", thumbnailUrl: "https://bolt-gcdn.sc-cdn.net/y/abc.256.IRZXSOY?mo=2", uploadDate: "2026-05-25T01:32:02.935Z" }],
      og: { "video:width": "540", "video:height": "960" },
      next: null,
    }, "");
    expect(p).toMatchObject({ platform: "snapchat", author: "jemmacrawford14", title: "Jemma's Hair Styling Moment", takenAt: "2026-05-25T01:32:02.935Z", id: "W7_EDlXWTBiXAEEni" });
    expect(p.items[0]).toMatchObject({ kind: "VIDEO", url: "https://bolt-gcdn.sc-cdn.net/y/abc.27.IRZXSOY?mo=1", width: 540, height: 960 });
  });

  it("parses public Story snaps and explains private pages", async () => {
    const { parseSnapchat } = await import("../src/lib/snapchat");
    const p = parseSnapchat({ url: "https://www.snapchat.com/add/someone", ld: [], og: {}, next: { story: { snapList: [{ snapMediaType: 1, snapUrls: { mediaUrl: "https://cf-st.sc-cdn.net/d/1.mp4", mediaPreviewUrl: { value: "https://cf-st.sc-cdn.net/d/1.jpg" } } }, { snapMediaType: 0, snapUrls: { mediaUrl: "https://cf-st.sc-cdn.net/d/2.jpg" } }] } } }, "");
    expect(p.items.map((i) => i.kind)).toEqual(["VIDEO", "IMAGE"]);
    expect(() => parseSnapchat({ ld: [], og: {} }, "")).toThrow(/public Spotlight/);
  });
});

describe("Pixiv via the bookmark", () => {
  it("reads the work with the page's own access and parses an ugoira", async () => {
    const calls: string[] = [];
    let posted: Record<string, unknown> | null = null;
    let listener: ((e: unknown) => Promise<void>) | null = null;
    const toastEl = { style: {}, remove() {}, textContent: "" };
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { location: g.location, document: g.document, window: g.window, fetch: g.fetch };
    const win = { postMessage: (m: Record<string, unknown>) => (posted = m) };
    g.location = { hostname: "www.pixiv.net", pathname: "/en/artworks/44298467", href: "https://www.pixiv.net/en/artworks/44298467" };
    g.document = { cookie: "", querySelectorAll: () => [], getElementById: () => toastEl, createElement: () => toastEl, body: { appendChild() {} } };
    g.window = { open: () => win, addEventListener: (_: string, fn: (e: unknown) => Promise<void>) => (listener = fn) };
    g.fetch = async (u: string) => {
      calls.push(u);
      const body = u.endsWith("/ugoira_meta")
        ? { originalSrc: "https://i.pximg.net/img-zip-ugoira/o.zip", src: "https://i.pximg.net/img-zip-ugoira/s.zip", frames: [{ file: "0.jpg", delay: 100 }] }
        : { illustId: "44298467", illustType: 2, pageCount: 1, width: 1920, height: 1080, userName: "pixiv", urls: { regular: "https://i.pximg.net/r.jpg" } };
      return new Response(JSON.stringify({ error: false, body }));
    };
    try {
      await new Function(bookmarkletSource("https://entity-44.github.io/downloader/"))();
      await new Promise((r) => setTimeout(r, 10));
      await (listener as ((e: unknown) => Promise<void>) | null)?.({ source: win, origin: "https://entity-44.github.io", data: { type: "keepsake:ready" } });
    } finally {
      Object.assign(g, saved);
    }
    expect(calls).toEqual(["/ajax/illust/44298467", "/ajax/illust/44298467/ugoira_meta"]);
    const { parseCollected } = await import("../src/lib/incoming");
    const p = parseCollected(posted as never);
    expect(p).toMatchObject({ platform: "pixiv", id: "44298467" });
    expect(p.items[0].ugoira?.frames).toHaveLength(1);
  });

  it("accepts messages from pixiv.net", async () => {
    const { TRUSTED_ORIGINS } = await import("../src/lib/bridge");
    expect(TRUSTED_ORIGINS.has("https://www.pixiv.net")).toBe(true);
  });
});
