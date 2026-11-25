import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { db } from "./db";
import { AppError } from "./http/errors";
import { parseInstagramUrl } from "./instagram/url";
import { sanitizeFilenamePart } from "./media/filenames";
import { streamToFile } from "./security/safe-fetch";
import { tmpFile } from "./storage/paths";
import { downloadDir, removeDir, storeMediaFile } from "./downloads/store";

/** Streams a raw request body to a temp file, enforcing a byte limit. */
export async function receiveBody(req: Request, maxBytes: number, prefix: string, ext = ""): Promise<{ path: string; bytes: number }> {
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new AppError("TOO_LARGE", `Limit is ${Math.round(maxBytes / 1048576)} MB.`);
  if (!req.body) throw new AppError("VALIDATION", "Empty upload.");
  const dest = await tmpFile(prefix, ext);
  const bytes = await streamToFile(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), dest, maxBytes);
  if (bytes === 0) {
    await rm(dest, { force: true });
    throw new AppError("VALIDATION", "Empty upload.");
  }
  return { path: dest, bytes };
}

/**
 * Stores media the user already has (e.g. a file the owner sent them). The
 * user attests they are authorized; files are validated by content.
 */
export async function saveUserUpload(userId: string, tmpPath: string, originalName: string, sourceUrl?: string | null) {
  let canonical: string | null = null;
  let shortcode: string | null = null;
  if (sourceUrl) {
    const p = parseInstagramUrl(sourceUrl);
    canonical = p.canonicalUrl;
    shortcode = "shortcode" in p ? p.shortcode : null;
  }
  const dl = await db().download.create({
    data: { userId, source: "USER_UPLOAD", status: "PROCESSING", sourceUrl: canonical, shortcode },
  });
  const dir = downloadDir(userId, dl.id);
  try {
    const base = sanitizeFilenamePart(originalName.replace(/\.[^.]*$/, ""), 80);
    const stored = await storeMediaFile(tmpPath, dir, base);
    await db().$transaction([
      db().mediaFile.create({
        data: {
          userId,
          downloadId: dl.id,
          kind: stored.sniffed.kind,
          mimeType: stored.sniffed.mime,
          sizeBytes: BigInt(stored.sizeBytes),
          storagePath: stored.storagePath,
          thumbPath: stored.thumbPath,
          filename: `${base}.${stored.sniffed.ext}`,
          category: "provided",
          width: stored.width,
          height: stored.height,
          durationSec: stored.durationSec,
        },
      }),
      db().download.update({
        where: { id: dl.id },
        data: { status: "COMPLETED", mediaType: stored.sniffed.kind, completedAt: new Date() },
      }),
    ]);
    return dl.id;
  } catch (e) {
    await rm(tmpPath, { force: true });
    await removeDir(dir);
    await db().download.delete({ where: { id: dl.id } });
    throw e;
  }
}
