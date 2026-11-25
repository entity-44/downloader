import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import yauzl from "yauzl";
import { describe, expect, it } from "vitest";
import { extractArchive, normalizeEntryPath, type ExtractLimits } from "@/lib/archive/extract";
import { buildMetadataIndex, categoryFromPath, dateFromPath, fixMojibake, lookupMeta } from "@/lib/archive/metadata";
import { processArchive } from "@/lib/archive/import";
import { POST as uploadArchive } from "@/app/api/archives/route";
import { GET as getArchive } from "@/app/api/archives/[id]/route";
import { GET as archiveZip } from "@/app/api/archives/[id]/zip/route";
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";
import { getConfig } from "@/lib/config";
import { buildZip, makeUser, mediaFixtures, params, req, type ZEntry } from "./helpers";

const limits: ExtractLimits = { maxEntries: 100, maxTotalBytes: 50 * 1024 * 1024, maxEntryBytes: 10 * 1024 * 1024, maxRatio: 200, maxMetadataBytes: 1024 * 1024 };

function zipFile(entries: ZEntry[]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zip-"));
  const p = path.join(dir, "a.zip");
  writeFileSync(p, buildZip(entries));
  return p;
}
const staging = () => path.join(mkdtempSync(path.join(os.tmpdir(), "stage-")), "s");
const code = (p: Promise<unknown>) => p.then(() => "OK", (e) => e.code ?? String(e));

describe("normalizeEntryPath", () => {
  it.each([
    ["media/posts/202301/a.jpg", "media/posts/202301/a.jpg"],
    ["./media//posts/a.jpg", "media/posts/a.jpg"],
    ["../evil.sh", null],
    ["media/../../evil", null],
    ["/etc/passwd", null],
    ["C:/Windows/x", null],
    ["media\\..\\evil", null],
    ["a\0b.jpg", null],
    ["", null],
  ])("%s → %s", (input, out) => expect(normalizeEntryPath(input)).toBe(out));
});

describe("extractArchive security", () => {
  it("rejects path traversal", async () => {
    const z = zipFile([{ name: "media/ok.jpg", data: mediaFixtures().jpg }, { name: "../../escape.jpg", data: mediaFixtures().jpg }]);
    const dir = staging();
    expect(await code(extractArchive(z, dir, limits))).toBe("INVALID_ARCHIVE");
    expect(existsSync(path.join(dir, "..", "..", "escape.jpg"))).toBe(false);
  });

  it("rejects absolute paths", async () => {
    expect(await code(extractArchive(zipFile([{ name: "/tmp/abs.jpg", data: mediaFixtures().jpg }]), staging(), limits))).toBe("INVALID_ARCHIVE");
  });

  it("skips symlinks, encrypted entries, executables and disguised files", async () => {
    const z = zipFile([
      { name: "media/link.jpg", data: Buffer.from("/etc/passwd"), unixMode: 0o120777 },
      { name: "media/secret.jpg", data: mediaFixtures().jpg, encrypted: true },
      { name: "run.sh", data: Buffer.from("#!/bin/sh\nrm -rf /") },
      { name: "index.html", data: Buffer.from("<script>alert(1)</script>") },
      { name: "media/fake.jpg", data: Buffer.from("MZ this is actually an exe") },
      { name: "media/posts/202405/real.jpg", data: mediaFixtures().jpg },
    ]);
    const dir = staging();
    const r = await extractArchive(z, dir, limits);
    expect(r.media).toHaveLength(1);
    expect(r.media[0].entryPath).toBe("media/posts/202405/real.jpg");
    expect(r.skipped).toBe(5);
    // Output names are generated, never taken from the archive.
    expect(readdirSync(dir).every((n) => /^\d{7}\.bin$/.test(n))).toBe(true);
  });

  it("rejects zip bombs by compression ratio", async () => {
    const z = zipFile([{ name: "media/bomb.mp4", data: Buffer.alloc(5 * 1024 * 1024), compress: true }]);
    expect(await code(extractArchive(z, staging(), limits))).toBe("INVALID_ARCHIVE");
  });

  it("enforces entry count, per-entry and total size limits", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `m/${i}.jpg`, data: mediaFixtures().jpg }));
    expect(await code(extractArchive(zipFile(many), staging(), { ...limits, maxEntries: 4 }))).toBe("INVALID_ARCHIVE");
    expect(await code(extractArchive(zipFile(many), staging(), { ...limits, maxEntryBytes: 100 }))).toBe("INVALID_ARCHIVE");
    expect(await code(extractArchive(zipFile(many), staging(), { ...limits, maxTotalBytes: mediaFixtures().jpg.length * 3 }))).toBe("INVALID_ARCHIVE");
  });

  it("does not trust size headers (lying uncompressed size)", async () => {
    const z = zipFile([{ name: "media/a.mp4", data: mediaFixtures().mp4, declaredSize: 10 }]);
    expect(await code(extractArchive(z, staging(), limits))).toBe("INVALID_ARCHIVE");
  });

  it("rejects non-zip input", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nz-"));
    writeFileSync(path.join(dir, "x.zip"), "not a zip");
    expect(await code(extractArchive(path.join(dir, "x.zip"), staging(), limits))).toBe("INVALID_ARCHIVE");
  });
});

