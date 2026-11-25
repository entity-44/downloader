/** Removes anything that could act as a path, control or shell character. */
export function sanitizeFilenamePart(input: string, maxLen = 80): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .slice(0, maxLen);
  return cleaned || "file";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dateStamp(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function timeStamp(d: Date) {
  return `${dateStamp(d)}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** e.g. instagram_myaccount_reel_C1a2b3_2024-05-01_02.mp4 */
export function downloadFilename(o: {
  username?: string | null;
  kind: string;
  shortcode?: string | null;
  takenAt?: Date | null;
  index: number;
  total: number;
  ext: string;
}) {
  const parts = ["instagram"];
  if (o.username) parts.push(sanitizeFilenamePart(o.username, 30));
  parts.push(o.kind);
  if (o.shortcode) parts.push(sanitizeFilenamePart(o.shortcode, 64));
  if (o.takenAt) parts.push(dateStamp(o.takenAt));
  if (o.total > 1) parts.push(pad(o.index + 1));
  return `${parts.join("_")}.${o.ext}`;
}

export function archiveFilename(category: string, takenAt: Date | null, index: number, ext: string) {
  return `${sanitizeFilenamePart(category, 20)}_${takenAt ? timeStamp(takenAt) : "undated"}_${String(index).padStart(5, "0")}.${ext}`;
}

/** RFC 6266 Content-Disposition with ASCII fallback and UTF-8 filename*. */
export function contentDisposition(filename: string, inline = false) {
  const m = filename.match(/^(.*?)(?:\.([A-Za-z0-9]{1,8}))?$/s)!;
  const safe = m[2] ? `${sanitizeFilenamePart(m[1], 150)}.${m[2].toLowerCase()}` : sanitizeFilenamePart(filename, 150);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** Ensures unique names inside a ZIP. */
export function uniqueNamer() {
  const used = new Set<string>();
  return (name: string) => {
    let candidate = name;
    let i = 1;
    while (used.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      candidate = dot > 0 ? `${name.slice(0, dot)}_${i}${name.slice(dot)}` : `${name}_${i}`;
      i++;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };
}
