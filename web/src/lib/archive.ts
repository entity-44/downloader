import { BlobReader, BlobWriter, TextWriter, ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";
import { addItem, newId, putCollection, type Collection } from "./db";
import { dateStamp } from "./files";
import { buildMetadataIndex, categoryFromPath, dateFromPath, lookupMeta, METADATA_FILE } from "./metadata";
import { sniffBlob } from "./sniff";
import { makeThumb } from "./thumbs";
import { UserError } from "./types";

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|mp4|mov|m4v)$/i;
const MAX_ENTRY = 4 * 1024 ** 3;
const MAX_METADATA = 64 * 1024 ** 2;

export type ImportProgress = { phase: "reading" | "importing" | "done"; done: number; total: number; current?: string };

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
 * Imports an Instagram data export entirely in the browser. The ZIP is read
 * in pieces (never loaded fully into memory); only images and videos verified
 * by their content are kept.
 */
export async function importArchive(file: File, onProgress: (p: ImportProgress) => void, signal?: AbortSignal): Promise<{ collection: Collection; skipped: number }> {
  const reader = new ZipReader(new BlobReader(file));
  let entries: Entry[];
  try {
    entries = await reader.getEntries();
  } catch {
    throw new UserError("That file isn't a valid ZIP archive.");
  }
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

    const collection: Collection = {
      id: newId(),
      source: "export",
      title: file.name.replace(/\.zip$/i, ""),
      createdAt: new Date().toISOString(),
      count: 0,
      sizeBytes: 0,
    };
    await putCollection(collection);

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
      const blob = new Blob([raw], { type: sn.mime });
      const { thumb, width, height, ...rest } = await makeThumb(blob, sn.kind);
      const id = newId();
      const stamp = p.takenAt ? dateStamp(p.takenAt) : "undated";
      await addItem(
        {
          id,
          collectionId: collection.id,
          kind: sn.kind,
          mime: sn.mime,
          size: blob.size,
          filename: `${p.category}_${stamp}_${String(i + 1).padStart(5, "0")}.${sn.ext}`,
          category: p.category,
          caption: p.caption ?? undefined,
          takenAt: p.takenAt?.toISOString(),
          position: i,
          width,
          height,
          durationSec: "durationSec" in rest ? (rest.durationSec as number | undefined) : undefined,
          hasThumb: !!thumb,
        },
        blob,
        thumb,
      );
      collection.count++;
      collection.sizeBytes += blob.size;
      collection.coverId ??= id;
      if (i % 25 === 0) await putCollection(collection);
    }
    await putCollection(collection);
    onProgress({ phase: "done", done: planned.length, total: planned.length });
    return { collection, skipped };
  } finally {
    await reader.close();
  }
}
