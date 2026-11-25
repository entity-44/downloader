import { db } from "@/lib/db";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { credentialsSchema } from "@/lib/auth/validation";
import { AppError } from "@/lib/http/errors";
import { errorResponse, json, open, readJson } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";

export const POST = open(async ({ req, ip }) => {
  const ipHit = limiters.loginIp().hit(`ip:${ip}`);
  if (!ipHit.allowed) return errorResponse("RATE_LIMITED", undefined, { "retry-after": String(ipHit.retryAfterSec) });
  const parsed = credentialsSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("INVALID_CREDENTIALS");
  const { username, password } = parsed.data;
  const userHit = limiters.loginUser().hit(`user:${username}`);
  if (!userHit.allowed) return errorResponse("RATE_LIMITED", undefined, { "retry-after": String(userHit.retryAfterSec) });

  const user = await db().user.findUnique({ where: { username } });
  // Always run a hash comparison so response time doesn't reveal valid usernames.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) throw new AppError("INVALID_CREDENTIALS");

  limiters.loginUser().reset(`user:${username}`);
  const { token } = await createSession(user.id, req.headers.get("user-agent"));
  return json(
    { user: { id: user.id, username: user.username, isAdmin: user.isAdmin } },
    { headers: { "set-cookie": sessionCookie(token) } },
  );
});
