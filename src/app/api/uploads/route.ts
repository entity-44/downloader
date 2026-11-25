import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { authed, json } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";
import { downloadDTO } from "@/lib/serialize";
import { receiveBody, saveUserUpload } from "@/lib/uploads";

/**
 * Adds a media file the user already has and is authorized to keep (e.g. the
 * owner sent it to them). Raw body upload; metadata in headers.
 */
export const POST = authed(
  async ({ req, auth }) => {
    if (req.headers.get("x-authorization-attested") !== "true") {
      throw new AppError("VALIDATION", "Please confirm you own this media or have the owner's permission.");
    }
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "upload").slice(0, 200);
    const sourceUrl = req.headers.get("x-source-url") ? decodeURIComponent(req.headers.get("x-source-url")!) : null;
    const { path } = await receiveBody(req, getConfig().limits.maxUploadBytes, "upload");
    const id = await saveUserUpload(auth.user.id, path, filename, sourceUrl);
    const dl = await db().download.findUniqueOrThrow({ where: { id }, include: { files: true } });
    return json({ download: downloadDTO(dl) }, { status: 201 });
  },
  { limit: limiters.upload },
);
