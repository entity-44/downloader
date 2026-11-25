import { open } from "node:fs/promises";
import type { FileKind } from "../types";

export type Sniffed = { mime: string; ext: string; kind: FileKind };

/**
 * Identifies a media file by its magic bytes (never by its name or a
 * client-supplied content type). Returns null for anything unsupported.
 */
export function sniffBuffer(b: Uint8Array): Sniffed | null {
  const ascii = (s: number, e: number) => String.fromCharCode(...b.subarray(s, e));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", kind: "IMAGE" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return { mime: "image/png", ext: "png", kind: "IMAGE" };
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return { mime: "image/gif", ext: "gif", kind: "IMAGE" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", kind: "IMAGE" };
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12).toLowerCase();
    if (["heic", "heix", "heim", "heis", "mif1", "msf1", "hevc", "hevx"].includes(brand)) return { mime: "image/heic", ext: "heic", kind: "IMAGE" };
    if (brand === "avif" || brand === "avis") return { mime: "image/avif", ext: "avif", kind: "IMAGE" };
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov", kind: "VIDEO" };
    if (/^(isom|iso\d|mp4\d|mp41|mp42|avc1|m4v |dash|3gp\d|3g2\w|mmp4|f4v |msnv|ndas|xavc)$/.test(brand)) {
      return { mime: brand === "m4v " ? "video/x-m4v" : "video/mp4", ext: brand === "m4v " ? "m4v" : "mp4", kind: "VIDEO" };
    }
  }
  return null;
}

export async function sniffFile(path: string): Promise<Sniffed | null> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(32);
    const { bytesRead } = await fh.read(buf, 0, 32, 0);
    return sniffBuffer(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

/** Browsers can preview these inline; others are download-only. */
export function isBrowserPreviewable(mime: string) {
  return ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "video/mp4", "video/quicktime", "video/x-m4v"].includes(mime);
}
