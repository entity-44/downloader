# Keepsake: browser-only version (GitHub Pages)

A static build of Keepsake that runs entirely in your browser. No server, no account, nothing uploaded. It's hosted free on GitHub Pages.

**Live site:** `https://<github-user>.github.io/<repo>/`

## What it does

| Feature | How |
|---|---|
| Instagram posts, reels, carousels, stories | **One-click button** (bookmarklet) on the post you're viewing on instagram.com |
| Reddit videos **with sound**, images, galleries | Button on reddit.com, a pasted `v.redd.it` link, or a pasted post link (with an optional Reddit client ID) |
| Your whole Instagram history | Import the official data-export ZIP (unpacked in the browser) |
| Files you were given | Add to your library |
| Official Instagram API (optional) | Facebook Login browser flow (no secret) for Business/Creator accounts linked to a Page |
| Backup | Paste the post's JSON / page source |

Your library is stored in the browser (IndexedDB) on each device. Reddit's separate video and audio streams are merged with a self-hosted FFmpeg WebAssembly build, loaded only when needed.

## How the button works

The bookmarklet runs on the post you're looking at. It reads that one post with the page's own access (`/api/v1/media/{id}/info/` on Instagram, `/comments/{id}.json` on Reddit), opens this site and hands the raw data over with `postMessage`. The site accepts messages only from the exact Instagram/Reddit origins and only from the tab that opened it. Parsing happens on the site, so format changes are fixed by redeploying, with no bookmark reinstall. If Instagram's CDN refuses a cross-site download, the site asks the original tab to fetch the file and pass it back.

It never crawls, scrolls or collects anything beyond the single post you open, and it asks you to confirm you own the media or have permission.

## Develop

```bash
cd web
npm install
npm run dev        # http://localhost:5173/downloader/
npm test           # parser, bridge and bookmarklet tests
npm run build      # → dist/
```

Deployment is automatic: `.github/workflows/pages.yml` tests, builds and publishes on every push to `main` that touches `web/`. Enable it once under **Repo → Settings → Pages → Source: GitHub Actions**.

## Limitations

- Instagram links can't be fetched by pasting alone. Instagram blocks other sites, so use the button.
- The button relies on Instagram/Reddit internal web data. It can break when they change their sites, and it's an unofficial method (terms-of-service grey area).
- Each device has its own library; nothing syncs.
- Mobile: bookmarklets work in Safari/Chrome (not inside the Instagram/Reddit apps) and take a one-time setup.
- Reddit share links (`/r/x/s/…`) must be opened first.
- HEIC thumbnails only render in Safari.
