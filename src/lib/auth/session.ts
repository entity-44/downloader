import { getConfig } from "../config";
import { db } from "../db";
import { randomToken, sha256 } from "../security/crypto";

export const SESSION_TTL_MS = 14 * 24 * 3600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export function sessionCookieName() {
  return getConfig().cookieSecure ? "__Host-ig_session" : "ig_session";
}

export type SessionUser = { id: string; username: string; isAdmin: boolean };
export type AuthContext = { user: SessionUser; sessionId: string; csrfToken: string };

export async function createSession(userId: string, userAgent?: string | null) {
  const token = randomToken(32);
  const session = await db().session.create({
    data: {
      tokenHash: sha256(token),
      csrfToken: randomToken(32),
      userId,
      userAgent: userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token, session };
}

export async function validateSessionToken(token: string | undefined | null): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const session = await db().session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, username: true, isAdmin: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db().session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db().session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return { user: session.user, sessionId: session.id, csrfToken: session.csrfToken };
}

export async function deleteSession(sessionId: string) {
  await db().session.deleteMany({ where: { id: sessionId } });
}

export function sessionCookie(token: string, maxAgeSec = SESSION_TTL_MS / 1000) {
  const parts = [
    `${sessionCookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeSec)}`,
  ];
  if (getConfig().cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}
