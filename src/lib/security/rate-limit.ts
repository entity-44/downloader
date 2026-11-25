/**
 * In-memory fixed-window rate limiter. Suitable for a single-instance
 * self-hosted deployment; swap for Redis if you run multiple replicas.
 */
type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Records a hit. Returns whether it is allowed and seconds until reset. */
  hit(key: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
    const t = this.now();
    this.sweep(t);
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    const allowed = b.count <= this.limit;
    return { allowed, remaining: Math.max(0, this.limit - b.count), retryAfterSec: Math.ceil((b.resetAt - t) / 1000) };
  }

  reset(key: string) {
    this.buckets.delete(key);
  }

  clear() {
    this.buckets.clear();
  }

  private sweep(t: number) {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
  }
}

const g = globalThis as unknown as { __limiters?: Record<string, RateLimiter> };

function limiter(name: string, limit: number, windowMs: number) {
  g.__limiters ??= {};
  g.__limiters[name] ??= new RateLimiter(limit, windowMs);
  return g.__limiters[name];
}

export const limiters = {
  /** Failed + successful login attempts per IP. */
  loginIp: () => limiter("loginIp", 30, 15 * 60_000),
  /** Login attempts per username (slows credential stuffing against one account). */
  loginUser: () => limiter("loginUser", 10, 15 * 60_000),
  register: () => limiter("register", 5, 60 * 60_000),
  /** General authenticated API mutations per user. */
  api: () => limiter("api", 120, 60_000),
  /** URL download requests per user. */
  download: () => limiter("download", 20, 60_000),
  upload: () => limiter("upload", 30, 60 * 60_000),
  /** Media/file reads per user (gallery previews are numerous). */
  files: () => limiter("files", 2000, 60_000),
};

export function resetAllLimiters() {
  for (const l of Object.values(g.__limiters ?? {})) l.clear();
}
