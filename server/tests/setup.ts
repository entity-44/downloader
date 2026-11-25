import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach } from "vitest";

// Each test file gets an isolated data directory and SQLite database.
const dir = mkdtempSync(path.join(os.tmpdir(), "igdl-test-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.APP_URL = "http://localhost:3000";
process.env.ENCRYPTION_KEY = "a".repeat(64);
process.env.INSTAGRAM_APP_ID = "123456";
process.env.INSTAGRAM_APP_SECRET = "test-secret";
process.env.ALLOW_REGISTRATION = "false";

const sqlite = new Database(path.join(dir, "test.db"));
const migDir = path.resolve(import.meta.dirname, "../prisma/migrations");
for (const m of readdirSync(migDir).filter((d) => !d.endsWith(".toml")).sort()) {
  sqlite.exec(readFileSync(path.join(migDir, m, "migration.sql"), "utf8"));
}
sqlite.close();

beforeEach(async () => {
  const { resetAllLimiters } = await import("@/lib/security/rate-limit");
  resetAllLimiters();
});

afterAll(async () => {
  const { disconnectDb } = await import("@/lib/db");
  await disconnectDb();
  rmSync(dir, { recursive: true, force: true });
});
