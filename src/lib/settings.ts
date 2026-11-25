import { z } from "zod";
import { getConfig } from "./config";
import { db } from "./db";
import { THEMES } from "./types";

export async function getSettings(userId: string) {
  return db().settings.upsert({ where: { userId }, create: { userId }, update: {} });
}

export function settingsSchema() {
  const capMb = Math.floor(getConfig().limits.maxDownloadBytesCap / 1048576);
  return z.object({
    theme: z.enum(THEMES).optional(),
    maxDownloadMb: z.number().int().min(1).max(capMb).optional(),
    retentionHours: z.number().int().min(1).max(24 * 90).optional(),
    autoCleanup: z.boolean().optional(),
  });
}

export async function maxDownloadBytes(userId: string) {
  const s = await getSettings(userId);
  return Math.min(s.maxDownloadMb * 1048576, getConfig().limits.maxDownloadBytesCap);
}
