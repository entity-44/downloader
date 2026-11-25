import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import yazl from "yazl";
import { contentDisposition, uniqueNamer } from "../media/filenames";

export type ZipItem = { absPath: string; name: string; mtime?: Date };

/**
 * Streams a ZIP of the given files without buffering them in memory.
 * Media is already compressed, so entries are stored (no deflate).
 */
export function zipResponse(items: ZipItem[], zipName: string): Response {
  const zip = new yazl.ZipFile();
  const unique = uniqueNamer();
  for (const it of items) {
    if (!existsSync(it.absPath)) continue;
    zip.addFile(it.absPath, unique(it.name), { compress: false, mtime: it.mtime ?? new Date(), mode: 0o100644 });
  }
  zip.end();
  const body = Readable.toWeb(zip.outputStream as Readable) as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": contentDisposition(zipName),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
