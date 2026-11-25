import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { fileResponse } from "@/lib/http/files";
import { authed } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";
import { resolveStoragePath } from "@/lib/storage/paths";

/**
 * Serves a stored file to its owner only. Other users get 404 (not 403) so
 * file ids can't be probed. `?inline=1` previews; `?variant=thumb` serves the
 * generated poster frame.
 */
const handler = authed<{ id: string }>(
  async ({ req, auth, params }) => {
    const file = await db().mediaFile.findFirst({ where: { id: params.id, userId: auth.user.id } });
    if (!file) throw new AppError("NOT_FOUND");
    const sp = new URL(req.url).searchParams;
    if (sp.get("variant") === "thumb") {
      if (!file.thumbPath) throw new AppError("NOT_FOUND");
      return fileResponse(req, resolveStoragePath(file.thumbPath), {
        mime: "image/jpeg",
        filename: file.filename.replace(/\.[^.]+$/, "_thumb.jpg"),
        inline: true,
      });
    }
    return fileResponse(req, resolveStoragePath(file.storagePath), {
      mime: file.mimeType,
      filename: file.filename,
      inline: sp.get("inline") === "1",
    });
  },
  { limit: limiters.files },
);

export const GET = handler;
export const HEAD = handler;
