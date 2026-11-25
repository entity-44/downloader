import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { authed } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";
import { resolveStoragePath } from "@/lib/storage/paths";
import { zipResponse } from "@/lib/storage/zip";
import { ARCHIVE_CATEGORIES } from "@/lib/types";

/**
 * Bulk download. Filters: ?category=post&kind=VIDEO or ?ids=a,b,c (max 2000).
 * Files are placed in category/year folders inside the ZIP.
 */
export const GET = authed<{ id: string }>(
  async ({ req, auth, params }) => {
    const archive = await db().archiveImport.findFirst({ where: { id: params.id, userId: auth.user.id } });
    if (!archive) throw new AppError("NOT_FOUND");
    const sp = new URL(req.url).searchParams;
    const ids = sp.get("ids")?.split(",").filter((s) => /^[a-z0-9]{10,40}$/i.test(s)).slice(0, 2000);
    const category = sp.get("category");
    const kind = sp.get("kind");
    const files = await db().mediaFile.findMany({
      where: {
        archiveId: archive.id,
        userId: auth.user.id,
        ...(ids?.length ? { id: { in: ids } } : {}),
        ...(category && (ARCHIVE_CATEGORIES as readonly string[]).includes(category) ? { category } : {}),
        ...(kind === "IMAGE" || kind === "VIDEO" ? { kind } : {}),
      },
      orderBy: { takenAt: "asc" },
    });
    if (!files.length) throw new AppError("NOT_FOUND");
    const items = files.map((f) => ({
      absPath: resolveStoragePath(f.storagePath),
      name: `${f.category ?? "other"}/${f.takenAt ? f.takenAt.getUTCFullYear() : "undated"}/${f.filename}`,
      mtime: f.takenAt ?? f.createdAt,
    }));
    const suffix = ids?.length ? "selection" : [category, kind?.toLowerCase()].filter(Boolean).join("_") || "all";
    return zipResponse(items, `instagram_archive_${suffix}.zip`);
  },
  { limit: limiters.files },
);
