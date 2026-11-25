import { describe, expect, it } from "vitest";
import { completeOAuth, getAccessToken, startOAuth } from "@/lib/instagram/connections";
import type { InstagramGraph } from "@/lib/instagram/graph";
import { InstagramGraph as RealGraph, mapGraphError } from "@/lib/instagram/graph";
import { GET as callback } from "@/app/api/instagram/callback/route";
import { POST as connectRoute } from "@/app/api/instagram/connect/route";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/security/crypto";
import { makeUser, req } from "./helpers";

const graph = {
  async exchangeCode(code: string) {
    expect(code).toBe("the-code");
    return { access_token: "short", user_id: "17841400000000001", permissions: ["instagram_business_basic"] };
  },
  async exchangeLongLived(t: string) {
    expect(t).toBe("short");
    return { access_token: "long-lived-token", expires_in: 5184000 };
  },
  async me() {
    return { id: "17841400000000001", user_id: "17841400000000001", username: "creator", account_type: "MEDIA_CREATOR" };
  },
} as unknown as InstagramGraph;

const stateOf = (url: string) => new URL(url).searchParams.get("state")!;

describe("Instagram OAuth", () => {
  it("builds an authorization URL with a single-use state", async () => {
    const u = await makeUser();
    const url = new URL(await startOAuth(u.user.id));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("123456");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/instagram/callback");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic");
    expect(url.searchParams.get("state")!.length).toBeGreaterThan(20);
    expect(url.toString()).not.toContain("test-secret");
  });

  it("connect route requires CSRF", async () => {
    const u = await makeUser();
    expect((await connectRoute(req("POST", "/api/instagram/connect", { cookie: u.cookie }))).status).toBe(403);
    const ok = await connectRoute(req("POST", "/api/instagram/connect", { cookie: u.cookie, csrf: u.csrf }));
    expect((await ok.json()).url).toContain("instagram.com/oauth/authorize");
  });

  it("stores an encrypted long-lived token", async () => {
    const u = await makeUser();
    const state = stateOf(await startOAuth(u.user.id));
    const conn = await completeOAuth(u.user.id, "the-code#_", state, graph);
    expect(conn.username).toBe("creator");
    expect(conn.accessTokenEnc).not.toContain("long-lived-token");
    expect(decrypt(conn.accessTokenEnc)).toBe("long-lived-token");
    expect(conn.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86400_000);
    // State is single use.
    await expect(completeOAuth(u.user.id, "the-code", state, graph)).rejects.toMatchObject({ code: "CSRF" });
  });

  it("rejects forged, foreign and expired states", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await expect(completeOAuth(a.user.id, "the-code", "forged", graph)).rejects.toMatchObject({ code: "CSRF" });
    const bState = stateOf(await startOAuth(b.user.id));
    await expect(completeOAuth(a.user.id, "the-code", bState, graph)).rejects.toMatchObject({ code: "CSRF" });
    const aState = stateOf(await startOAuth(a.user.id));
    await db().oAuthState.update({ where: { state: aState }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(completeOAuth(a.user.id, "the-code", aState, graph)).rejects.toMatchObject({ code: "CSRF" });
  });

  it("callback requires a signed-in user and redirects with a result", async () => {
    const anon = await callback(req("GET", "/api/instagram/callback?code=x&state=y"));
    expect(anon.headers.get("location")).toBe("http://localhost:3000/login");
    const u = await makeUser();
    const denied = await callback(req("GET", "/api/instagram/callback?error=access_denied&error_reason=user_denied", { cookie: u.cookie }));
    expect(denied.headers.get("location")).toBe("http://localhost:3000/accounts?error=denied");
    const bad = await callback(req("GET", "/api/instagram/callback?code=x&state=forged", { cookie: u.cookie }));
    expect(bad.headers.get("location")).toBe("http://localhost:3000/accounts?error=CSRF");
  });

  it("refreshes tokens close to expiry and rejects expired ones", async () => {
    const u = await makeUser();
    const conn = await db().instagramConnection.create({
      data: { userId: u.user.id, igUserId: "x", username: "x", accessTokenEnc: encrypt("old"), tokenExpiresAt: new Date(Date.now() + 2 * 86400_000), tokenRefreshedAt: new Date(Date.now() - 50 * 86400_000) },
    });
    const refresher = { refreshLongLived: async (t: string) => (expect(t).toBe("old"), { access_token: "new", expires_in: 5184000 }) } as unknown as InstagramGraph;
    expect(await getAccessToken(conn, refresher)).toBe("new");
    const stored = await db().instagramConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(decrypt(stored.accessTokenEnc)).toBe("new");

    const expired = await db().instagramConnection.update({ where: { id: conn.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    await expect(getAccessToken(expired, refresher)).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("maps Graph API errors without leaking details", () => {
    expect(mapGraphError(400, { error: { code: 190, type: "OAuthException" } }).code).toBe("TOKEN_EXPIRED");
    expect(mapGraphError(400, { error: { code: 4 } }).code).toBe("RATE_LIMITED");
    expect(mapGraphError(400, { error: { code: 10 } }).code).toBe("PRIVATE_MEDIA_REQUIRES_AUTHORIZATION");
    expect(mapGraphError(400, { error: { code: 100 } }).code).toBe("MEDIA_UNAVAILABLE");
    expect(mapGraphError(500, "<html>").code).toBe("UPSTREAM_ERROR");
  });

  it("sends requests only to official Instagram endpoints", async () => {
    const seen: string[] = [];
    const fake = (async (u: URL | string) => {
      seen.push(String(u));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;
    await new RealGraph(fake).listMedia("tok");
    expect(new URL(seen[0]).origin).toBe("https://graph.instagram.com");
    expect(seen[0]).toMatch(/\/v\d+\.\d+\/me\/media\?/);
  });
});
