import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as getDownload, DELETE as deleteDownloadRoute } from "@/app/api/downloads/[id]/route";
import { GET as listDownloads, DELETE as clearDownloads } from "@/app/api/downloads/route";
import { GET as downloadZip } from "@/app/api/downloads/[id]/zip/route";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { GET as getArchive, DELETE as deleteArchiveRoute } from "@/app/api/archives/[id]/route";
import { GET as archiveZip } from "@/app/api/archives/[id]/zip/route";
import { DELETE as disconnect } from "@/app/api/instagram/connections/[id]/route";
import { GET as connMedia } from "@/app/api/instagram/connections/[id]/media/route";
import { DELETE as revokeSession } from "@/app/api/auth/sessions/[id]/route";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/security/crypto";
import { resolveStoragePath, toStorageRelative } from "@/lib/storage/paths";
import { makeUser, mediaFixtures, params, req } from "./helpers";

let alice: Awaited<ReturnType<typeof makeUser>>;
let mallory: Awaited<ReturnType<typeof makeUser>>;
let ids: { download: string; file: string; archive: string; connection: string; session: string };

beforeAll(async () => {
  alice = await makeUser("alice");
  mallory = await makeUser("mallory");
  const dl = await db().download.create({ data: { userId: alice.user.id, source: "USER_UPLOAD", status: "COMPLETED", sourceUrl: "https://www.instagram.com/p/AAAAAAA/" } });
  const abs = resolveStoragePath(`users/${alice.user.id}/downloads/${dl.id}/photo.jpg`);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, mediaFixtures().jpg);
  const file = await db().mediaFile.create({
    data: { userId: alice.user.id, downloadId: dl.id, kind: "IMAGE", mimeType: "image/jpeg", sizeBytes: BigInt(mediaFixtures().jpg.length), storagePath: toStorageRelative(abs), filename: "photo.jpg" },
  });
  const ar = await db().archiveImport.create({ data: { userId: alice.user.id, originalName: "x.zip", sizeBytes: 1n, status: "COMPLETED" } });
  await db().mediaFile.create({ data: { userId: alice.user.id, archiveId: ar.id, kind: "IMAGE", mimeType: "image/jpeg", sizeBytes: 1n, storagePath: toStorageRelative(abs), filename: "a.jpg", category: "post" } });
  const conn = await db().instagramConnection.create({ data: { userId: alice.user.id, igUserId: "1", username: "alice_ig", accessTokenEnc: encrypt("tok") } });
  const s = await db().session.findFirstOrThrow({ where: { userId: alice.user.id } });
  ids = { download: dl.id, file: file.id, archive: ar.id, connection: conn.id, session: s.id };
});

describe("unauthenticated access", () => {
  it("is refused everywhere", async () => {
    expect((await listDownloads(req("GET", "/api/downloads"))).status).toBe(401);
    expect((await getFile(req("GET", `/api/files/${ids.file}`), params({ id: ids.file }))).status).toBe(401);
    expect((await getArchive(req("GET", `/api/archives/${ids.archive}`), params({ id: ids.archive }))).status).toBe(401);
    expect((await archiveZip(req("GET", `/api/archives/${ids.archive}/zip`), params({ id: ids.archive }))).status).toBe(401);
  });
});

describe("cross-user access", () => {
  const as = () => ({ cookie: mallory.cookie, csrf: mallory.csrf });

  it("returns 404 for another user's resources", async () => {
    expect((await getDownload(req("GET", "/x", as()), params({ id: ids.download }))).status).toBe(404);
    expect((await downloadZip(req("GET", "/x", as()), params({ id: ids.download }))).status).toBe(404);
    expect((await getFile(req("GET", "/x", as()), params({ id: ids.file }))).status).toBe(404);
    expect((await getArchive(req("GET", "/x", as()), params({ id: ids.archive }))).status).toBe(404);
    expect((await archiveZip(req("GET", "/x", as()), params({ id: ids.archive }))).status).toBe(404);
    expect((await connMedia(req("GET", "/x", as()), params({ id: ids.connection }))).status).toBe(404);
  });

  it("cannot delete another user's resources", async () => {
    expect((await deleteDownloadRoute(req("DELETE", "/x", as()), params({ id: ids.download }))).status).toBe(404);
    expect((await deleteArchiveRoute(req("DELETE", "/x", as()), params({ id: ids.archive }))).status).toBe(404);
    expect((await disconnect(req("DELETE", "/x", as()), params({ id: ids.connection }))).status).toBe(404);
    expect((await revokeSession(req("DELETE", "/x", as()), params({ id: ids.session }))).status).toBe(404);
    await clearDownloads(req("DELETE", "/api/downloads", as()));
    expect(await db().download.findUnique({ where: { id: ids.download } })).not.toBeNull();
    expect(await db().instagramConnection.findUnique({ where: { id: ids.connection } })).not.toBeNull();
  });

  it("does not list another user's history", async () => {
    const r = await (await listDownloads(req("GET", "/api/downloads", as()))).json();
    expect(r.downloads).toHaveLength(0);
  });

  it("owner can access their file with safe headers", async () => {
    const r = await getFile(req("GET", "/x", { cookie: alice.cookie }), params({ id: ids.file }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await r.arrayBuffer()).equals(mediaFixtures().jpg)).toBe(true);
  });

  it("never exposes storage paths or tokens in API responses", async () => {
    const r = await (await getDownload(req("GET", "/x", { cookie: alice.cookie }), params({ id: ids.download }))).text();
    expect(r).not.toContain("storagePath");
    expect(r).not.toContain("users/");
    const c = await (await (await import("@/app/api/instagram/status/route")).GET(req("GET", "/x", { cookie: alice.cookie }))).text();
    expect(c).not.toContain("accessToken");
    expect(c).not.toContain("v1.");
  });
});
