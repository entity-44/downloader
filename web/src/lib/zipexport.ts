import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { getBlob, type Item } from "./db";
import { saveBlob } from "./files";

/** Builds a ZIP (stored, no recompression) of library items and saves it. */
export async function downloadZip(items: Item[], zipName: string, onProgress?: (done: number, total: number) => void) {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { level: 0 });
  const used = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const blob = await getBlob(it.id);
    if (!blob) continue;
    const folder = it.category ? `${it.category}/` : "";
    let name = folder + it.filename;
    for (let n = 1; used.has(name.toLowerCase()); n++) name = folder + it.filename.replace(/(\.[^.]+)$/, `_${n}$1`);
    used.add(name.toLowerCase());
    await writer.add(name, new BlobReader(blob), { lastModDate: it.takenAt ? new Date(it.takenAt) : new Date() });
    onProgress?.(i + 1, items.length);
  }
  saveBlob(await writer.close(), zipName);
}

/** ZIP straight from in-memory blobs (download results not saved to the library). */
export async function zipBlobs(files: Array<{ name: string; blob: Blob }>, zipName: string) {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { level: 0 });
  for (const f of files) await writer.add(f.name, new BlobReader(f.blob));
  saveBlob(await writer.close(), zipName);
}
