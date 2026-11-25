import { describe, expect, it } from "vitest";
import { POST as register, GET as registrationStatus } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as changePassword } from "@/app/api/auth/password/route";
import { GET as listSessions, DELETE as revokeOthers } from "@/app/api/auth/sessions/route";
import { DELETE as deleteAccount } from "@/app/api/account/route";
import { PUT as putSettings, GET as getSettingsRoute } from "@/app/api/settings/route";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { validateSessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/security/crypto";
import { makeUser, req } from "./helpers";

const cookieFrom = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];

describe("password hashing", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword("a long passphrase");
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(h).not.toContain("passphrase");
    expect(await verifyPassword("a long passphrase", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("registration", () => {
  it("lets the first user register as admin, then closes", async () => {
    expect(await (await registrationStatus(req("GET", "/api/auth/register"))).json()).toEqual({ open: true, firstUser: true });
    const r = await register(req("POST", "/api/auth/register", { body: { username: "Admin", password: "a sufficiently long pw" } }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.user).toMatchObject({ username: "admin", isAdmin: true });
    expect(JSON.stringify(body)).not.toContain("password");
    const setCookie = r.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    const second = await register(req("POST", "/api/auth/register", { body: { username: "other", password: "a sufficiently long pw" } }));
    expect(second.status).toBe(403);
    expect((await second.json()).error.code).toBe("REGISTRATION_CLOSED");
  });

  it("validates input and stores only a hash", async () => {
    const weak = await register(req("POST", "/api/auth/register", { body: { username: "x", password: "short" } }));
    expect(weak.status).toBe(400);
    const u = await db().user.findUnique({ where: { username: "admin" } });
    expect(u?.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("rejects cross-origin registration", async () => {
    const r = await register(req("POST", "/api/auth/register", { body: { username: "zzz", password: "a sufficiently long pw" }, origin: "https://evil.example" }));
    expect(r.status).toBe(403);
  });
});

describe("login / session / logout", () => {
  it("signs in with correct credentials only", async () => {
    const u = await makeUser("alice", "alice password 123");
    const bad = await login(req("POST", "/api/auth/login", { body: { username: "alice", password: "nope" } }));
    expect(bad.status).toBe(401);
    const missing = await login(req("POST", "/api/auth/login", { body: { username: "nobody", password: "nope" } }));
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.message).toBe((await bad.json()).error.message); // no user enumeration

    const ok = await login(req("POST", "/api/auth/login", { body: { username: "ALICE", password: "alice password 123" } }));
    expect(ok.status).toBe(200);
    const cookie = cookieFrom(ok);
    const s = await session(req("GET", "/api/auth/session", { cookie }));
    expect(s.status).toBe(200);
    const sj = await s.json();
    expect(sj.user.username).toBe("alice");
    expect(sj.csrfToken).toBeTruthy();

    // Token is stored hashed, never in plaintext.
    const token = cookie.split("=")[1];
    expect(await db().session.findFirst({ where: { tokenHash: token } })).toBeNull();
    expect(await db().session.findFirst({ where: { tokenHash: sha256(token) } })).not.toBeNull();

    const out = await logout(req("POST", "/api/auth/logout", { cookie, csrf: sj.csrfToken }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await session(req("GET", "/api/auth/session", { cookie }))).status).toBe(401);
    void u;
  });

  it("rejects unauthenticated, forged and expired sessions", async () => {
    expect((await session(req("GET", "/api/auth/session"))).status).toBe(401);
    expect((await session(req("GET", "/api/auth/session", { cookie: "ig_session=forged" }))).status).toBe(401);
    const u = await makeUser();
    await db().session.updateMany({ where: { userId: u.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(u.token)).toBeNull();
    expect(await db().session.count({ where: { userId: u.user.id } })).toBe(0);
  });
});

describe("CSRF protection", () => {
  it("requires a valid token and same origin on mutations", async () => {
    const u = await makeUser();
    const body = { theme: "dark" };
    expect((await putSettings(req("PUT", "/api/settings", { cookie: u.cookie, body }))).status).toBe(403);
    expect((await putSettings(req("PUT", "/api/settings", { cookie: u.cookie, csrf: "wrong", body }))).status).toBe(403);
    expect((await putSettings(req("PUT", "/api/settings", { cookie: u.cookie, csrf: u.csrf, body, origin: "https://evil.example" }))).status).toBe(403);
    const other = await makeUser();
    expect((await putSettings(req("PUT", "/api/settings", { cookie: u.cookie, csrf: other.csrf, body }))).status).toBe(403);
    const ok = await putSettings(req("PUT", "/api/settings", { cookie: u.cookie, csrf: u.csrf, body }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).settings.theme).toBe("dark");
  });
});

describe("settings validation", () => {
  it("rejects out-of-range values", async () => {
    const u = await makeUser();
    const bad = await putSettings(req("PUT", "/api/settings", { cookie: u.cookie, csrf: u.csrf, body: { maxDownloadMb: 999999 } }));
    expect(bad.status).toBe(400);
    const bad2 = await putSettings(req("PUT", "/api/settings", { cookie: u.cookie, csrf: u.csrf, body: { theme: "neon" } }));
    expect(bad2.status).toBe(400);
    const g = await (await getSettingsRoute(req("GET", "/api/settings", { cookie: u.cookie }))).json();
    expect(g.settings).toMatchObject({ theme: "system", maxDownloadMb: 500, autoCleanup: true });
  });
});

describe("account security", () => {
  it("changing password revokes other sessions", async () => {
    const u = await makeUser("bob", "bob password 1234");
    const other = await login(req("POST", "/api/auth/login", { body: { username: "bob", password: "bob password 1234" } }));
    const otherCookie = cookieFrom(other);
    const list = await (await listSessions(req("GET", "/api/auth/sessions", { cookie: u.cookie }))).json();
    expect(list.sessions).toHaveLength(2);

    const wrong = await changePassword(req("POST", "/api/auth/password", { cookie: u.cookie, csrf: u.csrf, body: { currentPassword: "nope", newPassword: "new password 12345" } }));
    expect(wrong.status).toBe(401);
    const ok = await changePassword(req("POST", "/api/auth/password", { cookie: u.cookie, csrf: u.csrf, body: { currentPassword: "bob password 1234", newPassword: "new password 12345" } }));
    expect((await ok.json()).revokedSessions).toBe(1);
    expect((await session(req("GET", "/api/auth/session", { cookie: otherCookie }))).status).toBe(401);
    expect((await session(req("GET", "/api/auth/session", { cookie: u.cookie }))).status).toBe(200);
  });

  it("can sign out other sessions and delete the account", async () => {
    const u = await makeUser("carol", "carol password 1");
    await login(req("POST", "/api/auth/login", { body: { username: "carol", password: "carol password 1" } }));
    const r = await (await revokeOthers(req("DELETE", "/api/auth/sessions", { cookie: u.cookie, csrf: u.csrf }))).json();
    expect(r.revoked).toBe(1);
    const bad = await deleteAccount(req("DELETE", "/api/account", { cookie: u.cookie, csrf: u.csrf, body: { password: "wrong" } }));
    expect(bad.status).toBe(401);
    const ok = await deleteAccount(req("DELETE", "/api/account", { cookie: u.cookie, csrf: u.csrf, body: { password: "carol password 1" } }));
    expect(ok.status).toBe(200);
    expect(await db().user.findUnique({ where: { id: u.user.id } })).toBeNull();
  });
});
