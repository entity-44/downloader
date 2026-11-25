import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/lib/security/rate-limit";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as download } from "@/app/api/downloads/route";
import { makeUser, req } from "./helpers";

describe("RateLimiter", () => {
  it("allows up to the limit then blocks until the window resets", () => {
    let t = 0;
    const rl = new RateLimiter(3, 1000, () => t);
    expect([1, 2, 3].map(() => rl.hit("k").allowed)).toEqual([true, true, true]);
    const blocked = rl.hit("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    expect(rl.hit("other").allowed).toBe(true);
    t = 1001;
    expect(rl.hit("k").allowed).toBe(true);
  });
});

describe("route rate limiting", () => {
  it("locks out repeated failed logins for a username", async () => {
    const { user } = await makeUser("victim");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await login(req("POST", "/api/auth/login", { body: { username: user.username, password: "wrong-password" }, headers: { "x-forwarded-for": `9.9.9.${i}` } }));
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    const last = await login(req("POST", "/api/auth/login", { body: { username: user.username, password: "wrong-password" } }));
    expect(last.headers.get("retry-after")).toBeTruthy();
  });

  it("limits download requests per user", async () => {
    const u = await makeUser();
    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const r = await download(req("POST", "/api/downloads", { cookie: u.cookie, csrf: u.csrf, body: { url: "https://example.com/bad" } }));
      lastStatus = r.status;
    }
    expect(lastStatus).toBe(429);
  });
});
