"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArchiveDTO, DownloadDTO } from "@/lib/serialize";
import { api, ApiRequestError, uploadWithProgress } from "@/lib/client/api";
import { formatBytes, formatDate } from "@/lib/client/format";
import { IconArchive, IconCheck, IconChevronRight, IconUpload } from "./icons";
import { Badge, Button, Card, ConfirmButton, Notice, PageHeader, SectionTitle, Spinner, StatusBadge, cn } from "./ui";

export function ImportPage({ maxArchiveMb, maxUploadMb }: { maxArchiveMb: number; maxUploadMb: number }) {
  const [archives, setArchives] = useState<ArchiveDTO[] | null>(null);
  const load = useCallback(() => api<{ archives: ArchiveDTO[] }>("/api/archives").then((r) => setArchives(r.archives)).catch(() => setArchives([])), []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!archives?.some((a) => a.status === "PENDING" || a.status === "PROCESSING")) return;
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [archives, load]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Import your Instagram data"
        description="Your official Instagram data export contains everything you’ve posted — including stories, reels and content from private or personal accounts that the API can’t reach."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <ArchiveUploader maxMb={maxArchiveMb} onUploaded={load} />
          <Card>
            <SectionTitle title="Your imports" />
            {archives === null ? (
              <div className="h-16 animate-pulse rounded-xl bg-[var(--surface-2)]" />
            ) : archives.length === 0 ? (
              <p className="text-sm text-muted">No imports yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {archives.map((a) => (
                  <ArchiveRow key={a.id} a={a} onDelete={async () => { await api(`/api/archives/${a.id}`, { method: "DELETE" }); load(); }} />
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <HowTo />
        </div>
      </div>
      <ProvidedFiles maxMb={maxUploadMb} />
    </div>
  );
}

function ArchiveRow({ a, onDelete }: { a: ArchiveDTO; onDelete: () => Promise<void> }) {
  const busy = a.status === "PENDING" || a.status === "PROCESSING";
  const pct = a.totalEntries ? Math.round((a.processedEntries / a.totalEntries) * 100) : 0;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-2)]"><IconArchive className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{a.originalName}</p>
        <p className="text-xs text-muted">
          {formatDate(a.createdAt)} · {formatBytes(a.sizeBytes)}
          {a.status === "COMPLETED" && ` · ${a.fileCount} files${a.skippedCount ? `, ${a.skippedCount} other entries skipped` : ""}`}
        </p>
        {busy && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="brand-gradient h-full transition-all" style={{ width: `${a.status === "PENDING" ? 2 : Math.max(pct, 4)}%` }} />
          </div>
        )}
        {a.status === "FAILED" && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{a.errorMessage}</p>}
      </div>
      <StatusBadge status={a.status} />
      {a.status === "COMPLETED" && (
        <Link href={`/import/${a.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-sm font-medium surface hover:bg-[var(--surface-2)]">
          Open gallery <IconChevronRight className="size-4" />
        </Link>
      )}
      {!busy && <ConfirmButton onConfirm={onDelete}>Delete</ConfirmButton>}
    </li>
  );
}

function ArchiveUploader({ maxMb, onUploaded }: { maxMb: number; onUploaded: () => void }) {
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function start(file: File) {
    setError(null);
    setDone(false);
    if (!/\.zip$/i.test(file.name)) return setError("Please choose the .zip file you downloaded from Instagram.");
    if (file.size > maxMb * 1048576) return setError(`That file is larger than this server’s ${formatBytes(maxMb * 1048576)} limit.`);
    setProgress(0);
    const up = uploadWithProgress<{ archive: ArchiveDTO }>("/api/archives", file, { "content-type": "application/zip" }, setProgress);
    abortRef.current = up.abort;
    try {
      await up.promise;
      setDone(true);
      onUploaded();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Upload failed.");
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }

  return (
    <Card>
      <SectionTitle title="Upload data export" description={`ZIP from Instagram · up to ${formatBytes(maxMb * 1048576)}`} />
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) start(f); }}
        className={cn("flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition", drag ? "border-[var(--color-accent-500)] bg-rose-500/5" : "border-default")}
      >
        {progress === null ? (
          <>
            <span className="brand-gradient mb-3 grid size-12 place-items-center rounded-2xl text-white"><IconUpload className="size-6" /></span>
            <p className="font-medium">Drop your export ZIP here</p>
            <p className="mt-1 text-sm text-muted">or</p>
            <Button className="mt-3" onClick={() => inputRef.current?.click()}>Choose file</Button>
            <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f); e.target.value = ""; }} />
          </>
        ) : (
          <div className="w-full max-w-sm">
            <p className="mb-2 text-sm font-medium">Uploading… {Math.round(progress * 100)}%</p>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div className="brand-gradient h-full transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => abortRef.current?.()}>Cancel</Button>
          </div>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        {done && <Notice tone="success" title="Upload complete">We’re extracting and organizing your media now. This can take a few minutes for large exports.</Notice>}
      </div>
    </Card>
  );
}

function HowTo() {
  return (
    <Card>
      <SectionTitle title="How to get your export" />
      <ol className="space-y-3 text-sm">
        {[
          "In Instagram, open Settings → Accounts Center → Your information and permissions.",
          "Choose “Download your information” → “Download or transfer information”, then select your Instagram account.",
          "Pick “All available information” (or just Content), destination “Download to device”.",
          "Format: JSON is best (dates and captions are preserved). Media quality: High.",
          "When Instagram emails you, download the ZIP and upload it here. Large exports may arrive as several ZIPs — upload each.",
        ].map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold">{i + 1}</span>
            <span className="text-muted">{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 rounded-xl bg-[var(--surface-2)] p-3 text-xs text-muted">
        <p className="font-medium text-[var(--text)]">Safe by design</p>
        Archives are scanned for unsafe paths, size bombs and symlinks. Only photos and videos (verified by content) are kept; nothing extracted is ever executed.
      </div>
    </Card>
  );
}

type UploadItem = { name: string; status: "queued" | "uploading" | "done" | "error"; progress: number; message?: string };

function ProvidedFiles({ maxMb }: { maxMb: number }) {
  const [attested, setAttested] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(files: File[]) {
    setRunning(true);
    const list: UploadItem[] = files.map((f) => ({ name: f.name, status: "queued", progress: 0 }));
    setItems(list);
    const update = (i: number, patch: Partial<UploadItem>) => setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > maxMb * 1048576) {
        update(i, { status: "error", message: "Too large" });
        continue;
      }
      update(i, { status: "uploading" });
      const headers: Record<string, string> = { "x-authorization-attested": "true" };
      if (sourceUrl.trim()) headers["x-source-url"] = encodeURIComponent(sourceUrl.trim());
      try {
        await uploadWithProgress<{ download: DownloadDTO }>("/api/uploads", f, headers, (p) => update(i, { progress: p })).promise;
        update(i, { status: "done", progress: 1 });
      } catch (e) {
        update(i, { status: "error", message: e instanceof ApiRequestError ? e.message : "Failed" });
      }
    }
    setRunning(false);
  }

  return (
    <Card id="provided" className="scroll-mt-24">
      <SectionTitle
        title="Add files you were given"
        description="Save photos or videos you already have — for example, media a creator sent you with permission to keep. They appear in your history."
        action={<Badge tone="amber">Provided by you</Badge>}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Original post link <span className="font-normal text-muted">(optional)</span></span>
          <input className="input" type="url" placeholder="https://www.instagram.com/p/…" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} maxLength={2048} />
        </label>
        <div className="flex flex-col justify-end gap-3">
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent-500)]" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>I own this media or have the owner’s permission to keep a copy.</span>
          </label>
          <Button variant="primary" disabled={!attested || running} loading={running} onClick={() => inputRef.current?.click()}>
            <IconUpload className="size-4" /> Choose photos or videos
          </Button>
          <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/avif,video/mp4,video/quicktime" className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) run(fs); e.target.value = ""; }} />
        </div>
      </div>
      {items.length > 0 && (
        <ul className="mt-5 space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="w-5">{it.status === "done" ? <IconCheck className="size-4 text-emerald-500" /> : it.status === "uploading" ? <Spinner className="size-4" /> : null}</span>
              <span className="min-w-0 flex-1 truncate">{it.name}</span>
              {it.status === "uploading" && <span className="text-xs text-muted">{Math.round(it.progress * 100)}%</span>}
              {it.status === "error" && <span className="text-xs text-red-600 dark:text-red-400">{it.message}</span>}
              {it.status === "done" && <Link href="/history" className="text-xs text-muted underline underline-offset-4">View</Link>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
