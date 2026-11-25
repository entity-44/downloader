import { db } from "@/lib/db";
import { deleteDownload } from "@/lib/downloads/service";
import { AppError } from "@/lib/http/errors";
import { authed, json } from "@/lib/http/handler";
import { downloadDTO } from "@/lib/serialize";

export const GET = authed<{ id: string }>(async ({ auth, params }) => {
  const dl = await db().download.findFirst({ where: { id: params.id, userId: auth.user.id }, include: { files: true } });
  if (!dl) throw new AppError("NOT_FOUND");
  return json({ download: downloadDTO(dl) });
});

export const DELETE = authed<{ id: string }>(async ({ auth, params }) => {
  await deleteDownload(auth.user.id, params.id);
  return json({ ok: true });
});
