import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as createDownload, GET as listDownloads, DELETE as clearDownloads } from "@/app/api/downloads/route";
import { GET as getDownloadRoute, DELETE as deleteDownloadRoute } from "@/app/api/downloads/[id]/route";
import { GET as downloadZip } from "@/app/api/downloads/[id]/zip/route";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { POST as upload } from "@/app/api/uploads/route";
import { db } from "@/lib/db";
import { requestDownload } from "@/lib/downloads/service";
import { downloadDir } from "@/lib/downloads/store";
import { clearMediaIndex } from "@/lib/instagram/connections";
import type { GraphMedia, InstagramGraph } from "@/lib/instagram/graph";
import { queues } from "@/lib/queue";
import { encrypt } from "@/lib/security/crypto";
import { AppError } from "@/lib/http/errors";
import { expireDownloads, cleanTempDir } from "@/lib/storage/cleanup";
import { getConfig } from "@/lib/config";
import { makeUser, mediaFixtures, params, req } from "./helpers";

const CDN = "https://scontent.cdninstagram.com";

const OWN_MEDIA: GraphMedia[] = [
  { id: "1001", media_type: "IMAGE", media_product_type: "FEED", permalink: "https://www.instagram.com/p/IMG000001/", media_url: `${CDN}/img.jpg`, timestamp: "2024-03-01T12:00:00+0000", caption: "Single image" },
  { id: "1002", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/REEL00001/", media_url: `${CDN}/reel.mp4`, timestamp: "2024-03-02T12:00:00+0000" },
  {
    id: "1003",
    media_type: "CAROUSEL_ALBUM",
    permalink: "https://www.instagram.com/p/CARO00001/",
    timestamp: "2024-03-03T12:00:00+0000",
    caption: "Carousel",
    children: { data: [{ id: "c1", media_type: "IMAGE", media_url: `${CDN}/c1.jpg` }, { id: "c2", media_type: "VIDEO", media_url: `${CDN}/c2.mp4` }, { id: "c3", media_type: "IMAGE" }] },
  },
  { id: "1004", media_type: "VIDEO", permalink: "https://www.instagram.com/p/WITHHELD1/" }, // copyrighted: no media_url
];

function fakeGraph(opts: { expired?: boolean; media?: GraphMedia[] } = {}) {
  const media = opts.media ?? OWN_MEDIA;
  const calls: string[] = [];
  const g = {
    calls,
    async listMedia(token: string, after?: string) {
      calls.push(`list:${after ?? ""}`);
      if (opts.expired) throw new AppError("TOKEN_EXPIRED");
      expect(token).toBe("valid-token");
      // Two pages to exercise pagination.
      return after ? { data: media.slice(2) } : { data: media.slice(0, 2), paging: { next: "x", cursors: { after: "p2" } } };
    },
    async getMedia(_t: string, id: string) {
      calls.push(`get:${id}`);
      const m = media.find((x) => x.id === id);
      if (!m) throw new AppError("MEDIA_UNAVAILABLE");
      return m;
    },
    async refreshLongLived() {
      return { access_token: "valid-token", expires_in: 5184000 };
    },
  };
  return g as unknown as InstagramGraph & { calls: string[] };
}

const fetchMedia = async (url: string, dest: string, o: { maxBytes: number }) => {
  const f = mediaFixtures();
  const data = url.endsWith(".mp4") ? f.mp4 : url.endsWith(".evil") ? Buffer.from("<script>") : f.jpg;
  if (data.length > o.maxBytes) throw new AppError("TOO_LARGE");
  await writeFile(dest, data);
  return { bytes: data.length, contentType: null };
};

async function run(userId: string, url: string, graph = fakeGraph()) {
  const dl = await requestDownload(userId, url, { graph, fetchMedia });
  await queues().downloads.onIdle();
  return db().download.findUniqueOrThrow({ where: { id: dl.id }, include: { files: { orderBy: { position: "asc" } } } });
}

async function connect(userId: string, username = "me_ig") {
  return db().instagramConnection.create({
    data: { userId, igUserId: `ig-${userId}`, username, accessTokenEnc: encrypt("valid-token"), tokenExpiresAt: new Date(Date.now() + 50 * 86400_000) },
  });
}

beforeEach(() => clearMediaIndex());

describe("URL download workflow", () => {
  it("rejects invalid URLs immediately without creating history", async () => {
    const u = await makeUser();
    const r = await createDownload(req("POST", "/api/downloads", { cookie: u.cookie, csrf: u.csrf, body: { url: "https://evil.com/p/abc" } }));
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("UNSUPPORTED_URL");
    const story = await createDownload(req("POST", "/api/downloads", { cookie: u.cookie, csrf: u.csrf, body: { url: "https://instagram.com/stories/someone/123/" } }));
    expect((await story.json()).error.code).toBe("API_UNSUPPORTED");
    const profile = await createDownload(req("POST", "/api/downloads", { cookie: u.cookie, csrf: u.csrf, body: { url: "https://instagram.com/someone/" } }));
    expect((await profile.json()).error.code).toBe("UNSUPPORTED_URL");
    expect(await db().download.count({ where: { userId: u.user.id } })).toBe(0);
  });

  it("fails honestly when no account is connected", async () => {
    const u = await makeUser();
    const d = await run(u.user.id, "https://www.instagram.com/p/IMG000001/");
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("NOT_CONNECTED");
    expect(d.files).toHaveLength(0);
  });

  it("downloads a single image owned by the connected account", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const d = await run(u.user.id, "https://instagram.com/p/IMG000001/?igsh=x");
    expect(d.status).toBe("COMPLETED");
    expect(d.mediaType).toBe("IMAGE");
    expect(d.ownerUsername).toBe("me_ig");
    expect(d.expiresAt).not.toBeNull();
    expect(d.files).toHaveLength(1);
    expect(d.files[0].filename).toBe("instagram_me_ig_post_IMG000001_2024-03-01.jpg");
  });

  it("downloads a reel with a generated thumbnail (found on page 1)", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const g = fakeGraph();
    const d = await run(u.user.id, "https://www.instagram.com/reel/REEL00001/", g);
    expect(d.status).toBe("COMPLETED");
    expect(d.mediaType).toBe("REEL");
    expect(d.files[0].kind).toBe("VIDEO");
    expect(d.files[0].thumbPath).toBeTruthy();
    expect(g.calls).toEqual(["list:", "get:1002"]);
  });

  it("downloads every carousel item (paginating) and offers a ZIP", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const d = await run(u.user.id, "https://www.instagram.com/p/CARO00001/");
    expect(d.status).toBe("COMPLETED");
    expect(d.mediaType).toBe("CAROUSEL");
    expect(d.files.map((f) => f.kind)).toEqual(["IMAGE", "VIDEO"]);
    expect(d.errorCode).toBe("PARTIAL"); // third child had no media_url
    expect(d.files.map((f) => f.filename)).toEqual(["instagram_me_ig_post_CARO00001_2024-03-03_01.jpg", "instagram_me_ig_post_CARO00001_2024-03-03_02.mp4"]);

    const z = await downloadZip(req("GET", "/x", { cookie: u.cookie }), params({ id: d.id }));
    expect(z.status).toBe(200);
    expect(z.headers.get("content-disposition")).toContain("instagram_me_ig_CARO00001.zip");
    expect((await z.arrayBuffer()).byteLength).toBeGreaterThan(mediaFixtures().mp4.length);
  });

  it("refuses media not owned by a connected account", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const d = await run(u.user.id, "https://www.instagram.com/p/SOMEONEELSE/");
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("PRIVATE_MEDIA_REQUIRES_AUTHORIZATION");
    expect(d.errorMessage).toContain("@me_ig");
    expect(d.files).toHaveLength(0);
  });

  it("reports withheld media as unavailable", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const d = await run(u.user.id, "https://www.instagram.com/p/WITHHELD1/");
    expect(d.errorCode).toBe("MEDIA_UNAVAILABLE");
  });

  it("reports expired tokens", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const d = await run(u.user.id, "https://www.instagram.com/p/IMG000001/", fakeGraph({ expired: true }));
    expect(d.errorCode).toBe("TOKEN_EXPIRED");
  });

  it("enforces the user's maximum download size and cleans up", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    await db().settings.update({ where: { userId: u.user.id }, data: { maxDownloadMb: 1 } });
    const big: GraphMedia = { id: "9", media_type: "IMAGE", permalink: "https://www.instagram.com/p/BIGFILE01/", media_url: `${CDN}/big.jpg` };
    const tooBig = async (_u: string, _d: string, o: { maxBytes: number }) => {
      expect(o.maxBytes).toBe(1048576);
      throw new AppError("TOO_LARGE");
    };
    const dl = await requestDownload(u.user.id, big.permalink!, { graph: fakeGraph({ media: [big] }), fetchMedia: tooBig });
    await queues().downloads.onIdle();
    const d = await db().download.findUniqueOrThrow({ where: { id: dl.id } });
    expect(d.errorCode).toBe("TOO_LARGE");
    expect(existsSync(downloadDir(u.user.id, d.id))).toBe(false);
  });

  it("rejects non-media returned by the CDN", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const evil: GraphMedia = { id: "7", media_type: "IMAGE", permalink: "https://www.instagram.com/p/EVILFILE1/", media_url: `${CDN}/x.evil` };
    const d = await run(u.user.id, evil.permalink!, fakeGraph({ media: [evil] }));
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("UNSUPPORTED_FILE");
  });
});

