import { BlobReader, BlobWriter, TextWriter, ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";
import { dateStamp } from "./files";
import { buildMetadataIndex, categoryFromPath, dateFromPath, lookupMeta, METADATA_FILE, type Category } from "./metadata";
import { sniffBlob } from "./sniff";
import { makeThumb } from "./thumbs";
import { UserError, type Kind } from "./types";

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|mp4|mov|m4v)$/i;
const MAX_ENTRY = 4 * 1024 ** 3;
const MAX_METADATA = 64 * 1024 ** 2;

export type ImportProgress = { phase: "reading" | "importing" | "done"; done: number; total: number; current?: string };

export type ExportItem = {
  id: string;
  kind: Kind;
  mime: string;
  size: number;
  filename: string;
  category: Category;
  caption?: string;
  takenAt?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  /** Small in-memory preview (object URL); the original stays inside the ZIP. */
  thumbUrl: string | null;
  entry: FileEntry;
};

/** A temporarily opened export. Nothing is persisted; close() frees everything. */
export type OpenedExport = {
  name: string;
  items: ExportItem[];
  skipped: number;
  getBlob: (item: ExportItem) => Promise<Blob>;
  close: () => Promise<void>;
};

/** Normalizes an entry name for metadata matching; null if it looks unsafe. */
export function normalizeEntryPath(name: string): string | null {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return null;
  const parts: string[] = [];
  for (const seg of name.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

const isFile = (e: Entry): e is FileEntry => !e.directory && !e.encrypted;

/**
 * Opens an Instagram data export in the browser for one-time browsing. The ZIP
 * is read in pieces; each file is extracted once to verify it and make a small
 * thumbnail, then released. Originals are re-extracted only when downloaded.
 */
export async function openExport(file: File, onProgress: (p: ImportProgress) => void, signal?: AbortSignal): Promise<OpenedExport> {
  const reader = new ZipReader(new BlobReader(file));
  let entries: Entry[];
  try {
    entries = await reader.getEntries();
  } catch {
    await reader.close().catch(() => {});
    throw new UserError("That file isn't a valid ZIP archive.");
  }
  const items: ExportItem[] = [];
  const close = async () => {
    for (const it of items) if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    await reader.close().catch(() => {});
  };
  try {
    onProgress({ phase: "reading", done: 0, total: entries.length });
    const metadata = new Map<string, unknown>();
    const media: Array<{ entry: FileEntry; path: string }> = [];
    let skipped = 0;
    for (const e of entries) {
      if (!isFile(e)) {
        if (!e.directory) skipped++;
        continue;
      }
      const path = normalizeEntryPath(e.filename);
      if (!path) {
        skipped++;
        continue;
      }
      if (METADATA_FILE.test(path) && e.uncompressedSize <= MAX_METADATA) {
        try {
          metadata.set(path, JSON.parse(await e.getData(new TextWriter())));
        } catch {
          skipped++;
        }
      } else if (MEDIA_EXT.test(path) && e.uncompressedSize <= MAX_ENTRY) media.push({ entry: e, path });
      else skipped++;
    }
    if (!media.length) throw new UserError("No photos or videos were found. Make sure this is your Instagram data export ZIP (with media included).");

    const index = buildMetadataIndex(metadata);
    const planned = media
      .map((m) => {
        const meta = lookupMeta(index, m.path);
        const byPath = categoryFromPath(m.path);
        return { ...m, category: byPath === "other" && meta?.category ? meta.category : byPath, takenAt: meta?.takenAt ?? dateFromPath(m.path), caption: meta?.caption ?? null };
      })
      .sort((a, b) => (a.takenAt?.getTime() ?? 0) - (b.takenAt?.getTime() ?? 0));

    for (let i = 0; i < planned.length; i++) {
      if (signal?.aborted) throw new UserError("Import cancelled.");
      const p = planned[i];
      onProgress({ phase: "importing", done: i, total: planned.length, current: p.path.split("/").pop() });
      const raw = await p.entry.getData(new BlobWriter());
      const sn = await sniffBlob(raw);
      if (!sn) {
        skipped++;
        continue;
      }
      const { thumb, width, height, ...rest } = await makeThumb(new Blob([raw], { type: sn.mime }), sn.kind);
      items.push({
        id: `${i}`,
        kind: sn.kind,
        mime: sn.mime,
        size: raw.size,
        filename: `keepsake_${p.category}_${p.takenAt ? dateStamp(p.takenAt) : "undated"}_${String(i + 1).padStart(5, "0")}.${sn.ext}`,
        category: p.category,
        caption: p.caption ?? undefined,
        takenAt: p.takenAt?.toISOString(),
        durationSec: "durationSec" in rest ? (rest.durationSec as number | undefined) : undefined,
        width,
        height,
        thumbUrl: thumb ? URL.createObjectURL(thumb) : null,
        entry: p.entry,
      });
    }
    onProgress({ phase: "done", done: planned.length, total: planned.length });
    return {
      name: file.name.replace(/\.zip$/i, ""),
      items,
      skipped,
      getBlob: async (it) => new Blob([await it.entry.getData(new BlobWriter())], { type: it.mime }),
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
