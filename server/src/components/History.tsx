"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadDTO } from "@/lib/serialize";
import { api, ApiRequestError } from "@/lib/client/api";
import { formatBytes, formatDate, relativeTime } from "@/lib/client/format";
import { errorTitle } from "./errorGuidance";
import { IconDownload, IconExternal, IconHistory, IconImage, IconLayers, IconVideo } from "./icons";
import { FilePreview } from "./MediaGrid";
import { Button, ConfirmButton, EmptyState, LinkButton, Notice, PageHeader, SourceBadge, StatusBadge } from "./ui";

export function History() {
  const [items, setItems] = useState<DownloadDTO[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ downloads: DownloadDTO[]; nextCursor: string | null }>("/api/downloads?limit=30");
      setItems(r.downloads);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not load history.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh while anything is still processing.
  useEffect(() => {
    if (!items?.some((d) => d.status === "PENDING" || d.status === "PROCESSING")) return;
    pollRef.current = setTimeout(load, 2000);
    return () => void (pollRef.current && clearTimeout(pollRef.current));
  }, [items, load]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api<{ downloads: DownloadDTO[]; nextCursor: string | null }>(`/api/downloads?limit=30&cursor=${encodeURIComponent(cursor)}`);
      setItems((prev) => [...(prev ?? []), ...r.downloads]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/downloads/${id}`, { method: "DELETE" });
    setItems((prev) => prev?.filter((d) => d.id !== id) ?? null);
  }

  async function clearAll() {
    await api("/api/downloads", { method: "DELETE" });
    setItems([]);
    setCursor(null);
  }

  return (
    <div>
      <PageHeader
        title="Download history"
        description="Everything you’ve saved from connected accounts or added yourself. Downloaded files are removed automatically after your retention period."
        action={items && items.length > 0 ? <ConfirmButton size="md" onConfirm={clearAll} confirmLabel="Delete all history and files">Clear history</ConfirmButton> : null}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {items === null && !error && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--surface-2)]" />
          ))}
        </div>
      )}
      {items?.length === 0 && (
        <EmptyState icon={<IconHistory className="size-8" />} title="No downloads yet">
          Paste a link on the Download page, or add files on the Import page.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((d) => (
            <HistoryRow key={d.id} d={d} expanded={expanded === d.id} onToggle={() => setExpanded(expanded === d.id ? null : d.id)} onDelete={() => remove(d.id)} />
          ))}
        </ul>
      )}
      {cursor && (
        <div className="mt-6 flex justify-center">
          <Button onClick={more} loading={loadingMore}>Load more</Button>
        </div>
      )}
    </div>
  );
}

function TypeLabel({ d }: { d: DownloadDTO }) {
  const t = d.mediaType ?? (d.files.length > 1 ? "CAROUSEL" : d.files[0]?.kind);
  const Icon = t === "CAROUSEL" ? IconLayers : t === "VIDEO" || t === "REEL" ? IconVideo : IconImage;
  const label = t ? t.charAt(0) + t.slice(1).toLowerCase() : "—";
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Icon className="size-3.5" /> {label}
      {d.files.length > 1 && ` · ${d.files.length} items`}
    </span>
  );
}

function HistoryRow({ d, expanded, onToggle, onDelete }: { d: DownloadDTO; expanded: boolean; onToggle: () => void; onDelete: () => Promise<void> }) {
  const first = d.files[0];
  const total = d.files.reduce((s, f) => s + f.sizeBytes, 0);
  return (
    <li className="surface overflow-hidden rounded-2xl animate-fade-up">
      <div className="flex gap-4 p-3 sm:p-4">
        <button type="button" onClick={onToggle} disabled={!first} className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-default bg-[var(--surface-2)] sm:size-24" aria-label="Show files">
          {first ? (
            <span className="pointer-events-none block">
              <FilePreview file={{ ...first, previewable: first.kind === "IMAGE" && first.previewable }} className="size-20 object-cover sm:size-24" />
            </span>
          ) : (
            <span className="grid size-full place-items-center text-muted">
              <IconImage className="size-6" />
            </span>
          )}
          {d.files.length > 1 && <span className="absolute right-1 top-1 rounded-md bg-black/60 px-1.5 text-[10px] font-medium text-white">{d.files.length}</span>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} />
            <SourceBadge source={d.source} owner={d.ownerUsername} />
            <TypeLabel d={d} />
          </div>
          {d.sourceUrl ? (
            <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 flex items-center gap-1 truncate text-sm font-medium hover:underline">
              <span className="truncate">{d.sourceUrl.replace(/^https:\/\/www\./, "")}</span>
              <IconExternal className="size-3.5 shrink-0 text-muted" />
            </a>
          ) : (
            <p className="mt-1.5 truncate text-sm font-medium">{first?.filename ?? "Uploaded file"}</p>
          )}
          <p className="mt-0.5 text-xs text-muted" title={formatDate(d.createdAt)}>
            {formatDate(d.createdAt)}
            {total > 0 && ` · ${formatBytes(total)}`}
            {d.expiresAt && d.status === "COMPLETED" && ` · removed ${relativeTime(d.expiresAt)}`}
          </p>
          {d.status === "FAILED" && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              <span className="font-medium">{errorTitle(d.errorCode)}:</span> {d.errorMessage}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
          {d.status === "COMPLETED" && d.files.length === 1 && (
            <LinkButton href={d.files[0].url} download variant="secondary">
              <IconDownload className="size-4" /> <span className="hidden sm:inline">Download</span>
            </LinkButton>
          )}
          {d.status === "COMPLETED" && d.files.length > 1 && (
            <LinkButton href={`/api/downloads/${d.id}/zip`} variant="secondary">
              <IconDownload className="size-4" /> <span className="hidden sm:inline">ZIP</span>
            </LinkButton>
          )}
          <ConfirmButton onConfirm={onDelete}>Delete</ConfirmButton>
        </div>
      </div>
      {expanded && d.files.length > 0 && (
        <div className="border-t border-default p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {d.files.map((f) => (
              <div key={f.id} className="overflow-hidden rounded-xl border border-default">
                <FilePreview file={f} />
                <a href={f.url} download className="flex items-center justify-center gap-1 py-2 text-xs font-medium hover:bg-[var(--surface-2)]">
                  <IconDownload className="size-3.5" /> {formatBytes(f.sizeBytes)}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