describe("file downloads", () => {
  it("serves files, inline previews and byte ranges", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const d = await run(u.user.id, "https://www.instagram.com/reel/REEL00001/");
    const f = d.files[0];
    const full = await getFile(req("GET", "/x", { cookie: u.cookie }), params({ id: f.id }));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("content-disposition")).toMatch(/^attachment; filename="instagram_me_ig_reel_REEL00001_2024-03-02\.mp4"/);
    expect(Number(full.headers.get("content-length"))).toBe(mediaFixtures().mp4.length);
    await full.arrayBuffer();

    const inline = await getFile(req("GET", `/x?inline=1`, { cookie: u.cookie }), params({ id: f.id }));
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);
    await inline.arrayBuffer();

    const part = await getFile(req("GET", "/x", { cookie: u.cookie, headers: { range: "bytes=0-99" } }), params({ id: f.id }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${mediaFixtures().mp4.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);

    const thumb = await getFile(req("GET", "/x?variant=thumb", { cookie: u.cookie }), params({ id: f.id }));
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");
    await thumb.arrayBuffer();

    const bad = await getFile(req("GET", "/x", { cookie: u.cookie, headers: { range: "bytes=999999999-" } }), params({ id: f.id }));
    expect(bad.status).toBe(416);
  });
});

describe("user-provided uploads", () => {
  it("requires attestation and accepts only real media", async () => {
    const u = await makeUser();
    const base = { cookie: u.cookie, csrf: u.csrf };
    const noAttest = await upload(req("POST", "/api/uploads", { ...base, raw: mediaFixtures().jpg, headers: { "x-filename": "a.jpg" } }));
    expect(noAttest.status).toBe(400);
    const html = await upload(req("POST", "/api/uploads", { ...base, raw: Buffer.from("<html><script>alert(1)</script>"), headers: { "x-filename": "a.jpg", "x-authorization-attested": "true" } }));
    expect(html.status).toBe(415);
    const ok = await upload(req("POST", "/api/uploads", { ...base, raw: mediaFixtures().png, headers: { "x-filename": encodeURIComponent("../../My Photo.jpg"), "x-authorization-attested": "true", "x-source-url": encodeURIComponent("https://instagram.com/p/GIVEN0001/") } }));
    expect(ok.status).toBe(201);
    const { download } = await ok.json();
    expect(download.source).toBe("USER_UPLOAD");
    expect(download.sourceUrl).toBe("https://www.instagram.com/p/GIVEN0001/");
    expect(download.files[0].filename).toBe("My_Photo.png"); // sniffed type wins over the name
    expect(download.expiresAt).toBeNull();
    expect(await db().download.count({ where: { userId: u.user.id } })).toBe(1);
  });
});

