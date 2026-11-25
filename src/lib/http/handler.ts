import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { sessionCookieName, validateSessionToken, type AuthContext } from "../auth/session";
import { log } from "../log";
import { safeEqual } from "../security/crypto";
import type { RateLimiter } from "../security/rate-limit";
import { limiters } from "../security/rate-limit";
import { clientIp, isSameOrigin, parseCookies } from "../security/request";
import { AppError, ERRORS, isAppError, type ErrorCode } from "./errors";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function errorResponse(code: ErrorCode, message?: string, headers?: HeadersInit) {
  return NextResponse.json(
    { error: { code, message: message ?? ERRORS[code].message } },
    { status: ERRORS[code].status, headers: { "cache-control": "no-store", ...headers } },
  );
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...init?.headers },
  });
}

function toResponse(e: unknown): Response {
  if (isAppError(e)) return errorResponse(e.code, e.message);
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return errorResponse("VALIDATION", first?.message ?? ERRORS.VALIDATION.message);
  }
  log.error("Unhandled route error", { error: e });
  return errorResponse("PROCESSING_FAILED");
}

export async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = parseCookies(req.headers.get("cookie"))[sessionCookieName()];
  return validateSessionToken(token);
}

type Ctx<P> = { req: Request; params: P; ip: string };
type AuthedCtx<P> = Ctx<P> & { auth: AuthContext };

type Options = {
  /** Rate limiter applied per user (or per IP when unauthenticated). */
  limit?: () => RateLimiter;
};

function rateLimitResponse(retryAfterSec: number) {
  return errorResponse("RATE_LIMITED", undefined, { "retry-after": String(retryAfterSec) });
}

/**
 * Wraps an authenticated route handler: verifies the session cookie, enforces
 * same-origin + CSRF token on mutating methods, applies rate limits and maps
 * errors to safe JSON responses.
 */
export function authed<P = Record<string, never>>(
  fn: (ctx: AuthedCtx<P>) => Promise<Response>,
  opts: Options = {},
) {
  return async (req: Request, segment?: { params: Promise<P> }): Promise<Response> => {
    try {
      const ip = clientIp(req);
      const auth = await authenticate(req);
      if (!auth) return errorResponse("AUTH_REQUIRED");
      if (MUTATING.has(req.method)) {
        const token = req.headers.get("x-csrf-token") ?? "";
        if (!isSameOrigin(req) || !token || !safeEqual(token, auth.csrfToken)) return errorResponse("CSRF");
        const g = limiters.api().hit(`u:${auth.user.id}`);
        if (!g.allowed) return rateLimitResponse(g.retryAfterSec);
      }
      if (opts.limit) {
        const r = opts.limit().hit(`u:${auth.user.id}`);
        if (!r.allowed) return rateLimitResponse(r.retryAfterSec);
      }
      const params = (segment ? await segment.params : {}) as P;
      return await fn({ req, params, ip, auth });
    } catch (e) {
      return toResponse(e);
    }
  };
}

/** Unauthenticated route (login/register): same-origin required for mutations. */
export function open<P = Record<string, never>>(fn: (ctx: Ctx<P>) => Promise<Response>) {
  return async (req: Request, segment?: { params: Promise<P> }): Promise<Response> => {
    try {
      if (MUTATING.has(req.method) && !isSameOrigin(req)) return errorResponse("CSRF");
      const params = (segment ? await segment.params : {}) as P;
      return await fn({ req, params, ip: clientIp(req) });
    } catch (e) {
      return toResponse(e);
    }
  };
}

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new AppError("TOO_LARGE");
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("TOO_LARGE");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION", "Malformed JSON body.");
  }
}
