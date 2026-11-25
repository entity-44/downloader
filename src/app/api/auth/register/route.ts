import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { registerSchema } from "@/lib/auth/validation";
import { AppError } from "@/lib/http/errors";
import { errorResponse, json, open, readJson } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";

export const POST = open(async ({ req, ip }) => {
  const rl = limiters.register().hit(`ip:${ip}`);
  if (!rl.allowed) return errorResponse("RATE_LIMITED", undefined, { "retry-after": String(rl.retryAfterSec) });
  const { username, password } = registerSchema.parse(await readJson(req));
  const userCount = await db().user.count();
  if (userCount > 0 && !getConfig().allowRegistration) throw new AppError("REGISTRATION_CLOSED");
  if (await db().user.findUnique({ where: { username } })) throw new AppError("CONFLICT", "That username is taken.");
  const user = await db().user.create({
    data: { username, passwordHash: await hashPassword(password), isAdmin: userCount === 0, settings: { create: {} } },
  });
  const { token } = await createSession(user.id, req.headers.get("user-agent"));
  return json(
    { user: { id: user.id, username: user.username, isAdmin: user.isAdmin } },
    { status: 201, headers: { "set-cookie": sessionCookie(token) } },
  );
});

/** Lets the login page know whether to offer sign-up. */
export const GET = open(async () => {
  const count = await db().user.count();
  return json({ open: count === 0 || getConfig().allowRegistration, firstUser: count === 0 });
});
