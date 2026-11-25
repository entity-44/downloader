import { open as openFile, rm } from "node:fs/promises";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { enqueueArchive } from "@/lib/archive/import";
import { AppError } from "@/lib/http/errors";
import { authed, json } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";
import { archiveDTO } from "@/lib/serialize";
import { receiveBody } from "@/lib/uploads";

export const GET = authed(async ({ auth }) => {
  const rows = await db().archiveImport.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: "desc" } });
  return json({ archives: rows.map(archiveDTO) });
});

/** Upload an Instagram data export ZIP (raw body). Processing is asynchronous. */
export const POST = authed(
  async ({ req, auth }) => {
    const active = await db().archiveImport.count({ where: { userId: auth.user.id, status: { in: ["PENDING", "PROCESSING"] } } });
    if (active >= 2) throw new AppError("RATE_LIMITED", "Wait for your current imports to finish.");
    const name = decodeURIComponent(req.headers.get("x-filename") ?? "instagram-export.zip").slice(0, 200);
    const { path, bytes } = await receiveBody(req, getConfig().limits.maxArchiveUploadBytes, "archive", ".zip");
    // Quick signature check before queuing: ZIP local header "PK\x03\x04".
    const fh = await openFile(path, "r");
    const sig = Buffer.alloc(4);
    await fh.read(sig, 0, 4, 0);
    await fh.close();
    if (sig.toString("binary") !== "PK\x03\x04") {
      await rm(path, { force: true });
      throw new AppError("INVALID_ARCHIVE", "That file isn't a ZIP archive.");
    }
    const archive = await db().archiveImport.create({
      data: { userId: auth.user.id, originalName: name, sizeBytes: BigInt(bytes) },
    });
    enqueueArchive(archive.id, path);
    return json({ archive: archiveDTO(archive) }, { status: 202 });
  },
  { limit: limiters.upload },
);
