import { rm } from "node:fs/promises";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { clearSessionCookie } from "@/lib/auth/session";
import { AppError } from "@/lib/http/errors";
import { authed, json, readJson } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";
import { userDir } from "@/lib/storage/paths";

/** Permanently deletes the account, its connections and all stored media. */
export const DELETE = authed(
  async ({ req, auth }) => {
    const { password } = z.object({ password: z.string().min(1).max(256) }).parse(await readJson(req));
    const user = await db().user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(password, user.passwordHash))) throw new AppError("INVALID_CREDENTIALS", "Password is incorrect.");
    await rm(userDir(user.id), { recursive: true, force: true });
    await db().user.delete({ where: { id: user.id } });
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
  },
  { limit: limiters.loginUser },
);
