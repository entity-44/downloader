"use client";

import type { DownloadDTO, FileDTO } from "@/lib/serialize";
import { formatBytes, formatDuration } from "@/lib/client/format";
import { IconDownload, IconImage, IconVideo } from "./icons";
import { LinkButton } from "./ui";

export function FilePreview({ file, className }: { file: FileDTO; className?: string }) {
  if (file.kind === "VIDEO" && file.previewable) {
    return (
      <video
        className={className ?? "aspect-square w-full bg-black object-contain"}
        src={`${file.url}?inline=1`}
        poster={file.hasThumb ? `${file.url}?variant=thumb` : undefined}
        controls
        preload="metadata"
        playsInline
      />
    );
  }
  if (file.thumbUrl) {
    return <img className={className ?? "aspect-square w-full object-cover"} src={file.thumbUrl} alt={file.caption ?? file.filename} loading="lazy" />;
  }
  return (
    <div className={`${className ?? "aspect-square w-full"} grid place-items-center bg-[var(--surface-2)] text-muted`}>
      <div className="flex flex-col items-center gap-1 text-xs">
        {file.kind === "VIDEO" ? <IconVideo className="size-6" /> : <IconImage className="size-6" />}
        Preview unavailable
      </div>
    </div>
  );
}

export function MediaResult({ download }: { download: DownloadDTO }) {
  const files = download.files;
  return (
    <div className="space-y-4">
      <div className={`grid gap-3 ${files.length === 1 ? "grid-cols-1 sm:max-w-md" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
        {files.map((f, i) => (
          <div key={f.id} className="group overflow-hidden rounded-xl border border-default bg-[var(--surface)] animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
            <FilePreview file={f} />
            <div className="flex items-center justify-between gap-2 p-2.5">
              <div className="min-w-0 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  {f.kind === "VIDEO" ? <IconVideo className="size-3.5" /> : <IconImage className="size-3.5" />}
                  {f.kind === "VIDEO" && f.durationSec ? formatDuration(f.durationSec) + " · " : ""}
                  {formatBytes(f.sizeBytes)}
                </span>
              </div>
              <a href={f.url} download className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition hover:bg-[var(--surface-2)]" aria-label={`Download ${f.filename}`}>
                <IconDownload className="size-4" /> Save
              </a>
            </div>
          </div>
        ))}
      </div>
      {files.length > 1 && (
        <LinkButton href={`/api/downloads/${download.id}/zip`} variant="primary">
          <IconDownload className="size-4" /> Download all {files.length} as ZIP
        </LinkButton>
      )}
    </div>
  );
}
