# Keepsake media relay (Cloudflare Worker)

A tiny Worker that fetches **media files** (images, videos, Reddit video/audio streams) from Instagram's and Reddit's file servers for the Keepsake site. Downloads keep working when those servers don't let the browser read files directly, without keeping the Instagram tab open.

**Deployed at:** `https://keepsake-relay.keepsake-relay-7q.workers.dev` (Cloudflare free plan)

## What it will and won't do

- ✅ Relays `https://` files from `*.cdninstagram.com`, `*.fbcdn.net`, `*.redd.it`, `*.redditmedia.com`
- ✅ Answers only the Keepsake site's origin (`https://entity-44.github.io`, plus localhost for development)
- ✅ Re-checks every redirect; refuses non-media responses
- ❌ Never sends cookies, logins or Instagram app headers
- ❌ Doesn't look up posts or call Instagram's private API. Instagram only serves post data to signed-in browsers, so finding a post's files is done by the one-click button or the manual page-source paste on the site.

## Endpoints

| Path | |
|---|---|
| `GET /media?u=<encoded media URL>` | Streams the file |
| `GET /health` | `ok` |

## Update

Edit `worker.js`, then in the Cloudflare dashboard: Workers & Pages → `keepsake-relay` → **Edit code** → paste → **Deploy**. Tests live in `web/tests/relay.test.ts`.
