import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { authed, json, readJson } from "@/lib/http/handler";
import { getSettings, settingsSchema } from "@/lib/settings";

function dto(s: Awaited<ReturnType<typeof getSettings>>) {
  return {
    theme: s.theme,
    maxDownloadMb: s.maxDownloadMb,
    retentionHours: s.retentionHours,
    autoCleanup: s.autoCleanup,
    limits: {
      maxDownloadMbCap: Math.floor(getConfig().limits.maxDownloadBytesCap / 1048576),
      maxUploadMb: Math.floor(getConfig().limits.maxUploadBytes / 1048576),
      maxArchiveUploadMb: Math.floor(getConfig().limits.maxArchiveUploadBytes / 1048576),
    },
  };
}

export const GET = authed(async ({ auth }) => json({ settings: dto(await getSettings(auth.user.id)) }));

export const PUT = authed(async ({ req, auth }) => {
  const patch = settingsSchema().parse(await readJson(req));
  await getSettings(auth.user.id);
  const s = await db().settings.update({ where: { userId: auth.user.id }, data: patch });
  // Apply new retention to downloads that are still stored.
  if (patch.retentionHours !== undefined || patch.autoCleanup !== undefined) {
    const completed = await db().download.findMany({
      where: { userId: auth.user.id, status: "COMPLETED", source: "CONNECTED_ACCOUNT" },
      select: { id: true, completedAt: true, createdAt: true },
    });
    for (const d of completed) {
      const base = (d.completedAt ?? d.createdAt).getTime();
      await db().download.update({
        where: { id: d.id },
        data: { expiresAt: s.autoCleanup ? new Date(base + s.retentionHours * 3600_000) : null },
      });
    }
  }
  return json({ settings: dto(s) });
});
