import { rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { AppError } from "../http/errors";
import { sniffFile, type Sniffed } from "../media/sniff";
import { streamToFile } from "../security/safe-fetch";
import { ensureDir } from "../storage/paths";

export type ExtractLimits = {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  /** Max uncompressed:compressed ratio for entries over 1 MB (zip-bomb guard). */
  maxRatio: number;
  maxMetadataBytes: number;
};

export type ExtractedMedia = {
  /** Normalized path inside the archive (used only for metadata matching). */
  entryPath: string;
  /** Location of the staged file, named by us (never by the archive). */
  absPath: string;
  sniffed: Sniffed;
  size: number;
  mtime: Date;
};

export type ExtractResult = {
  media: ExtractedMedia[];
  metadata: Map<string, unknown>;
  skipped: number;
  totalEntries: number;
};

const MEDIA_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "mp4", "mov", "m4v"]);
/** JSON files that describe media in an Instagram export. */
const METADATA_FILE =
  /(^|\/)(posts_\d+|reels|stories|profile_photos|archived_posts|igtv_videos|recently_deleted_content|other_content|message_\d+)\.json$/i;

/**
 * Normalizes a ZIP entry name, returning null if it is unsafe: absolute paths,
 * drive letters, backslashes, NUL bytes or any `..` segment.
 */
export function normalizeEntryPath(name: string): string | null {
  if (!name || name.length > 1024) return null;
  if (name.includes("\0") || name.includes("\\")) return null;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return null;
  const parts: string[] = [];
  for (const seg of name.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

function isSymlink(entry: Entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  return mode === 0o120000;
}

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: false },
      (err, zf) => (err || !zf ? reject(new AppError("INVALID_ARCHIVE", "The file is not a valid ZIP archive.")) : resolve(zf)),
    ),
  );
}

function openEntry(zf: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zf.openReadStream(entry, (err, s) => (err || !s ? reject(new AppError("INVALID_ARCHIVE")) : resolve(s))),
  );
}

async function readBounded(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream) {
    n += (c as Buffer).length;
    if (n > max) {
      stream.destroy();
      throw new AppError("INVALID_ARCHIVE", "A metadata file is too large.");
    }
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Securely extracts supported media from a ZIP into `stagingDir`.
 *
 * - Rejects path traversal / absolute names (entire archive is refused).
 * - Skips symlinks, encrypted entries, directories and unsupported types.
 * - Enforces entry-count, per-entry, total-size and compression-ratio limits,
 *   counting real bytes while streaming (headers are not trusted).
 * - Output files are named by a counter, never by the archive's names, and
 *   validated by magic bytes. Nothing extracted is ever executed.
 */
export async function extractArchive(
  zipPath: string,
  stagingDir: string,
  limits: ExtractLimits,
  onProgress?: (processed: number, total: number) => void | Promise<void>,
): Promise<ExtractResult> {
  const zf = await openZip(zipPath);
  if (zf.entryCount > limits.maxEntries) {
    zf.close();
    throw new AppError("INVALID_ARCHIVE", `The archive has more than ${limits.maxEntries} entries.`);
  }
  await ensureDir(stagingDir);
  const result: ExtractResult = { media: [], metadata: new Map(), skipped: 0, totalEntries: zf.entryCount };
  let totalBytes = 0;
  let processed = 0;
  let counter = 0;

  return new Promise<ExtractResult>((resolve, reject) => {
    let done = false;
    const fail = (e: unknown) => {
      if (done) return;
      done = true;
      zf.close();
      reject(e instanceof AppError ? e : new AppError("INVALID_ARCHIVE"));
    };

    zf.on("error", fail);
    zf.on("end", () => {
      if (done) return;
      done = true;
      resolve(result);
    });

    zf.on("entry", (entry: Entry) => {
      handle(entry)
        .then(async () => {
          processed++;
          if (onProgress && processed % 100 === 0) await onProgress(processed, result.totalEntries);
          if (!done) zf.readEntry();
        })
        .catch(fail);
    });

    async function handle(entry: Entry) {
      const rel = normalizeEntryPath(entry.fileName);
      if (rel === null) throw new AppError("INVALID_ARCHIVE", "The archive contains unsafe file paths.");
      if (entry.fileName.endsWith("/")) return; // directory
      if (isSymlink(entry) || (entry.generalPurposeBitFlag & 0x1) !== 0) {
        result.skipped++;
        return;
      }
      const ext = path.extname(rel).slice(1).toLowerCase();

      if (ext === "json") {
        if (!METADATA_FILE.test(rel) || entry.uncompressedSize > limits.maxMetadataBytes) {
          result.skipped++;
          return;
        }
        const buf = await readBounded(await openEntry(zf, entry), limits.maxMetadataBytes);
        try {
          result.metadata.set(rel, JSON.parse(buf.toString("utf8")));
        } catch {
          result.skipped++;
        }
        return;
      }

      if (!MEDIA_EXT.has(ext)) {
        result.skipped++;
        return;
      }
      if (entry.uncompressedSize > limits.maxEntryBytes) {
        throw new AppError("INVALID_ARCHIVE", "A file in the archive exceeds the per-file size limit.");
      }
      if (
        entry.uncompressedSize > 1024 * 1024 &&
        entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize > limits.maxRatio
      ) {
        throw new AppError("INVALID_ARCHIVE", "The archive has a suspicious compression ratio.");
      }
      if (totalBytes + entry.uncompressedSize > limits.maxTotalBytes) {
        throw new AppError("INVALID_ARCHIVE", "The archive's extracted size exceeds the limit.");
      }

      const dest = path.join(stagingDir, `${String(counter++).padStart(7, "0")}.bin`);
      const stream = await openEntry(zf, entry);
      const written = await streamToFile(stream, dest, Math.min(entry.uncompressedSize, limits.maxEntryBytes)).catch(() => {
        throw new AppError("INVALID_ARCHIVE", "An entry is corrupt or its size doesn't match its header.");
      });
      totalBytes += written;
      if (totalBytes > limits.maxTotalBytes) throw new AppError("INVALID_ARCHIVE", "The archive's extracted size exceeds the limit.");

      const sniffed = await sniffFile(dest);
      if (!sniffed) {
        await rm(dest, { force: true });
        result.skipped++;
        return;
      }
      result.media.push({ entryPath: rel, absPath: dest, sniffed, size: written, mtime: entry.getLastModDate() });
    }

    zf.readEntry();
  });
}
