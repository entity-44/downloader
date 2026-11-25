import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../http/errors";
import { createVideoThumbnail, probeVideo } from "../media/ffmpeg";
import { sniffFile, type Sniffed } from "../media/sniff";
import { ensureDir, toStorageRelative, userDir } from "../storage/paths";

export function downloadDir(userId: string, downloadId: string) {
  if (!/^[a-z0-9]+$/i.test(downloadId)) throw new Error("Invalid id");
  return path.join(userDir(userId), "downloads", downloadId);
}

export type StoredMedia = {
  sniffed: Sniffed;
  storagePath: string;
  thumbPath: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
};

/**
 * Validates a temp file by magic bytes and moves it into private storage.
 * Rejects (and deletes) anything that is not a supported image or video.
 */
export async function storeMediaFile(tmpPath: string, destDir: string, filenameBase: string): Promise<StoredMedia> {
  const sniffed = await sniffFile(tmpPath);
  if (!sniffed) {
    await rm(tmpPath, { force: true });
    throw new AppError("UNSUPPORTED_FILE", "Only JPEG, PNG, GIF, WebP, HEIC/AVIF images and MP4/MOV videos are accepted.");
  }
  await ensureDir(destDir);
  const filename = `${filenameBase}.${sniffed.ext}`;
  const dest = path.join(destDir, filename);
  await rename(tmpPath, dest).catch(async (e: NodeJS.ErrnoException) => {
    if (e.code !== "EXDEV") throw e;
    const { copyFile } = await import("node:fs/promises");
    await copyFile(tmpPath, dest);
    await rm(tmpPath, { force: true });
  });
  const size = (await stat(dest)).size;
  let thumbPath: string | null = null;
  let info = { width: null as number | null, height: null as number | null, durationSec: null as number | null };
  if (sniffed.kind === "VIDEO") {
    info = (await probeVideo(dest)) ?? info;
    const thumbDir = await ensureDir(path.join(destDir, ".thumbs"));
    const thumb = path.join(thumbDir, `${filenameBase}.jpg`);
    if (await createVideoThumbnail(dest, thumb, info.durationSec)) thumbPath = toStorageRelative(thumb);
  }
  return { sniffed, storagePath: toStorageRelative(dest), thumbPath, sizeBytes: size, ...info };
}

export async function removeDir(dir: string) {
  await rm(dir, { recursive: true, force: true });
}

export { mkdir };
