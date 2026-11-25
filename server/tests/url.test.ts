import { describe, expect, it } from "vitest";
import { parseInstagramUrl, shortcodeFromPermalink } from "@/lib/instagram/url";
import { AppError } from "@/lib/http/errors";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return "OK";
};

describe("parseInstagramUrl", () => {
  it.each([
    ["https://www.instagram.com/p/CxYz123AbC/", "post", "CxYz123AbC"],
    ["https://instagram.com/p/CxYz123AbC", "post", "CxYz123AbC"],
    ["http://instagram.com/p/CxYz123AbC/?igsh=abc&utm_source=x", "post", "CxYz123AbC"],
    ["instagram.com/reel/C9_-abcDEF1/", "reel", "C9_-abcDEF1"],
    ["https://www.instagram.com/reels/C9abcDEF12/", "reel", "C9abcDEF12"],
    ["https://m.instagram.com/tv/B1234567890/", "tv", "B1234567890"],
    ["https://www.instagram.com/some.user/p/CxYz123AbC/", "post", "CxYz123AbC"],
    ["https://www.instagram.com/some_user/reel/C9abcDEF12/", "reel", "C9abcDEF12"],
    ["  https://www.instagram.com/p/CxYz123AbC/#comments  ", "post", "CxYz123AbC"],
  ])("accepts %s", (input, kind, shortcode) => {
    const p = parseInstagramUrl(input);
    expect(p.kind).toBe(kind);
    expect("shortcode" in p && p.shortcode).toBe(shortcode);
    expect(p.canonicalUrl).toMatch(/^https:\/\/www\.instagram\.com\//);
  });

  it("canonicalizes reels/ and strips tracking params", () => {
    expect(parseInstagramUrl("https://instagram.com/reels/C9abcDEF12/?utm=1").canonicalUrl).toBe("https://www.instagram.com/reel/C9abcDEF12/");
  });

  it("recognizes story and profile links", () => {
    expect(parseInstagramUrl("https://www.instagram.com/stories/someone/3312345678901234567/")).toMatchObject({ kind: "story", username: "someone", storyId: "3312345678901234567" });
    expect(parseInstagramUrl("https://www.instagram.com/someone/")).toMatchObject({ kind: "profile", username: "someone" });
  });

  it.each([
    "",
    "not a url",
    "https://evil.com/p/CxYz123AbC/",
    "https://instagram.com.evil.com/p/CxYz123AbC/",
    "https://evilinstagram.com/p/CxYz123AbC/",
    "ftp://instagram.com/p/CxYz123AbC/",
    "javascript:alert(1)//instagram.com/p/CxYz123AbC",
    "file:///etc/passwd",
    "https://user:pass@instagram.com/p/CxYz123AbC/",
    "https://instagram.com:8080/p/CxYz123AbC/",
    "https://instagram.com/p/",
    "https://instagram.com/p/ab/",
    "https://instagram.com/p/abc%2F..%2Fdef/",
    "https://instagram.com/p/<script>/",
    "https://instagram.com/explore/",
    "https://instagram.com/share/abc123",
    "https://127.0.0.1/p/CxYz123AbC/",
    `https://instagram.com/p/${"a".repeat(3000)}`,
  ])("rejects %s", (input) => {
    expect(code(() => parseInstagramUrl(input))).toBe("UNSUPPORTED_URL");
  });

  it("extracts shortcodes from Graph API permalinks", () => {
    expect(shortcodeFromPermalink("https://www.instagram.com/reel/C9abcDEF12/")).toBe("C9abcDEF12");
    expect(shortcodeFromPermalink("https://www.instagram.com/someone/")).toBeNull();
    expect(shortcodeFromPermalink(undefined)).toBeNull();
  });
});
