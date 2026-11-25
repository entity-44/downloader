import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { passwordSchema } from "@/lib/auth/validation";
import { AppError } from "@/lib/http/errors";
import { authed, json, readJson } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";

const schema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema });

export const POST = authed(
  async ({ req, auth }) => {
    const { currentPassword, newPassword } = schema.parse(await readJson(req));
    const user = await db().user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new AppError("INVALID_CREDENTIALS", "Current password is incorrect.");
    await db().user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    // Sign out every other session after a password change.
    const { count } = await db().session.deleteMany({ where: { userId: user.id, NOT: { id: auth.sessionId } } });
    return json({ ok: true, revokedSessions: count });
  },
  { limit: limiters.loginUser },
);
