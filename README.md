# Keepsake: self-hosted Instagram media downloader

A private, self-hostable web app for saving **Instagram media you own or are authorized to keep**:

- **Connected accounts**: paste a post / reel / video / carousel link from an Instagram *professional* account you've connected through Meta's official OAuth, and the app fetches the files using the official **Instagram API with Instagram Login**.
- **Data-export importer**: upload the ZIP from Instagram's *Download your information*. This works for **personal and private accounts** and includes stories, reels, posts, profile photos and archived media. Files are organized by type and date into a browsable gallery with bulk ZIP download.
- **Files you were given**: add photos or videos someone shared with you (with your attestation that you're authorized).

It **never** scrapes, bypasses login or privacy settings, uses stolen cookies, or asks for an Instagram password.

---

## Quick start (Docker)

```bash
cp .env.example .env
# Set a real encryption key (required):
sed -i.bak "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
docker compose up --build
```

Open http://localhost:3000. **The first visitor creates the admin account**, after which registration closes (set `ALLOW_REGISTRATION=true` to allow more users).

Data (SQLite database + media) lives in the `keepsake-data` volume at `/data`. Migrations run automatically on start.

## Local development

Requirements: Node.js ≥ 22 (tested on 26 LTS). FFmpeg is optional locally: the `ffmpeg-static` dev dependency is used automatically.

```bash
npm install
cp .env.example .env              # then set ENCRYPTION_KEY (openssl rand -hex 32)
npx prisma migrate deploy         # creates ./data/app.db
npm run dev                       # http://localhost:3000
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build && npm start` | Production build / server |
| `npm test` | Vitest suite (137 tests) |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply migrations |

## Production deployment

1. Put the app behind a TLS-terminating reverse proxy (Caddy, nginx, Traefik).
2. Set `APP_URL=https://your.domain` (cookies become `Secure` and `__Host-` prefixed automatically).
3. Set `TRUST_PROXY=true` **only** if your proxy sets `X-Forwarded-For`; it's used for rate limiting.
4. Back up the `/data` volume (it holds the database and all media).
5. Run **one replica**. Rate limits and the job queue are in-process; SQLite is single-writer.
6. Raise your proxy's request body limit to match `MAX_ARCHIVE_UPLOAD_MB` (exports can be several GB), e.g. nginx `client_max_body_size 8g;`.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | Public URL; used for OAuth redirect + origin checks |
| `ENCRYPTION_KEY` | — | **Required in production.** 32 bytes (hex/base64). Encrypts Instagram tokens. |
| `DATABASE_URL` | `file:./data/app.db` | SQLite file |
| `DATA_DIR` | `./data` | Private storage + temp; never web-served |
| `COOKIE_SECURE` | auto | Derived from `APP_URL` scheme |
| `ALLOW_REGISTRATION` | `false` | First user can always register |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` / `-Proto` |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | — | Enables account connection (see below) |
| `INSTAGRAM_REDIRECT_URI` | `${APP_URL}/api/instagram/callback` | Must match the Meta dashboard exactly |
| `INSTAGRAM_GRAPH_VERSION` | `v23.0` | Graph API version |
| `MAX_DOWNLOAD_MB_CAP` | `2048` | Upper bound for the per-user download limit |
| `MAX_UPLOAD_MB` | `1024` | Single "provided file" upload |
| `MAX_ARCHIVE_UPLOAD_MB` | `8192` | Export ZIP upload |
| `MAX_ARCHIVE_EXTRACTED_MB` / `MAX_ARCHIVE_ENTRY_MB` / `MAX_ARCHIVE_ENTRIES` | `16384` / `2048` / `200000` | Zip-bomb limits |
| `CLEANUP_INTERVAL_MINUTES` / `TEMP_FILE_MAX_AGE_HOURS` | `15` / `6` | Cleanup job |
| `FFMPEG_PATH` | auto | Docker sets `/usr/bin/ffmpeg` |

## Features requiring Meta API credentials

Connecting accounts and URL downloads need a Meta app. **Without credentials, the archive importer and file uploads still work fully.**

1. Create an app at <https://developers.facebook.com/apps> (type: Business) and add the **Instagram** product → **API setup with Instagram login**.
2. Add the OAuth redirect URI: `https://your.domain/api/instagram/callback`.
3. Copy the **Instagram app ID** and **Instagram app secret** into `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`.
4. Scope requested: `instagram_business_basic` (read profile + own media).
5. **Development mode**: add each Instagram account as an *Instagram Tester* (App roles) and accept the invite in Instagram. **Public use by other people requires Meta App Review** and Business Verification.
6. Connected accounts must be **Business or Creator** accounts. Personal accounts can't use the API; use the importer instead.

Tokens are long-lived (60 days), stored AES-256-GCM encrypted, and refreshed automatically when within 10 days of expiry.

## How access is decided

| Media | Method |
|---|---|
| Reels, photos, videos, carousels owned by a connected professional account | Official API: the link's shortcode is matched against the account's own media list |
| Anything in your own data export (incl. private/personal accounts, stories) | Archive importer |
| Files the owner gave you | "Add files you were given" upload |
| Public posts by other accounts | **Not downloadable.** Meta offers no official API for it; the app explains this and suggests asking the owner |
| Private accounts you don't own | **Not accessible**, by design |

## Security

- **Auth**: scrypt password hashing (N=2¹⁵); random 256-bit session tokens stored as SHA-256 hashes; `HttpOnly`, `SameSite=Lax`, `Secure`/`__Host-` cookies over HTTPS; password change revokes other sessions; session list and revocation.
- **CSRF**: per-session synchronizer token (`x-csrf-token`) + Origin / `Sec-Fetch-Site` checks on every mutation; OAuth uses a single-use, user-bound, 10-minute `state`.
- **Rate limiting**: per-IP and per-username login limits, per-user API, download, upload and file-read limits.
- **SSRF**: media is fetched only from `*.cdninstagram.com` / `*.fbcdn.net` over HTTPS:443. DNS results are vetted against private, loopback, link-local and metadata ranges, the connection is pinned to the vetted IP (no DNS rebinding), and every redirect is re-validated. Streamed size cap and timeout.
- **Uploads & archives**: raw streamed bodies with byte limits. Types come from magic bytes, never from names or headers. ZIPs reject traversal and absolute paths, skip symlinks and encrypted entries, cap entries, per-file and total size and compression ratio (zip-bomb guard), and count actual bytes instead of trusting headers. Output filenames are generated. Only images and videos are kept; nothing is executed.
- **Storage**: outside the web root (`/data`, mode 0700); every path is resolved and checked to stay inside the storage root; files are served only to their owner (404 for everyone else) with `nosniff`, `attachment` and a sandboxed CSP.
- **Headers**: CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP.
- **Secrets**: logs redact passwords, tokens, codes and secrets; Graph API URLs (which carry tokens) are never logged; API responses never include tokens or storage paths.
- **Container**: non-root user, read-only root FS, all capabilities dropped, `no-new-privileges`.

## Project structure

```
prisma/                 schema + SQL migrations
src/app/                Next.js App Router pages and API routes
  (app)/                authenticated pages: dashboard, history, import, gallery, accounts, settings
  api/                  auth, downloads, files, uploads, archives, instagram, settings, health
src/components/         UI (Tailwind v4)
src/lib/
  auth/                 password hashing, sessions, validation
  security/             CSRF/origin, rate limiting, SSRF-safe fetch, encryption
  instagram/            URL parsing, Graph API client, OAuth + token refresh
  downloads/            URL download pipeline + storage
  archive/              secure ZIP extraction, export metadata parsing, import jobs
  media/                magic-byte sniffing, FFmpeg wrapper, filenames
  storage/              paths, streaming ZIP, cleanup scheduler
tests/                  Vitest suites (URL, auth, authorization, CSRF, rate limits, SSRF, ZIP security, media, downloads, OAuth)
```

## Known limitations

- **No downloads of other people's public posts.** There is no official API for this, and scraping would violate the project's constraints and Instagram's terms.
- **Personal (non-professional) accounts** can't be connected; Meta retired the Basic Display API in Dec 2024. Use the data export.
- **Stories via URL** aren't supported by the API in a way that maps to story links; they're included in the data export.
- Shortcode lookup pages through the connected account's media (up to the 3,000 most recent posts, cached for 10 minutes).
- Instagram may omit `media_url` for copyright-flagged media; those items are reported as unavailable (partial carousels are flagged).
- Interrupted jobs (server restart mid-processing) are marked failed and must be retried.
- HEIC images download fine but only preview in Safari.
- Single-instance design (in-memory rate limiter and queue, SQLite). Use Postgres + Redis for horizontal scaling.