describe("metadata parsing", () => {
  it("fixes Meta's mojibake encoding", () => {
    expect(fixMojibake("Caf\u00c3\u00a9 \u00f0\u009f\u0098\u008a")).toBe("Café 😊");
    expect(fixMojibake("plain")).toBe("plain");
    expect(fixMojibake("already é ✓")).toBe("already é ✓");
  });

  it("categorizes paths and dates", () => {
    expect(categoryFromPath("your_instagram_activity/media/posts/202301/1.jpg")).toBe("post");
    expect(categoryFromPath("media/reels/202301/1.mp4")).toBe("reel");
    expect(categoryFromPath("media/stories/202301/1.mp4")).toBe("story");
    expect(categoryFromPath("your_instagram_activity/messages/inbox/x/photos/1.jpg")).toBe("message");
    expect(categoryFromPath("random/1.jpg")).toBe("other");
    expect(dateFromPath("media/posts/202301/1.jpg")?.toISOString()).toBe("2023-01-01T00:00:00.000Z");
    expect(dateFromPath("media/posts/1.jpg")).toBeNull();
  });

  it("indexes posts and stories JSON generically", () => {
    const idx = buildMetadataIndex(
      new Map<string, unknown>([
        ["your_instagram_activity/content/posts_1.json", [{ media: [{ uri: "media/posts/202301/a.jpg", creation_timestamp: 1672600000, title: "" }, { uri: "media/posts/202301/b.jpg", creation_timestamp: 1672600000 }], title: "Carousel caption", creation_timestamp: 1672600000 }]],
        ["your_instagram_activity/content/stories.json", { ig_stories: [{ uri: "media/stories/202302/s.mp4", creation_timestamp: 1675300000, title: "story!" }] }],
      ]),
    );
    expect(lookupMeta(idx, "media/posts/202301/a.jpg")).toMatchObject({ caption: "Carousel caption", category: "post" });
    expect(lookupMeta(idx, "export_root/media/stories/202302/s.mp4")).toMatchObject({ caption: "story!", category: "story" });
    expect(lookupMeta(idx, "media/stories/202302/s.mp4")?.takenAt?.getTime()).toBe(1675300000 * 1000);
  });
});

function exportZip() {
  const f = mediaFixtures();
  return buildZip([
    { name: "your_instagram_activity/content/posts_1.json", data: Buffer.from(JSON.stringify([{ media: [{ uri: "media/posts/202301/p1.jpg", creation_timestamp: 1672600000, title: "First post \u00c3\u00a9" }] }, { media: [{ uri: "media/posts/202303/v1.mp4", creation_timestamp: 1678000000, title: "A video" }] }])) },
    { name: "your_instagram_activity/content/stories.json", data: Buffer.from(JSON.stringify({ ig_stories: [{ uri: "media/stories/202302/s1.png", creation_timestamp: 1675300000, title: "" }] })) },
    { name: "media/posts/202301/p1.jpg", data: f.jpg },
    { name: "media/posts/202303/v1.mp4", data: f.mp4 },
    { name: "media/stories/202302/s1.png", data: f.png },
    { name: "media/reels/202304/r1.mp4", data: f.mp4 },
    { name: "your_instagram_activity/index.html", data: Buffer.from("<html></html>") },
  ]);
}

