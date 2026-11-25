import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { hashPassword } from "@/lib/auth/password";
import { createSession, sessionCookieName } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const ORIGIN = "http://localhost:3000";

let userSeq = 0;
export async function makeUser(name = `user${++userSeq}`, password = "correct horse battery") {
  const user = await db().user.create({ data: { username: name, passwordHash: await hashPassword(password), settings: { create: {} } } });
  const { token, session } = await createSession(user.id, "vitest");
  return { user, token, csrf: session.csrfToken, cookie: `${sessionCookieName()}=${token}`, password };
}

type ReqOpts = { cookie?: string; csrf?: string; body?: unknown; raw?: BodyInit | Buffer; headers?: Record<string, string>; origin?: string | null };

export function req(method: string, url: string, o: ReqOpts = {}) {
  const headers: Record<string, string> = { ...o.headers };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.csrf) headers["x-csrf-token"] = o.csrf;
  if (o.origin !== null && method !== "GET") headers.origin = o.origin ?? ORIGIN;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${url}`, {
    method,
    headers,
    body: (Buffer.isBuffer(o.raw) ? new Uint8Array(o.raw) : o.raw) ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    // @ts-expect-error Node fetch requires duplex for streaming bodies
    duplex: "half",
  });
}

export const params = <T>(p: T) => ({ params: Promise.resolve(p) });

// ---- Minimal ZIP writer (lets tests craft malicious archives precisely) ----

export type ZEntry = {
  name: string;
  data?: Buffer;
  compress?: boolean;
  unixMode?: number;
  declaredSize?: number;
  encrypted?: boolean;
};

export function buildZip(entries: ZEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = e.data ?? Buffer.alloc(0);
    const comp0 = e.compress ? deflateRawSync(data) : data;
    // Traditional PKWARE encryption prefixes data with a 12-byte header.
    const comp = e.encrypted ? Buffer.concat([Buffer.alloc(12), comp0]) : comp0;
    const method = e.compress ? 8 : 0;
    const crc = crc32(data);
    const usize = e.declaredSize ?? data.length;
    const flags = 0x0800 | (e.encrypted ? 1 : 0);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x5821, 12); // 2024-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x5821, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((e.unixMode ?? 0o100644) << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// ---- Real media fixtures generated with the bundled ffmpeg ----

let fixtures: { jpg: Buffer; png: Buffer; mp4: Buffer } | undefined;
export function mediaFixtures() {
  if (fixtures) return fixtures;
  const ff = path.resolve(import.meta.dirname, "../node_modules/ffmpeg-static/ffmpeg");
  const dir = mkdtempSync(path.join(os.tmpdir(), "igdl-fix-"));
  const run = (args: string[]) => execFileSync(ff, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  run(["-f", "lavfi", "-i", "testsrc=size=64x64:rate=1", "-frames:v", "1", path.join(dir, "a.jpg")]);
  run(["-f", "lavfi", "-i", "testsrc=size=64x64:rate=1", "-frames:v", "1", path.join(dir, "a.png")]);
  run(["-f", "lavfi", "-i", "testsrc=duration=3:size=160x120:rate=10", "-pix_fmt", "yuv420p", "-c:v", "mpeg4", path.join(dir, "a.mp4")]);
  fixtures = {
    jpg: readFileSync(path.join(dir, "a.jpg")),
    png: readFileSync(path.join(dir, "a.png")),
    mp4: readFileSync(path.join(dir, "a.mp4")),
  };
  return fixtures;
}
