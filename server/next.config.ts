import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy for application pages. Media served from /api/files
// sets its own, stricter policy. Instagram CDN hosts are allowed for <img> only,
// so a connected account's own thumbnails can be previewed before saving.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.cdninstagram.com https://*.fbcdn.net",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Never trace user data or secrets into build output.
  outputFileTracingExcludes: { "*": ["data/**", ".env*", "tests/**", "node_modules/ffmpeg-static/**"] },
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "yauzl", "yazl"],
  async headers() {
    return [
      {
        // Page CSP. Media responses from /api/files set a stricter sandboxed policy themselves.
        source: "/((?!api/files/).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
