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
    expect(t.videos[0]).toEqual({ url: "https://v.redd.it/vid123/DASH_1080.mp4", height: 1080, bandwidth: 4000000 });
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
    expect(postFilename({ platform: "reddit", author: "op", id: "1abc2de", takenAt: "2023-11-14T22:13:20Z", index: 0, total: 2, ext: "mp4" })).toBe("reddit_op_1abc2de_2023-11-14_01.mp4");
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
    g.window = { open: (u: string) => ((opened = u), { postMessage() {} }), addEventListener() {} };
    g.fetch = async (u: string, init?: { headers?: Record<string, string> }) => {
      calls.push(u);
      headers.push(init?.headers ?? {});
      const key = Object.keys(responses).find((k) => u.includes(k));
      return key ? new Response(JSON.stringify(responses[key])) : new Response("{}", { status: 404 });
    };
    try {
      await new Function(`return (async () => { ${bookmarkletSource("https://entity-44.github.io/downloader/").replace(/^\(async \(\) => \{/, "").replace(/\}\)\(\);$/, "")} })()`)();
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
    expect(r.opened).toBeNull();
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
    g.window = { open: (u: string) => ((opened = u), { postMessage() {} }), addEventListener() {} };
    g.fetch = async (u: string, init?: { headers?: Record<string, string> }) => {
      calls.push(u);
      headers.push(init?.headers ?? {});
      const key = Object.keys(responses).find((k) => u.includes(k));
      return key ? new Response(JSON.stringify(responses[key])) : new Response("{}", { status: 404 });
    };
    try {
      await new Function(`return (async () => { ${bookmarkletSource("https://entity-44.github.io/downloader/").replace(/^\(async \(\) => \{/, "").replace(/\}\)\(\);$/, "")} })()`)();
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
    expect(r.opened).toBeNull();
    expect(r.toast).toMatch(/flagged that request as automated/);
  });

  it("explains a pasted spam response and never generates the ?__a=1 address", async () => {
    const { parsePastedInstagram, dataLinks } = await import("../src/lib/resolve");
    expect(() => parsePastedInstagram('{"message":"","spam":true,"status":"fail"}')).toThrow(/flagged that page as automated/);
    const links = dataLinks({ kind: "post", shortcode: "CxYz123AbC", canonicalUrl: "" });
    expect(Object.values(links).join(" ")).not.toContain("__a=1");
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
        g.completion = (r: string) => {
          result = r;
          resolve();
        };
        new Function(shortcutSource())();
      });
    } finally {
      Object.assign(g, saved);
    }
    return { calls, result: JSON.parse(result!) };
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
