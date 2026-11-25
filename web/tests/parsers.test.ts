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
    expect(p.items).toEqual([
      { kind: "IMAGE", url: `${CDN}/big.jpg`, width: 1440, height: 1440, thumbUrl: `${CDN}/small.jpg` },
      { kind: "VIDEO", url: `${CDN}/high.mp4`, width: 720, height: 1280, thumbUrl: `${CDN}/vthumb.jpg`, durationSec: 12.4 },
    ]);
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
