import type { InstagramConnection } from "@/generated/prisma/client";
import { db } from "../db";
import { AppError, publicMessage } from "../http/errors";
import { findOwnedMediaId, getAccessToken } from "../instagram/connections";
import { InstagramGraph, type GraphChild, type GraphMedia } from "../instagram/graph";
import { parseInstagramUrl } from "../instagram/url";
import { log } from "../log";
import { downloadFilename } from "../media/filenames";
import { queues } from "../queue";
import { safeDownload, type SafeDownloadOptions } from "../security/safe-fetch";
import { getSettings, maxDownloadBytes } from "../settings";
import { tmpFile } from "../storage/paths";
import type { MediaType } from "../types";
import { downloadDir, removeDir, storeMediaFile } from "./store";

export type DownloadDeps = {
  graph?: InstagramGraph;
  fetchMedia?: (url: string, dest: string, opts: SafeDownloadOptions) => Promise<unknown>;
};

/**
 * Validates the URL, records a history entry and queues processing.
 * Invalid / non-post URLs are rejected immediately without a history entry.
 */
export async function requestDownload(userId: string, rawUrl: string, deps: DownloadDeps = {}) {
  const parsed = parseInstagramUrl(rawUrl);
  if (parsed.kind === "profile") {
    throw new AppError("UNSUPPORTED_URL", "Profile links can't be downloaded. Paste a link to a specific post or reel.");
  }
  if (parsed.kind === "story") {
    throw new AppError(
      "API_UNSUPPORTED",
      "Story links can't be resolved through the official API. Your own stories are included in your Instagram data export — import it on the Import page.",
    );
  }
  const download = await db().download.create({
    data: {
      userId,
      sourceUrl: parsed.canonicalUrl,
      shortcode: parsed.shortcode,
      urlKind: parsed.kind,
      source: "CONNECTED_ACCOUNT",
      status: "PENDING",
    },
  });
  queues().downloads.add(`download:${download.id}`, () => processDownload(download.id, deps));
  return download;
}

type Resolved = { conn: InstagramConnection; token: string; mediaId: string };

async function resolveOwned(userId: string, shortcode: string, graph: InstagramGraph): Promise<Resolved> {
  const conns = await db().instagramConnection.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (!conns.length) throw new AppError("NOT_CONNECTED");
  let tokenProblem: AppError | null = null;
  for (const conn of conns) {
    try {
      const token = await getAccessToken(conn, graph);
      const mediaId = await findOwnedMediaId(conn, token, shortcode, graph);
      if (mediaId) return { conn, token, mediaId };
    } catch (e) {
      if (e instanceof AppError && (e.code === "TOKEN_EXPIRED" || e.code === "RATE_LIMITED" || e.code === "UPSTREAM_ERROR")) {
        tokenProblem = e;
        continue;
      }
      throw e;
    }
  }
  if (tokenProblem) throw tokenProblem;
  const names = conns.map((c) => `@${c.username}`).join(", ");
  throw new AppError(
    "PRIVATE_MEDIA_REQUIRES_AUTHORIZATION",
    `Checked your connected account${conns.length > 1 ? "s" : ""} (${names}). Instagram's official API only provides media owned by the connected account.`,
  );
}

function mediaTypeOf(m: GraphMedia): MediaType {
  if (m.media_type === "CAROUSEL_ALBUM") return "CAROUSEL";
  if (m.media_product_type === "REELS") return "REEL";
  return m.media_type === "VIDEO" ? "VIDEO" : "IMAGE";
}

