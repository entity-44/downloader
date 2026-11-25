import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { authed, json } from "@/lib/http/handler";

export const DELETE = authed<{ id: string }>(async ({ auth, params }) => {
  const { count } = await db().session.deleteMany({ where: { id: params.id, userId: auth.user.id } });
  if (!count) throw new AppError("NOT_FOUND");
  return json({ ok: true });
});
