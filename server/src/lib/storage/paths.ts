import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";

/**
 * All media lives under STORAGE_DIR (outside the web root). Database rows
 * store paths relative to it; every resolution is checked to stay inside.
 */
export function storageRoot() {
  return getConfig().storageDir;
}

export function resolveStoragePath(rel: string): string {
  const root = path.resolve(storageRoot());
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("Path escapes storage root");
  return abs;
}

export function toStorageRelative(abs: string): string {
  const rel = path.relative(path.resolve(storageRoot()), abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Path outside storage root");
  return rel.split(path.sep).join("/");
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function userDir(userId: string) {
  if (!/^[a-z0-9]+$/i.test(userId)) throw new Error("Invalid user id");
  return resolveStoragePath(path.join("users", userId));
}

export async function tmpFile(prefix: string, ext = "") {
  const dir = await ensureDir(getConfig().tmpDir);
  return path.join(dir, `${prefix}-${Date.now()}-${randomBytes(8).toString("hex")}${ext}`);
}
