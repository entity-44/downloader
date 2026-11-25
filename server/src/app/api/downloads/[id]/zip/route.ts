import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { authed } from "@/lib/http/handler";
import { sanitizeFilenamePart } from "@/lib/media/filenames";
import { limiters } from "@/lib/security/rate-limit";
import { resolveStoragePath } from "@/lib/storage/paths";
import { zipResponse } from "@/lib/storage/zip";

export const GET = authed<{ id: string }>(
  async ({ auth, params }) => {
    const dl = await db().download.findFirst({ where: { id: params.id, userId: auth.user.id }, include: { files: true } });
    if (!dl || !dl.files.length) throw new AppError("NOT_FOUND");
    const items = dl.files
      .sort((a, b) => a.position - b.position)
      .map((f) => ({ absPath: resolveStoragePath(f.storagePath), name: f.filename, mtime: f.takenAt ?? f.createdAt }));
    const name = ["instagram", dl.ownerUsername, dl.shortcode ?? dl.id].filter(Boolean).map((s) => sanitizeFilenamePart(s!)).join("_");
    return zipResponse(items, `${name}.zip`);
  },
  { limit: limiters.files },
);
