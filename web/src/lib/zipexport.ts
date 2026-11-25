import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { saveBlob } from "./files";

export type ZipSource = { name: string; blob?: Blob; getBlob?: () => Promise<Blob>; date?: Date };

/** Builds a ZIP (stored, no recompression) and saves it. Names are de-duplicated. */
export async function zipAndSave(files: ZipSource[], zipName: string, onProgress?: (done: number, total: number) => void) {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { level: 0 });
  const used = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const blob = f.blob ?? (await f.getBlob!());
    let name = f.name;
    for (let n = 1; used.has(name.toLowerCase()); n++) name = f.name.replace(/(\.[^.]+)$/, `_${n}$1`);
    used.add(name.toLowerCase());
    await writer.add(name, new BlobReader(blob), { lastModDate: f.date ?? new Date() });
    onProgress?.(i + 1, files.length);
  }
  saveBlob(await writer.close(), zipName);
}
