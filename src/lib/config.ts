import path from "node:path";
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("file:./data/app.db"),
  DATA_DIR: z.string().default("./data"),
  ENCRYPTION_KEY: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  ALLOW_REGISTRATION: bool(false),
  TRUST_PROXY: bool(false),
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_REDIRECT_URI: z.string().url().optional(),
  INSTAGRAM_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
  MAX_DOWNLOAD_MB_CAP: int(2048, 1, 100_000),
  MAX_UPLOAD_MB: int(1024, 1, 100_000),
  MAX_ARCHIVE_UPLOAD_MB: int(8192, 1, 200_000),
  MAX_ARCHIVE_EXTRACTED_MB: int(16384, 1, 500_000),
  MAX_ARCHIVE_ENTRY_MB: int(2048, 1, 100_000),
  MAX_ARCHIVE_ENTRIES: int(200_000, 1, 5_000_000),
  FFMPEG_PATH: z.string().optional(),
  CLEANUP_INTERVAL_MINUTES: int(15, 1, 1440),
  TEMP_FILE_MAX_AGE_HOURS: int(6, 1, 720),
});

export type AppConfig = ReturnType<typeof buildConfig>;

function buildConfig() {
  const env = schema.parse(process.env);
  const appUrl = new URL(env.APP_URL);
  const dataDir = path.resolve(env.DATA_DIR);
  const isProd = env.NODE_ENV === "production";
  const MB = 1024 * 1024;
  return {
    isProd,
    isTest: env.NODE_ENV === "test",
    appUrl,
    appOrigin: appUrl.origin,
    dataDir,
    storageDir: path.join(dataDir, "storage"),
    tmpDir: path.join(dataDir, "tmp"),
    databaseUrl: env.DATABASE_URL,
    encryptionKey: env.ENCRYPTION_KEY,
    cookieSecure: env.COOKIE_SECURE !== undefined ? env.COOKIE_SECURE === "true" : appUrl.protocol === "https:",
    allowRegistration: env.ALLOW_REGISTRATION,
    trustProxy: env.TRUST_PROXY,
    instagram: {
      appId: env.INSTAGRAM_APP_ID || undefined,
      appSecret: env.INSTAGRAM_APP_SECRET || undefined,
      redirectUri: env.INSTAGRAM_REDIRECT_URI ?? new URL("/api/instagram/callback", appUrl).toString(),
      graphVersion: env.INSTAGRAM_GRAPH_VERSION,
    },
    limits: {
      maxDownloadBytesCap: env.MAX_DOWNLOAD_MB_CAP * MB,
      maxUploadBytes: env.MAX_UPLOAD_MB * MB,
      maxArchiveUploadBytes: env.MAX_ARCHIVE_UPLOAD_MB * MB,
      maxArchiveExtractedBytes: env.MAX_ARCHIVE_EXTRACTED_MB * MB,
      maxArchiveEntryBytes: env.MAX_ARCHIVE_ENTRY_MB * MB,
      maxArchiveEntries: env.MAX_ARCHIVE_ENTRIES,
    },
    ffmpegPath: env.FFMPEG_PATH,
    cleanupIntervalMs: env.CLEANUP_INTERVAL_MINUTES * 60_000,
    tempFileMaxAgeMs: env.TEMP_FILE_MAX_AGE_HOURS * 3_600_000,
  };
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= buildConfig();
  return cached;
}

/** Test helper: re-read process.env on next getConfig(). */
export function resetConfig() {
  cached = undefined;
}

export function instagramConfigured(cfg = getConfig()) {
  return Boolean(cfg.instagram.appId && cfg.instagram.appSecret);
}
