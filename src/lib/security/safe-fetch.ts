import { lookup as dnsLookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupAddress } from "node:dns";
import { AppError } from "../http/errors";
import { isPrivateAddress } from "./net";

/** Only Instagram/Meta media CDNs may be fetched. */
export const MEDIA_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

export type Resolver = (host: string) => Promise<LookupAddress[]>;

const defaultResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

export function isAllowedMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return MEDIA_HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length);
}

/** Validates a media URL's shape. Throws AppError on anything unsafe. */
export function assertSafeMediaUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError("MEDIA_UNAVAILABLE", "Invalid media URL.");
  }
  if (u.protocol !== "https:") throw new AppError("MEDIA_UNAVAILABLE", "Media URL must use HTTPS.");
  if (u.username || u.password) throw new AppError("MEDIA_UNAVAILABLE", "Media URL must not contain credentials.");
  if (u.port && u.port !== "443") throw new AppError("MEDIA_UNAVAILABLE", "Media URL uses a non-standard port.");
  if (!isAllowedMediaHost(u.hostname)) throw new AppError("MEDIA_UNAVAILABLE", "Media host is not an Instagram CDN.");
  return u;
}

/** Resolves a hostname and rejects it if any address is non-public. */
export async function resolvePublicAddress(host: string, resolver: Resolver = defaultResolver): Promise<LookupAddress> {
  let addrs: LookupAddress[];
  try {
    addrs = await resolver(host);
  } catch {
    throw new AppError("MEDIA_UNAVAILABLE", "Could not resolve media host.");
  }
  if (!addrs.length) throw new AppError("MEDIA_UNAVAILABLE", "Could not resolve media host.");
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new AppError("MEDIA_UNAVAILABLE", "Media host resolved to a disallowed address.");
  }
  return addrs[0];
}

export type DownloadResult = { bytes: number; contentType: string | null };

export type SafeDownloadOptions = {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolver?: Resolver;
};

/**
 * Downloads an Instagram CDN URL to `dest` with SSRF protection:
 * host allow-list, DNS resolution pinned to a vetted public IP (no rebinding),
 * re-validation on every redirect, size cap enforced while streaming, and timeout.
 */
export async function safeDownload(rawUrl: string, dest: string, opts: SafeDownloadOptions): Promise<DownloadResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let url = assertSafeMediaUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const addr = await resolvePublicAddress(url.hostname, opts.resolver);
    const res = await request(url, addr, opts.timeoutMs ?? 60_000);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = assertSafeMediaUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    if (status === 404 || status === 410 || status === 403) {
      res.resume();
      throw new AppError("MEDIA_UNAVAILABLE");
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new AppError("UPSTREAM_ERROR");
    }
    const declared = Number(res.headers["content-length"] ?? NaN);
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      res.destroy();
      throw new AppError("TOO_LARGE", `Limit is ${Math.round(opts.maxBytes / 1048576)} MB.`);
    }
    const bytes = await streamToFile(res, dest, opts.maxBytes);
    return { bytes, contentType: (res.headers["content-type"] as string | undefined) ?? null };
  }
  throw new AppError("MEDIA_UNAVAILABLE", "Too many redirects.");
}

function request(url: URL, addr: LookupAddress, timeoutMs: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        // Pin the connection to the address we already vetted.
        lookup: (_h, _o, cb) => cb(null, addr.address, addr.family),
        servername: url.hostname,
        headers: { "user-agent": "self-hosted-media-archiver/1.0", accept: "image/*,video/*" },
        timeout: timeoutMs,
      },
      resolve,
    );
    req.on("timeout", () => req.destroy(new AppError("PROCESSING_FAILED", "Download timed out.")));
    req.on("error", (e) => reject(e instanceof AppError ? e : new AppError("UPSTREAM_ERROR")));
  });
}

export function streamToFile(src: NodeJS.ReadableStream, dest: string, maxBytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let failed = false;
    const out = createWriteStream(dest, { mode: 0o600 });
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      (src as unknown as { destroy?: () => void }).destroy?.();
      out.destroy();
      unlink(dest).catch(() => {});
      reject(err);
    };
    src.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail(new AppError("TOO_LARGE", `Limit is ${Math.round(maxBytes / 1048576)} MB.`));
    });
    src.on("error", () => fail(new AppError("UPSTREAM_ERROR")));
    out.on("error", () => fail(new AppError("PROCESSING_FAILED")));
    out.on("finish", () => !failed && resolve(bytes));
    src.pipe(out);
  });
}
