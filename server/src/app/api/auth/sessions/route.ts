import { db } from "@/lib/db";
import { authed, json } from "@/lib/http/handler";

export const GET = authed(async ({ auth }) => {
  const sessions = await db().session.findMany({
    where: { userId: auth.user.id, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });
  return json({
    sessions: sessions.map((s) => ({
      id: s.id,
      current: s.id === auth.sessionId,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    })),
  });
});

/** Signs out all other sessions. */
export const DELETE = authed(async ({ auth }) => {
  const { count } = await db().session.deleteMany({ where: { userId: auth.user.id, NOT: { id: auth.sessionId } } });
  return json({ revoked: count });
});
