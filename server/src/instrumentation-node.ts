import { mkdir } from "node:fs/promises";
import { getConfig } from "./lib/config";
import { log } from "./lib/log";
import { recoverInterruptedJobs, startCleanupScheduler } from "./lib/storage/cleanup";

const cfg = getConfig();
if (cfg.isProd && !cfg.encryptionKey) {
  throw new Error("ENCRYPTION_KEY must be set in production. Generate one with: openssl rand -hex 32");
}
await mkdir(cfg.storageDir, { recursive: true, mode: 0o700 });
await mkdir(cfg.tmpDir, { recursive: true, mode: 0o700 });
try {
  await recoverInterruptedJobs();
} catch (e) {
  log.error("Startup recovery failed — has the database been migrated? Run: npm run db:migrate", { error: e });
}
startCleanupScheduler();
log.info("Server ready", { instagramApi: Boolean(cfg.instagram.appId && cfg.instagram.appSecret) });
