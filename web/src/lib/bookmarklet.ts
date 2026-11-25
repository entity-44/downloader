/**
 * Source of the one-click bookmarklet. It runs on the Instagram/Reddit post
 * you're viewing, reads that post's data using the page's own (same-origin)
 * access, opens this app, and hands the data over via postMessage.
 *
 * It sends raw data only: parsing lives in the app so format changes can be
 * fixed by updating the site, without reinstalling the bookmark.
 */
export function bookmarkletSource(appUrl: string): string {
  const app = new URL(appUrl);
  const APP = JSON.stringify(app.origin + app.pathname);
  const ORIGIN = JSON.stringify(app.origin);
  const code = `
(async () => {
  const APP = ${APP}, ORIGIN = ${ORIGIN};
  const toast = (m) => { let d = document.getElementById("__keepsake_toast"); if (!d) { d = document.createElement("div"); d.id = "__keepsake_toast"; d.style.cssText = "position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);background:#111;color:#fff;font:14px system-ui,sans-serif;padding:10px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);max-width:90vw"; document.body.appendChild(d); } d.textContent = m; clearTimeout(d._t); d._t = setTimeout(() => d.remove(), 6000); };
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const sc2id = (s) => { let n = 0n; for (const c of s.slice(0, 11)) n = n * 64n + BigInt(A.indexOf(c)); return n.toString(); };
  try {
    const h = location.hostname, p = location.pathname;
    let msg;
    if (/(^|\\.)instagram\\.com$/.test(h)) {
      const m = p.match(/\\/(?:[\\w.]+\\/)?(?:p|reel|reels|tv)\\/([\\w-]+)/), st = p.match(/\\/stories\\/[\\w.]+\\/(\\d+)/);
      if (!m && !st) throw new Error("Open a post, reel or story first (the address should contain /p/, /reel/ or /stories/).");
      const id = st ? st[1] : sc2id(m[1]);
      toast("Reading post…");
      let raw = null;
      try { const r = await fetch("/api/v1/media/" + id + "/info/", { headers: { "x-ig-app-id": "936619743392459" }, credentials: "include" }); if (r.ok) raw = await r.json(); } catch (e) {}
      msg = { type: "keepsake:post", platform: "instagram", url: location.href, shortcode: m ? m[1] : undefined, raw: raw, html: raw ? undefined : document.documentElement.outerHTML };
    } else if (/(^|\\.)reddit\\.com$/.test(h)) {
      const m = p.match(/\\/comments\\/([a-z0-9]+)/i);
      if (!m) throw new Error("Open a Reddit post first.");
      toast("Reading post…");
      const r = await fetch("/comments/" + m[1] + ".json?raw_json=1&limit=1", { credentials: "include" });
      if (!r.ok) throw new Error("Reddit returned " + r.status + ".");
      msg = { type: "keepsake:post", platform: "reddit", url: location.href, raw: await r.json() };
    } else {
      throw new Error("Use this button on an Instagram or Reddit post.");
    }
    const w = window.open(APP + "#/receive", "_blank");
    if (!w) throw new Error("Pop-up blocked. Allow pop-ups for this site and try again.");
    toast("Sent to Keepsake");
    window.addEventListener("message", async (e) => {
      if (e.source !== w || e.origin !== ORIGIN || !e.data || typeof e.data.type !== "string") return;
      if (e.data.type === "keepsake:ready") w.postMessage(msg, ORIGIN);
      if (e.data.type === "keepsake:fetch") {
        try {
          const u = new URL(e.data.url);
          if (!/(^|\\.)(cdninstagram\\.com|fbcdn\\.net|redd\\.it)$/.test(u.hostname) || u.protocol !== "https:") throw new Error("Blocked host");
          const r = await fetch(u, { credentials: "omit" });
          if (!r.ok) throw new Error("HTTP " + r.status);
          const b = await r.arrayBuffer();
          w.postMessage({ type: "keepsake:file", reqId: e.data.reqId, buffer: b, mime: r.headers.get("content-type") || "" }, ORIGIN, [b]);
        } catch (err) {
          w.postMessage({ type: "keepsake:file-error", reqId: e.data.reqId, error: String(err && err.message || err) }, ORIGIN);
        }
      }
    });
  } catch (err) {
    toast("Keepsake: " + (err && err.message || err));
  }
})();`;
  return code
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

export function bookmarkletHref(appUrl: string) {
  return `javascript:${encodeURIComponent(bookmarkletSource(appUrl))}`;
}
