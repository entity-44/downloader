# Keepsake

Save Instagram and Reddit media privately. Two versions live in this repo. Pick the one that fits.

| | [`web/`](web/): browser-only | [`server/`](server/): self-hosted |
|---|---|---|
| **Runs on** | GitHub Pages (free, no card) | Your own server / Docker |
| **Use it from** | Any device's browser | Any device's browser |
| **Instagram posts, reels, carousels, stories** | ✅ One-click button on the post | ✅ Official API (your Business/Creator accounts) |
| **Reddit videos (with sound), images, galleries** | ✅ | — |
| **Instagram data-export import + gallery** | ✅ In the browser | ✅ On the server |
| **Storage** | None. One-time: download and go | Saved library shared across devices, with sign-in |
| **Setup** | None (add the button once) | Docker + optional Meta app |
| **Method** | Reads the post you're viewing with your own session (unofficial) | Official APIs and your own files only |

**Live site:** https://entity-44.github.io/downloader/

- Browser-only version: [web/README.md](web/README.md)
- Self-hosted version: [server/README.md](server/README.md)

Only save media you own or have permission to keep.

```
.
├── web/                 Static Vite + React app (GitHub Pages)
├── server/              Next.js + Prisma/SQLite app (Docker)
└── .github/workflows/   Builds and deploys web/ to Pages
```
