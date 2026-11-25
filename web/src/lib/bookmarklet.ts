/**
 * Code that runs on the Instagram/Reddit post you are viewing, in your own
 * signed-in browser. It reads only that post (preferring data already on the
 * page; otherwise one request with Instagram's own web headers) and stops on
 * Instagram's spam flag. It sends raw data only: parsing lives in the app, so
 * format changes are fixed by updating the site.
 *
 * Two delivery wrappers share the same collector:
 *  - bookmarklet: opens the app and hands the data over via postMessage
 *  - iOS Shortcut ("Run JavaScript on Web Page"): returns the data, which the
 *    Shortcut copies to the clipboard before opening the app
 */
const TOAST = "const toast = (m) => { let d = document.getElementById(\"__keepsake_toast\"); if (!d) { d = document.createElement(\"div\"); d.id = \"__keepsake_toast\"; d.style.cssText = \"position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);background:#111;color:#fff;font:14px system-ui,sans-serif;padding:10px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);max-width:90vw\"; document.body.appendChild(d); } d.textContent = m; clearTimeout(d._t); d._t = setTimeout(() => d.remove(), 6000); };";

const COLLECT = `
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const sc2id = (s) => { let n = 0n; for (const c of s.slice(0, 11)) n = n * 64n + BigInt(A.indexOf(c)); return n.toString(); };
  const collect = async () => {
    const h = location.hostname, p = location.pathname;
    let msg;
    if (/(^|\\.)instagram\\.com$/.test(h)) {
      const SPAM = "Instagram flagged that request as automated, so Keepsake stopped. Wait a while before trying again. Don't retry repeatedly.";
      const hdrs = () => { const o = { "x-ig-app-id": "936619743392459", "x-requested-with": "XMLHttpRequest" }; const c = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1]; if (c) o["x-csrftoken"] = c; try { const w = sessionStorage.getItem("www-claim-v2"); if (w) o["x-ig-www-claim"] = w; } catch (e) {} return o; };
      const get = async (u) => { let j = null; try { const r = await fetch(u, { headers: hdrs(), credentials: "include" }); j = await r.json().catch(() => null); if (!r.ok && !(j && j.spam)) return null; } catch (e) { return null; } if (j && (j.spam || (j.status === "fail" && !j.items && !j.reels && !j.user && !j.data))) throw new Error(SPAM); return j; };
      const onPage = (code) => { const out = []; document.querySelectorAll('script[type="application/json"]').forEach((s) => { const t = s.textContent || ""; if (t.length < 5e6 && (t.indexOf("image_versions2") >= 0 || t.indexOf("video_versions") >= 0) && (!code || t.indexOf(code) >= 0)) out.push(t); }); return out; };
      const userId = async (name) => { const j = await get("/api/v1/users/web_profile_info/?username=" + encodeURIComponent(name)); return { j: j, id: j && j.data && j.data.user && j.data.user.id }; };
      const base = { type: "keepsake:post", platform: "instagram", url: location.href };
      const hl = p.match(/\\/stories\\/highlights\\/(\\d+)/);
      const st = !hl && p.match(/\\/stories\\/([\\w.]+)\\/(\\d+)/);
      const su = !hl && !st && p.match(/\\/stories\\/([\\w.]+)\\/?$/);
      const m = p.match(/\\/(?:[\\w.]+\\/)?(?:p|reel|reels|tv)\\/([\\w-]+)/);
      const seg = p.split("/").filter(Boolean);
      const RES = ["explore", "accounts", "direct", "reels", "stories", "p", "reel", "tv", "about", "legal", "web", "challenge", "emails", "settings", "your_activity", "notifications"];
      toast("Reading…");
      if (hl) {
        const raw = await get("/api/v1/feed/reels_media/?reel_ids=highlight:" + hl[1]);
        if (!raw) throw new Error("Couldn't read this highlight. Make sure you can see it.");
        msg = Object.assign(base, { kind: "reel", reelLabel: "highlight_" + hl[1], raw: raw });
      } else if (su) {
        const u = await userId(su[1]);
        const raw = u.id ? await get("/api/v1/feed/reels_media/?reel_ids=" + u.id) : null;
        if (!raw) throw new Error("Couldn't read these stories. Make sure you can see them.");
        msg = Object.assign(base, { kind: "reel", reelLabel: "stories_" + su[1], raw: raw });
      } else if (m || st) {
        const code = m ? m[1] : undefined;
        const found = code ? onPage(code) : [];
        const raw = found.length ? null : await get("/api/v1/media/" + (st ? st[2] : sc2id(m[1])) + "/info/");
        if (!found.length && !raw && st) throw new Error("Couldn't read this story. Make sure you can see it.");
        msg = Object.assign(base, { kind: "post", shortcode: code, pageJson: found.length ? found : undefined, raw: raw, html: found.length || raw ? undefined : document.documentElement.outerHTML });
      } else if (seg.length && /^[\\w.]{1,30}$/.test(seg[0]) && RES.indexOf(seg[0].toLowerCase()) < 0) {
        const u = await userId(seg[0]);
        const info = u.id ? await get("/api/v1/users/" + u.id + "/info/") : null;
        if (!u.j && !info) throw new Error("Couldn't read this profile.");
        msg = Object.assign(base, { kind: "profile", username: seg[0], raw: { profile: u.j, info: info } });
      } else {
        throw new Error("Open a post, reel, story, highlight or profile first.");
      }
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
    return msg;
  };`;

const oneLine = (code: string) => code.split("\n").map((l) => l.trim()).filter(Boolean).join(" ");

export function bookmarkletSource(appUrl: string): string {
  const app = new URL(appUrl);
  const APP = JSON.stringify(app.origin + app.pathname);
  const ORIGIN = JSON.stringify(app.origin);
  return oneLine(`
(async () => {
  const APP = ${APP}, ORIGIN = ${ORIGIN};
  ${TOAST}
  ${COLLECT}
  try {
    const msg = await collect();
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
})();`);
}

export function bookmarkletHref(appUrl: string) {
  return `javascript:${encodeURIComponent(bookmarkletSource(appUrl))}`;
}

/** Code for the iOS Shortcut "Run JavaScript on Web Page" action. */
export function shortcutSource(): string {
  return oneLine(`
(async () => {
  ${TOAST}
  ${COLLECT}
  try {
    const msg = await collect();
    msg.keepsake = 1;
    toast("Copied for Keepsake");
    completion(JSON.stringify(msg));
  } catch (err) {
    completion(JSON.stringify({ keepsake: 1, error: String(err && err.message || err) }));
  }
})();`);
}
