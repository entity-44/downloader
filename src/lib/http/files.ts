import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { contentDisposition } from "../media/filenames";
import { isBrowserPreviewable } from "../media/sniff";
import { AppError } from "./errors";

const FILE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "cache-control": "private, max-age=300",
  "cross-origin-resource-policy": "same-origin",
};

export function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

/** Streams a private file with safe headers and HTTP Range support. */
export async function fileResponse(
  req: Request,
  absPath: string,
  opts: { mime: string; filename: string; inline: boolean },
): Promise<Response> {
  let size: number;
  try {
    size = (await stat(absPath)).size;
  } catch {
    throw new AppError("NOT_FOUND");
  }
  const inline = opts.inline && isBrowserPreviewable(opts.mime);
  const headers: Record<string, string> = {
    ...FILE_HEADERS,
    "content-type": inline ? opts.mime : opts.mime || "application/octet-stream",
    "content-disposition": contentDisposition(opts.filename, inline),
    "accept-ranges": "bytes",
  };
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  }
  if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "content-length": String(size) } });
  if (range) {
    const stream = createReadStream(absPath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: { ...headers, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${size}` },
    });
  }
  return new Response(Readable.toWeb(createReadStream(absPath)) as ReadableStream, {
    status: 200,
    headers: { ...headers, "content-length": String(size) },
  });
}
