export function sanitize(input: string, max = 80): string {
  const s = input
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, max);
  return s || "file";
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateStamp = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function postFilename(o: { platform: string; author?: string; id: string; takenAt?: string; index: number; total: number; ext: string }) {
  const parts = [o.platform];
  if (o.author) parts.push(sanitize(o.author, 30));
  parts.push(sanitize(o.id, 40));
  if (o.takenAt) parts.push(dateStamp(new Date(o.takenAt)));
  if (o.total > 1) parts.push(pad(o.index + 1));
  return `${parts.join("_")}.${o.ext}`;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatBytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatDuration(sec?: number | null) {
  if (!sec) return "";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}
