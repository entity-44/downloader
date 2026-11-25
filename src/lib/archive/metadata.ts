import type { ArchiveCategory } from "../types";

export type MediaMeta = { takenAt: Date | null; caption: string | null; category: ArchiveCategory | null };

/**
 * Meta's JSON exports encode UTF-8 text as Latin-1 escapes ("Ã©" for "é").
 * Re-decode when the string looks like mis-decoded UTF-8.
 */
export function fixMojibake(s: string): string {
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const decoded = Buffer.from(s, "latin1").toString("utf8");
  return decoded.includes("�") ? s : decoded;
}

export function categoryFromMetadataFile(file: string): ArchiveCategory | null {
  const base = file.split("/").pop()!.toLowerCase();
  if (base.startsWith("posts_")) return "post";
  if (base === "reels.json") return "reel";
  if (base === "stories.json") return "story";
  if (base === "profile_photos.json") return "profile";
  if (base === "archived_posts.json" || base === "recently_deleted_content.json") return "archived";
  if (base === "igtv_videos.json") return "igtv";
  if (base.startsWith("message_")) return "message";
  return null;
}

export function categoryFromPath(p: string): ArchiveCategory {
  const s = `/${p.toLowerCase()}`;
  if (s.includes("/messages/")) return "message";
  if (s.includes("/media/posts/")) return "post";
  if (s.includes("/media/reels/")) return "reel";
  if (s.includes("/media/stories/")) return "story";
  if (s.includes("/media/profile/")) return "profile";
  if (s.includes("/media/archived_posts/") || s.includes("/recently_deleted")) return "archived";
  if (s.includes("/media/igtv/")) return "igtv";
  return "other";
}

/** Exports group media in YYYYMM folders; use it when no timestamp exists. */
export function dateFromPath(p: string): Date | null {
  const m = p.match(/(?:^|\/)(20\d{2})(0[1-9]|1[0-2])(?:\/|$)/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null;
}

function toDate(ts: unknown): Date | null {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return d.getUTCFullYear() >= 2010 && d.getTime() <= Date.now() + 86_400_000 ? d : null;
}

function normUri(uri: string) {
  return uri.replace(/^\.?\/+/, "").replace(/\\/g, "/");
}

/**
 * Walks every metadata JSON generically (the export schema changes often) and
 * collects { uri → timestamp, caption, category }.
 */
export function buildMetadataIndex(metadata: Map<string, unknown>): Map<string, MediaMeta> {
  const index = new Map<string, MediaMeta>();
  for (const [file, json] of metadata) {
    const category = categoryFromMetadataFile(file);
    const walk = (node: unknown, ctx: { ts: unknown; caption: string | null }, depth: number) => {
      if (depth > 12 || node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const n of node) walk(n, ctx, depth + 1);
        return;
      }
      const o = node as Record<string, unknown>;
      const title = typeof o.title === "string" && o.title.trim() ? fixMojibake(o.title.trim()) : null;
      const next = { ts: o.creation_timestamp ?? o.timestamp_ms ?? ctx.ts, caption: title ?? ctx.caption };
      if (typeof o.uri === "string" && o.uri.length < 1024) {
        const key = normUri(o.uri);
        if (!index.has(key)) {
          index.set(key, {
            takenAt: toDate(o.creation_timestamp ?? next.ts),
            caption: next.caption ? next.caption.slice(0, 2200) : null,
            category,
          });
        }
      }
      for (const [k, v] of Object.entries(o)) if (k !== "uri" && typeof v === "object") walk(v, next, depth + 1);
    };
    walk(json, { ts: undefined, caption: null }, 0);
  }
  return index;
}

/** Matches an archive entry path to a metadata URI, tolerating a top-level prefix folder. */
export function lookupMeta(index: Map<string, MediaMeta>, entryPath: string): MediaMeta | undefined {
  const parts = entryPath.split("/");
  for (let i = 0; i < Math.min(parts.length, 4); i++) {
    const hit = index.get(parts.slice(i).join("/"));
    if (hit) return hit;
  }
  return undefined;
}
