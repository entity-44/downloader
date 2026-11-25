import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { authed, json } from "@/lib/http/handler";
import { clearMediaIndex } from "@/lib/instagram/connections";

/** Disconnects an account and deletes its stored (encrypted) token. */
export const DELETE = authed<{ id: string }>(async ({ auth, params }) => {
  const { count } = await db().instagramConnection.deleteMany({ where: { id: params.id, userId: auth.user.id } });
  if (!count) throw new AppError("NOT_FOUND");
  clearMediaIndex(params.id);
  return json({ ok: true });
});
