import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";
import { db } from "../db";
import { AppError, publicMessage } from "../http/errors";
import { log } from "../log";
import { createVideoThumbnail, probeVideo } from "../media/ffmpeg";
import { archiveFilename } from "../media/filenames";
import { queues } from "../queue";
import { ensureDir, toStorageRelative, userDir } from "../storage/paths";
import { extractArchive, type ExtractLimits } from "./extract";
import { buildMetadataIndex, categoryFromPath, dateFromPath, lookupMeta } from "./metadata";

export function archiveDir(userId: string, archiveId: string) {
  if (!/^[a-z0-9]+$/i.test(archiveId)) throw new Error("Invalid id");
  return path.join(userDir(userId), "archives", archiveId);
}

export function defaultLimits(): ExtractLimits {
  const l = getConfig().limits;
  return {
    maxEntries: l.maxArchiveEntries,
    maxTotalBytes: l.maxArchiveExtractedBytes,
    maxEntryBytes: l.maxArchiveEntryBytes,
    maxRatio: 200,
    maxMetadataBytes: 64 * 1024 * 1024,
  };
}

export function enqueueArchive(archiveId: string, zipPath: string, limits = defaultLimits()) {
  queues().archives.add(`archive:${archiveId}`, () => processArchive(archiveId, zipPath, limits));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Extracts, organizes (category/year/month) and indexes an uploaded export. */
export async function processArchive(archiveId: string, zipPath: string, limits = defaultLimits()) {
  const archive = await db().archiveImport.findUnique({ where: { id: archiveId } });
  if (!archive) {
    await rm(zipPath, { force: true });
    return;
  }
  const root = archiveDir(archive.userId, archive.id);
  const staging = path.join(root, ".staging");
  try {
    await db().archiveImport.update({ where: { id: archive.id }, data: { status: "PROCESSING" } });
    const res = await extractArchive(zipPath, staging, limits, (processed, total) =>
      db().archiveImport.update({ where: { id: archive.id }, data: { processedEntries: processed, totalEntries: total } }).then(() => {}),
    );
    await rm(zipPath, { force: true });

    if (!res.media.length) {
      throw new AppError(
        "INVALID_ARCHIVE",
        "No photos or videos were found. Make sure you uploaded the Instagram data export ZIP (JSON or HTML format, with media included).",
      );
    }

    const index = buildMetadataIndex(res.metadata);
    const sorted = res.media
      .map((m) => {
        const meta = lookupMeta(index, m.entryPath);
        return {
          m,
          category: meta?.category && categoryFromPath(m.entryPath) === "other" ? meta.category : categoryFromPath(m.entryPath),
          takenAt: meta?.takenAt ?? dateFromPath(m.entryPath),
          caption: meta?.caption ?? null,
        };
      })
      .sort((a, b) => (a.takenAt?.getTime() ?? 0) - (b.takenAt?.getTime() ?? 0));

    const rows = [];
    let i = 0;
    for (const it of sorted) {
      i++;
      const sub = it.takenAt
        ? path.join(it.category, String(it.takenAt.getUTCFullYear()), pad2(it.takenAt.getUTCMonth() + 1))
        : path.join(it.category, "undated");
      const dir = await ensureDir(path.join(root, sub));
      const filename = archiveFilename(it.category, it.takenAt, i, it.m.sniffed.ext);
      const dest = path.join(dir, filename);
      await rename(it.m.absPath, dest);
      rows.push({
        userId: archive.userId,
        archiveId: archive.id,
        kind: it.m.sniffed.kind,
        mimeType: it.m.sniffed.mime,
        sizeBytes: BigInt(it.m.size),
        storagePath: toStorageRelative(dest),
        filename,
        category: it.category,
        caption: it.caption,
        takenAt: it.takenAt,
        position: i,
      });
    }
    for (let s = 0; s < rows.length; s += 500) await db().mediaFile.createMany({ data: rows.slice(s, s + 500) });
    await rm(staging, { recursive: true, force: true });

    await db().archiveImport.update({
      where: { id: archive.id },
      data: {
        status: "COMPLETED",
        fileCount: rows.length,
        skippedCount: res.skipped,
        totalEntries: res.totalEntries,
        processedEntries: res.totalEntries,
        completedAt: new Date(),
      },
    });

    await generateThumbnails(archive.id);
  } catch (e) {
    const { code, message } = publicMessage(e);
    if (code === "PROCESSING_FAILED") log.error("Archive import failed", { archiveId, error: e });
    await rm(zipPath, { force: true }).catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await db().mediaFile.deleteMany({ where: { archiveId: archive.id } });
    await db().archiveImport.update({
      where: { id: archive.id },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    });
  }
}

/** Poster frames + duration for imported videos (best effort). */
async function generateThumbnails(archiveId: string) {
  const videos = await db().mediaFile.findMany({ where: { archiveId, kind: "VIDEO", thumbPath: null } });
  for (const v of videos) {
    const abs = path.join(getConfig().storageDir, v.storagePath);
    const info = await probeVideo(abs);
    const thumbDir = await ensureDir(path.join(path.dirname(abs), ".thumbs"));
    const thumb = path.join(thumbDir, `${path.parse(abs).name}.jpg`);
    const ok = await createVideoThumbnail(abs, thumb, info?.durationSec);
    await db().mediaFile.update({
      where: { id: v.id },
      data: {
        thumbPath: ok ? toStorageRelative(thumb) : null,
        durationSec: info?.durationSec ?? null,
        width: info?.width ?? null,
        height: info?.height ?? null,
      },
    });
  }
}

export async function deleteArchive(userId: string, id: string) {
  const a = await db().archiveImport.findFirst({ where: { id, userId } });
  if (!a) throw new AppError("NOT_FOUND");
  if (a.status === "PROCESSING" || a.status === "PENDING") throw new AppError("CONFLICT", "Wait for the import to finish before deleting it.");
  await rm(archiveDir(userId, id), { recursive: true, force: true });
  await db().archiveImport.delete({ where: { id } });
}