describe("archive import end-to-end", () => {
  it("uploads, extracts, organizes and serves an export", async () => {
    const u = await makeUser();
    const res = await uploadArchive(req("POST", "/api/archives", { cookie: u.cookie, csrf: u.csrf, raw: exportZip(), headers: { "x-filename": "instagram-export.zip", "content-type": "application/zip" } }));
    expect(res.status).toBe(202);
    const { archive } = await res.json();
    await queues().archives.onIdle();

    const a = await db().archiveImport.findUniqueOrThrow({ where: { id: archive.id } });
    expect(a.status).toBe("COMPLETED");
    expect(a.fileCount).toBe(4);
    expect(a.skippedCount).toBe(1);
    expect(readdirSync(getConfig().tmpDir).filter((n) => n.startsWith("archive"))).toHaveLength(0);

    const files = await db().mediaFile.findMany({ where: { archiveId: archive.id }, orderBy: { takenAt: "asc" } });
    expect(files.map((f) => f.category).sort()).toEqual(["post", "post", "reel", "story"]);
    const p1 = files.find((f) => f.caption?.startsWith("First post"))!;
    expect(p1.caption).toBe("First post é");
    expect(p1.storagePath).toMatch(/archives\/[a-z0-9]+\/post\/2023\/01\/post_2023-01-01_\d{6}_\d{5}\.jpg$/);
    const video = files.find((f) => f.category === "reel")!;
    expect(video.kind).toBe("VIDEO");
    expect(video.thumbPath).toBeTruthy();
    expect(video.durationSec).toBeGreaterThan(2);

    const gallery = await (await getArchive(req("GET", `/api/archives/${archive.id}?category=post`, { cookie: u.cookie }), params({ id: archive.id }))).json();
    expect(gallery.total).toBe(2);
    expect(gallery.counts.category).toMatchObject({ post: 2, reel: 1, story: 1 });

    const zipRes = await archiveZip(req("GET", `/api/archives/${archive.id}/zip?kind=VIDEO`, { cookie: u.cookie }), params({ id: archive.id }));
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get("content-type")).toBe("application/zip");
    const buf = Buffer.from(await zipRes.arrayBuffer());
    const names = await new Promise<string[]>((resolve, reject) =>
      yauzl.fromBuffer(buf, { lazyEntries: false }, (err, zf) => {
        if (err || !zf) return reject(err);
        const out: string[] = [];
        zf.on("entry", (e) => out.push(e.fileName));
        zf.on("end", () => resolve(out));
      }),
    );
    expect(names).toHaveLength(2);
    expect(names.every((n) => /^(post|reel)\/2023\//.test(n))).toBe(true);
  });

  it("rejects non-zip uploads and cleans up failed imports", async () => {
    const u = await makeUser();
    const bad = await uploadArchive(req("POST", "/api/archives", { cookie: u.cookie, csrf: u.csrf, raw: Buffer.from("hello"), headers: { "x-filename": "x.zip" } }));
    expect(bad.status).toBe(422);

    const evil = buildZip([{ name: "media/a.jpg", data: mediaFixtures().jpg }, { name: "../../x.jpg", data: mediaFixtures().jpg }]);
    const r = await uploadArchive(req("POST", "/api/archives", { cookie: u.cookie, csrf: u.csrf, raw: evil, headers: { "x-filename": "evil.zip" } }));
    const { archive } = await r.json();
    await queues().archives.onIdle();
    const a = await db().archiveImport.findUniqueOrThrow({ where: { id: archive.id } });
    expect(a.status).toBe("FAILED");
    expect(a.errorMessage).toMatch(/unsafe/i);
    expect(await db().mediaFile.count({ where: { archiveId: archive.id } })).toBe(0);
  });

  it("fails clearly when an archive has no media", async () => {
    const u = await makeUser();
    const a = await db().archiveImport.create({ data: { userId: u.user.id, originalName: "empty.zip", sizeBytes: 1n } });
    const z = zipFile([{ name: "readme.txt", data: Buffer.from("hi") }]);
    await processArchive(a.id, z);
    const after = await db().archiveImport.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("FAILED");
    expect(after.errorMessage).toMatch(/No photos or videos/);
    expect(existsSync(z)).toBe(false);
  });
});
