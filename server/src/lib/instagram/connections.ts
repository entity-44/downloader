import type { InstagramConnection } from "@/generated/prisma/client";
import { getConfig, instagramConfigured } from "../config";
import { db } from "../db";
import { AppError } from "../http/errors";
import { log } from "../log";
import { decrypt, encrypt, randomToken } from "../security/crypto";
import { InstagramGraph, type GraphMedia } from "./graph";
import { shortcodeFromPermalink } from "./url";

const STATE_TTL_MS = 10 * 60_000;
const REFRESH_WHEN_EXPIRING_WITHIN_MS = 10 * 24 * 3600_000;
const MIN_TOKEN_AGE_FOR_REFRESH_MS = 24 * 3600_000;
export const OAUTH_SCOPES = ["instagram_business_basic"];

/** Builds the Instagram authorization URL and stores a single-use state. */
export async function startOAuth(userId: string): Promise<string> {
  const cfg = getConfig();
  if (!instagramConfigured(cfg)) throw new AppError("INSTAGRAM_NOT_CONFIGURED");
  const state = randomToken(24);
  await db().oAuthState.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lt: new Date() } }] } });
  await db().oAuthState.create({ data: { state, userId, expiresAt: new Date(Date.now() + STATE_TTL_MS) } });
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", cfg.instagram.appId!);
  url.searchParams.set("redirect_uri", cfg.instagram.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

/** Validates state, exchanges the code and stores an encrypted long-lived token. */
export async function completeOAuth(userId: string, code: string, state: string, graph = new InstagramGraph()) {
  if (!instagramConfigured()) throw new AppError("INSTAGRAM_NOT_CONFIGURED");
  if (!state || state.length > 100) throw new AppError("CSRF");
  const row = await db().oAuthState.findUnique({ where: { state } });
  if (row) await db().oAuthState.delete({ where: { state } }).catch(() => {});
  if (!row || row.userId !== userId || row.expiresAt.getTime() < Date.now()) throw new AppError("CSRF");

  const cleanCode = code.replace(/#_$/, "");
  if (!cleanCode || cleanCode.length > 2048) throw new AppError("VALIDATION");
  const short = await graph.exchangeCode(cleanCode);
  const long = await graph.exchangeLongLived(short.access_token);
  const me = await graph.me(long.access_token);
  const igUserId = String(me.user_id ?? me.id ?? short.user_id);
  const permissions = Array.isArray(short.permissions) ? short.permissions.join(",") : (short.permissions ?? OAUTH_SCOPES.join(","));
  const data = {
    username: me.username,
    accountType: me.account_type ?? null,
    accessTokenEnc: encrypt(long.access_token),
    tokenExpiresAt: new Date(Date.now() + long.expires_in * 1000),
    tokenRefreshedAt: new Date(),
    scopes: permissions,
  };
  return db().instagramConnection.upsert({
    where: { userId_igUserId: { userId, igUserId } },
    create: { userId, igUserId, ...data },
    update: data,
  });
}

/** Returns a usable access token, refreshing it when close to expiry. */
export async function getAccessToken(conn: InstagramConnection, graph = new InstagramGraph()): Promise<string> {
  const token = decrypt(conn.accessTokenEnc);
  const now = Date.now();
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() <= now) throw new AppError("TOKEN_EXPIRED");
  const expiringSoon = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - now < REFRESH_WHEN_EXPIRING_WITHIN_MS;
  const oldEnough = now - conn.tokenRefreshedAt.getTime() > MIN_TOKEN_AGE_FOR_REFRESH_MS;
  if (expiringSoon && oldEnough) {
    try {
      const r = await graph.refreshLongLived(token);
      await db().instagramConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encrypt(r.access_token),
          tokenExpiresAt: new Date(now + r.expires_in * 1000),
          tokenRefreshedAt: new Date(),
        },
      });
      return r.access_token;
    } catch (e) {
      log.warn("Token refresh failed; using existing token", { connectionId: conn.id, error: e });
    }
  }
  return token;
}

// ---- Shortcode → media id index (per connection, cached briefly) ----

type Index = { at: number; map: Map<string, string>; complete: boolean };
const g = globalThis as unknown as { __igIndex?: Map<string, Index> };
const INDEX_TTL_MS = 10 * 60_000;
const MAX_PAGES = 30; // up to 3,000 most recent posts

export function clearMediaIndex(connectionId?: string) {
  if (connectionId) g.__igIndex?.delete(connectionId);
  else g.__igIndex?.clear();
}

/** Finds a connected account's media by shortcode by paging its media list. */
export async function findOwnedMediaId(
  conn: InstagramConnection,
  token: string,
  shortcode: string,
  graph = new InstagramGraph(),
): Promise<string | null> {
  g.__igIndex ??= new Map();
  let idx = g.__igIndex.get(conn.id);
  if (idx && Date.now() - idx.at < INDEX_TTL_MS && (idx.map.has(shortcode) || idx.complete)) {
    return idx.map.get(shortcode) ?? null;
  }
  idx = { at: Date.now(), map: new Map(), complete: false };
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await graph.listMedia(token, after, 100);
    for (const m of res.data) {
      const sc = mediaShortcode(m);
      if (sc) idx.map.set(sc, m.id);
    }
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
    if (idx.map.has(shortcode)) break;
    if (!after) {
      idx.complete = true;
      break;
    }
  }
  g.__igIndex.set(conn.id, idx);
  return idx.map.get(shortcode) ?? null;
}

export function mediaShortcode(m: GraphMedia): string | null {
  return m.shortcode ?? shortcodeFromPermalink(m.permalink);
}