export async function processDownload(downloadId: string, deps: DownloadDeps = {}) {
  const graph = deps.graph ?? new InstagramGraph();
  const fetchMedia = deps.fetchMedia ?? safeDownload;
  const dl = await db().download.findUnique({ where: { id: downloadId } });
  if (!dl || dl.status !== "PENDING") return;
  await db().download.update({ where: { id: dl.id }, data: { status: "PROCESSING" } });
  const dir = downloadDir(dl.userId, dl.id);
  const tmpPaths: string[] = [];
  try {
    if (!dl.shortcode) throw new AppError("UNSUPPORTED_URL");
    const { conn, token, mediaId } = await resolveOwned(dl.userId, dl.shortcode, graph);
    const media = await graph.getMedia(token, mediaId);
    const items: Array<GraphMedia | GraphChild> =
      media.media_type === "CAROUSEL_ALBUM" ? (media.children?.data ?? []) : [media];
    const fetchable = items.filter((i) => i.media_url);
    if (!fetchable.length) throw new AppError("MEDIA_UNAVAILABLE");

    const mediaType = mediaTypeOf(media);
    const takenAt = media.timestamp ? new Date(media.timestamp) : null;
    const kindLabel = mediaType === "REEL" ? "reel" : mediaType === "CAROUSEL" ? "post" : mediaType === "VIDEO" ? "video" : "post";
    let budget = await maxDownloadBytes(dl.userId);

    const rows = [];
    for (let i = 0; i < fetchable.length; i++) {
      const item = fetchable[i];
      const tmp = await tmpFile("dl");
      tmpPaths.push(tmp);
      await fetchMedia(item.media_url!, tmp, { maxBytes: budget });
      const name = downloadFilename({
        username: conn.username,
        kind: kindLabel,
        shortcode: dl.shortcode,
        takenAt,
        index: i,
        total: fetchable.length,
        ext: "x",
      }).replace(/\.x$/, "");
      const stored = await storeMediaFile(tmp, dir, name);
      budget -= stored.sizeBytes;
      if (budget <= 0 && i < fetchable.length - 1) throw new AppError("TOO_LARGE", "This post exceeds your maximum download size setting.");
      rows.push({
        userId: dl.userId,
        downloadId: dl.id,
        kind: stored.sniffed.kind,
        mimeType: stored.sniffed.mime,
        sizeBytes: BigInt(stored.sizeBytes),
        storagePath: stored.storagePath,
        thumbPath: stored.thumbPath,
        filename: `${name}.${stored.sniffed.ext}`,
        category: kindLabel,
        caption: media.caption?.slice(0, 2200) ?? null,
        takenAt,
        position: i,
        width: stored.width,
        height: stored.height,
        durationSec: stored.durationSec,
      });
    }

    const settings = await getSettings(dl.userId);
    await db().$transaction([
      db().mediaFile.createMany({ data: rows }),
      db().download.update({
        where: { id: dl.id },
        data: {
          status: "COMPLETED",
          mediaType,
          caption: media.caption?.slice(0, 2200) ?? null,
          ownerUsername: conn.username,
          completedAt: new Date(),
          expiresAt: settings.autoCleanup ? new Date(Date.now() + settings.retentionHours * 3600_000) : null,
          errorCode: items.length !== fetchable.length ? "PARTIAL" : null,
          errorMessage:
            items.length !== fetchable.length ? `${items.length - fetchable.length} item(s) were withheld by Instagram.` : null,
        },
      }),
    ]);
  } catch (e) {
    const { code, message } = publicMessage(e);
    if (code === "PROCESSING_FAILED") log.error("Download failed", { downloadId, error: e });
    await removeDir(dir).catch(() => {});
    await db().download.update({
      where: { id: dl.id },
      data: { status: "FAILED", errorCode: code, errorMessage: message, completedAt: new Date() },
    });
  } finally {
    const { rm } = await import("node:fs/promises");
    await Promise.all(tmpPaths.map((p) => rm(p, { force: true })));
  }
}

export async function deleteDownload(userId: string, id: string) {
  const dl = await db().download.findFirst({ where: { id, userId } });
  if (!dl) throw new AppError("NOT_FOUND");
  await removeDir(downloadDir(userId, id));
  await db().download.delete({ where: { id } });
}

export async function clearHistory(userId: string) {
  const all = await db().download.findMany({ where: { userId }, select: { id: true } });
  for (const d of all) await removeDir(downloadDir(userId, d.id));
  await db().download.deleteMany({ where: { userId } });
  return all.length;
}
