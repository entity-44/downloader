import { getConfig } from "../config";

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

/**
 * Client IP for rate limiting. With TRUST_PROXY, the left-most X-Forwarded-For
 * entry (set by your reverse proxy) is used; otherwise the right-most entry,
 * which is appended by the Next.js server itself and cannot be spoofed.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return getConfig().trustProxy ? parts[0] : parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Same-origin check for state-changing requests. Browsers always send Origin
 * on cross-origin POST/PUT/DELETE, so a mismatch (or a cross-site
 * Sec-Fetch-Site) is rejected.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; CSRF token is still required
  const allowed = new Set([getConfig().appOrigin]);
  const host = req.headers.get("host");
  if (host) {
    const proto = getConfig().trustProxy ? (req.headers.get("x-forwarded-proto") ?? "http") : new URL(req.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  return allowed.has(origin);
}