describe("history management", () => {
  it("lists, deletes and clears history including files", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const a = await run(u.user.id, "https://www.instagram.com/p/IMG000001/");
    const b = await run(u.user.id, "https://www.instagram.com/p/CARO00001/");
    const list = await (await listDownloads(req("GET", "/api/downloads", { cookie: u.cookie }))).json();
    expect(list.downloads.map((d: { id: string }) => d.id)).toEqual([b.id, a.id]);
    expect(list.downloads[0].files[0].url).toBe(`/api/files/${b.files[0].id}`);

    const del = await deleteDownloadRoute(req("DELETE", "/x", { cookie: u.cookie, csrf: u.csrf }), params({ id: a.id }));
    expect(del.status).toBe(200);
    expect(existsSync(downloadDir(u.user.id, a.id))).toBe(false);
    expect((await getDownloadRoute(req("GET", "/x", { cookie: u.cookie }), params({ id: a.id }))).status).toBe(404);

    const cleared = await (await clearDownloads(req("DELETE", "/api/downloads", { cookie: u.cookie, csrf: u.csrf }))).json();
    expect(cleared.removed).toBe(1);
    expect(existsSync(downloadDir(u.user.id, b.id))).toBe(false);
    expect(await db().mediaFile.count({ where: { userId: u.user.id } })).toBe(0);
  });
});

describe("automatic cleanup", () => {
  it("expires downloads past retention and removes stale temp files", async () => {
    const u = await makeUser();
    await connect(u.user.id);
    const d = await run(u.user.id, "https://www.instagram.com/p/IMG000001/");
    expect(await expireDownloads(new Date(Date.now() + 1000))).toBe(0);
    expect(await expireDownloads(new Date(d.expiresAt!.getTime() + 1000))).toBeGreaterThanOrEqual(1);
    const after = await db().download.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.status).toBe("EXPIRED");
    expect(await db().mediaFile.count({ where: { downloadId: d.id } })).toBe(0);
    expect(existsSync(downloadDir(u.user.id, d.id))).toBe(false);

    const stale = path.join(getConfig().tmpDir, "dl-stale");
    await writeFile(stale, "x");
    expect(await cleanTempDir(Date.now() + getConfig().tempFileMaxAgeMs + 60_000)).toBeGreaterThanOrEqual(1);
    expect(existsSync(stale)).toBe(false);
  });
});
