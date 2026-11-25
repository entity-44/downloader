import type { Kind } from "./types";

export type Sniffed = { mime: string; ext: string; kind: Kind };

/** Identifies media by magic bytes, never by filename. */
export function sniff(b: Uint8Array): Sniffed | null {
  const ascii = (s: number, e: number) => String.fromCharCode(...b.subarray(s, e));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", kind: "IMAGE" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return { mime: "image/png", ext: "png", kind: "IMAGE" };
  if (b.length >= 6 && ascii(0, 3) === "GIF") return { mime: "image/gif", ext: "gif", kind: "IMAGE" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", kind: "IMAGE" };
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12).toLowerCase();
    if (["heic", "heix", "heim", "heis", "mif1", "msf1"].includes(brand)) return { mime: "image/heic", ext: "heic", kind: "IMAGE" };
    if (brand === "avif" || brand === "avis") return { mime: "image/avif", ext: "avif", kind: "IMAGE" };
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov", kind: "VIDEO" };
    return { mime: "video/mp4", ext: "mp4", kind: "VIDEO" };
  }
  // Fragmented MP4 (DASH) may start with a moov/styp/sidx box instead of ftyp.
  if (b.length >= 8 && ["moov", "styp", "sidx", "moof"].includes(ascii(4, 8))) return { mime: "video/mp4", ext: "mp4", kind: "VIDEO" };
  return null;
}

export async function sniffBlob(blob: Blob): Promise<Sniffed | null> {
  return sniff(new Uint8Array(await blob.slice(0, 32).arrayBuffer()));
}
