import { mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/security/crypto";
import { isPrivateAddress } from "@/lib/security/net";
import { assertSafeMediaUrl, isAllowedMediaHost, resolvePublicAddress, safeDownload } from "@/lib/security/safe-fetch";
import { contentDisposition, sanitizeFilenamePart, uniqueNamer } from "@/lib/media/filenames";
import { parseRange } from "@/lib/http/files";
import { log } from "@/lib/log";
import { isSameOrigin, clientIp } from "@/lib/security/request";
import { resolveStoragePath } from "@/lib/storage/paths";

const errCode = async (p: Promise<unknown>) => p.then(() => "OK", (e) => e.code ?? e.message);

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"])(
    "treats %s as private",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["157.240.1.174", "31.13.66.1", "2a03:2880:f12f:83:face:b00c:0:25de", "8.8.8.8"])("treats %s as public", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );

  it("only allows Instagram CDN hosts over https", () => {
    expect(isAllowedMediaHost("scontent-lax3-1.cdninstagram.com")).toBe(true);
    expect(isAllowedMediaHost("video.xx.fbcdn.net")).toBe(true);
    expect(isAllowedMediaHost("cdninstagram.com")).toBe(false);
    expect(isAllowedMediaHost("evilcdninstagram.com")).toBe(false);
    expect(isAllowedMediaHost("cdninstagram.com.evil.net")).toBe(false);
    for (const bad of [
      "http://scontent.cdninstagram.com/a.jpg",
      "https://localhost/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://user:pw@scontent.cdninstagram.com/a.jpg",
      "https://scontent.cdninstagram.com:8443/a.jpg",
      "file:///etc/passwd",
      "gopher://scontent.cdninstagram.com/",
    ]) {
      expect(() => assertSafeMediaUrl(bad)).toThrow();
    }
    expect(assertSafeMediaUrl("https://scontent.cdninstagram.com/v/a.jpg?x=1").hostname).toBe("scontent.cdninstagram.com");
  });

  it("rejects hosts that resolve to private addresses (DNS rebinding)", async () => {
    const rebinding = async () => [{ address: "157.240.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }];
    expect(await errCode(resolvePublicAddress("x.cdninstagram.com", rebinding))).toBe("MEDIA_UNAVAILABLE");
    const ok = async () => [{ address: "157.240.1.1", family: 4 }];
    expect((await resolvePublicAddress("x.cdninstagram.com", ok)).address).toBe("157.240.1.1");
  });

  it("safeDownload refuses unsafe targets before connecting", async () => {
    const dest = path.join(mkdtempSync(path.join(os.tmpdir(), "ssrf-")), "out");
    const internal = async () => [{ address: "10.0.0.5", family: 4 }];
    expect(await errCode(safeDownload("https://a.cdninstagram.com/x.jpg", dest, { maxBytes: 1000, resolver: internal }))).toBe("MEDIA_UNAVAILABLE");
    expect(await errCode(safeDownload("https://example.com/x.jpg", dest, { maxBytes: 1000 }))).toBe("MEDIA_UNAVAILABLE");
    expect(await errCode(safeDownload("http://a.cdninstagram.com/x.jpg", dest, { maxBytes: 1000 }))).toBe("MEDIA_UNAVAILABLE");
    expect(existsSync(dest)).toBe(false);
  });
});

describe("token encryption", () => {
  it("round-trips and uses a random IV", () => {
    const a = encrypt("IGQVJ-secret-token");
    const b = encrypt("IGQVJ-secret-token");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret");
    expect(decrypt(a)).toBe("IGQVJ-secret-token");
  });
  it("detects tampering", () => {
    const parts = encrypt("token").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});

describe("filenames & headers", () => {
  it("sanitizes path and control characters", () => {
    expect(sanitizeFilenamePart("../../etc/passwd")).toBe("etc_passwd");
    expect(sanitizeFilenamePart("a\u0000b\nc")).toBe("abc");
    expect(sanitizeFilenamePart('x<>:"|?*y')).toBe("x_y");
    expect(sanitizeFilenamePart("...")).toBe("file");
  });
  it("builds safe Content-Disposition headers", () => {
    const h = contentDisposition('evil"\r\nSet-Cookie: x=1.jpg');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(contentDisposition("café.jpg", true)).toContain("inline");
  });
  it("dedupes zip entry names", () => {
    const n = uniqueNamer();
    expect([n("a.jpg"), n("a.jpg"), n("A.jpg")]).toEqual(["a.jpg", "a_1.jpg", "A_2.jpg"]);
  });
  it("parses Range headers", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=5-1", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
  });
});

describe("storage paths", () => {
  it("never resolves outside the storage root", () => {
    expect(() => resolveStoragePath("../../etc/passwd")).toThrow();
    expect(() => resolveStoragePath("/etc/passwd")).toThrow();
    expect(resolveStoragePath("users/abc/file.jpg")).toContain(path.join("storage", "users", "abc"));
  });
});

describe("logging", () => {
  it("redacts secrets", () => {
    const out = JSON.stringify(log.redact({ password: "hunter2", accessToken: "abc", url: "https://x/?access_token=SECRET&a=1", nested: { client_secret: "s" } }));
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain('"s"');
  });
});

describe("request helpers", () => {
  it("checks same-origin", () => {
    const mk = (h: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers: h });
    expect(isSameOrigin(mk({ origin: "http://localhost:3000" }))).toBe(true);
    expect(isSameOrigin(mk({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(mk({ origin: "http://localhost:3000", "sec-fetch-site": "cross-site" }))).toBe(false);
  });
  it("uses the proxy-appended client IP when proxy is untrusted", () => {
    const r = new Request("http://localhost/", { headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" } });
    expect(clientIp(r)).toBe("1.2.3.4");
  });
});
