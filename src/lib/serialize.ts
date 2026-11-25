import type { ArchiveImport, Download, InstagramConnection, MediaFile } from "@/generated/prisma/client";
import { isBrowserPreviewable } from "./media/sniff";

export function fileDTO(f: MediaFile) {
  return {
    id: f.id,
    kind: f.kind,
    mimeType: f.mimeType,
    sizeBytes: Number(f.sizeBytes),
    filename: f.filename,
    category: f.category,
    caption: f.caption,
    takenAt: f.takenAt?.toISOString() ?? null,
    width: f.width,
    height: f.height,
    durationSec: f.durationSec,
    previewable: isBrowserPreviewable(f.mimeType),
    hasThumb: Boolean(f.thumbPath),
    url: `/api/files/${f.id}`,
    thumbUrl: f.thumbPath ? `/api/files/${f.id}?variant=thumb` : f.kind === "IMAGE" && isBrowserPreviewable(f.mimeType) ? `/api/files/${f.id}?inline=1` : null,
  };
}
export type FileDTO = ReturnType<typeof fileDTO>;

export function downloadDTO(d: Download & { files?: MediaFile[] }) {
  return {
    id: d.id,
    sourceUrl: d.sourceUrl,
    shortcode: d.shortcode,
    source: d.source,
    mediaType: d.mediaType,
    status: d.status,
    errorCode: d.errorCode,
    errorMessage: d.errorMessage,
    caption: d.caption,
    ownerUsername: d.ownerUsername,
    createdAt: d.createdAt.toISOString(),
    completedAt: d.completedAt?.toISOString() ?? null,
    expiresAt: d.expiresAt?.toISOString() ?? null,
    files: (d.files ?? []).sort((a, b) => a.position - b.position).map(fileDTO),
  };
}
export type DownloadDTO = ReturnType<typeof downloadDTO>;

export function archiveDTO(a: ArchiveImport) {
  return {
    id: a.id,
    originalName: a.originalName,
    sizeBytes: Number(a.sizeBytes),
    status: a.status,
    totalEntries: a.totalEntries,
    processedEntries: a.processedEntries,
    fileCount: a.fileCount,
    skippedCount: a.skippedCount,
    errorMessage: a.errorMessage,
    createdAt: a.createdAt.toISOString(),
    completedAt: a.completedAt?.toISOString() ?? null,
  };
}
export type ArchiveDTO = ReturnType<typeof archiveDTO>;

export function connectionDTO(c: InstagramConnection) {
  return {
    id: c.id,
    igUserId: c.igUserId,
    username: c.username,
    accountType: c.accountType,
    scopes: c.scopes ? c.scopes.split(",") : [],
    tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}
export type ConnectionDTO = ReturnType<typeof connectionDTO>;
