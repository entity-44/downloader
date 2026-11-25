import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";
import { db } from "../db";
import { downloadDir } from "../downloads/store";
import { log } from "../log";

/** Deletes temp files older than TEMP_FILE_MAX_AGE_HOURS. */
export async function cleanTempDir(now = Date.now()) {
  const { tmpDir, tempFileMaxAgeMs } = getConfig();
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(tmpDir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const p = path.join(tmpDir, name);
    try {
      const s = await stat(p);
      if (now - s.mtimeMs > tempFileMaxAgeMs) {
        await rm(p, { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* raced with another delete */
    }
  }
  return removed;
}

/** Removes files of downloads whose retention period has passed. */
export async function expireDownloads(now = new Date()) {
  const expired = await db().download.findMany({
    where: { expiresAt: { lte: now }, status: "COMPLETED" },
    select: { id: true, userId: true },
  });
  for (const d of expired) {
    await rm(downloadDir(d.userId, d.id), { recursive: true, force: true });
    await db().$transaction([
      db().mediaFile.deleteMany({ where: { downloadId: d.id } }),
      db().download.update({ where: { id: d.id }, data: { status: "EXPIRED" } }),
    ]);
  }
  return expired.length;
}

export async function purgeExpiredAuth(now = new Date()) {
  await db().session.deleteMany({ where: { expiresAt: { lte: now } } });
  await db().oAuthState.deleteMany({ where: { expiresAt: { lte: now } } });
}

export async function runCleanup() {
  try {
    const tmp = await cleanTempDir();
    const exp = await expireDownloads();
    await purgeExpiredAuth();
    if (tmp || exp) log.info("Cleanup completed", { tempFilesRemoved: tmp, downloadsExpired: exp });
  } catch (e) {
    log.error("Cleanup failed", { error: e });
  }
}

/** Jobs that were running when the server stopped can't resume; mark them failed. */
export async function recoverInterruptedJobs() {
  const msg = "Processing was interrupted by a server restart. Please try again.";
  await db().download.updateMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "FAILED", errorCode: "PROCESSING_FAILED", errorMessage: msg },
  });
  const stuck = await db().archiveImport.findMany({ where: { status: { in: ["PENDING", "PROCESSING"] } } });
  for (const a of stuck) {
    await rm(path.join(getConfig().storageDir, "users", a.userId, "archives", a.id), { recursive: true, force: true });
    await db().mediaFile.deleteMany({ where: { archiveId: a.id } });
  }
  await db().archiveImport.updateMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "FAILED", errorMessage: msg },
  });
}

let timer: NodeJS.Timeout | undefined;
export function startCleanupScheduler() {
  if (timer) return;
  timer = setInterval(runCleanup, getConfig().cleanupIntervalMs);
  timer.unref();
  void runCleanup();
}
