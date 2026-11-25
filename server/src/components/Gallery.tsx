"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArchiveDTO, FileDTO } from "@/lib/serialize";
import { api, ApiRequestError } from "@/lib/client/api";
import { formatBytes, formatDate, formatDuration } from "@/lib/client/format";
import { IconCheck, IconChevronLeft, IconChevronRight, IconDownload, IconImage, IconVideo, IconX } from "./icons";
import { FilePreview } from "./MediaGrid";
import { Button, LinkButton, Notice, PageHeader, cn } from "./ui";

type Resp = {
  archive: ArchiveDTO;
  files: FileDTO[];
  total: number;
  page: number;
  pageSize: number;
  counts: { category: Record<string, number>; kind: Record<string, number> };
};

const CATEGORY_LABEL: Record<string, string> = {
  post: "Posts",
  reel: "Reels",
  story: "Stories",
  igtv: "IGTV",
  profile: "Profile photos",
  archived: "Archived",
  message: "Messages",
  other: "Other",
};

const PAGE_SIZE = 120;

export function Gallery({ archiveId }: { archiveId: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<number | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (category) qs.set("category", category);
    if (kind) qs.set("kind", kind);
    try {
      setData(await api<Resp>(`/api/archives/${archiveId}?${qs}`));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not load the gallery.");
    }
  }, [archiveId, category, kind, page]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: Array<{ f: FileDTO; idx: number }> }> = [];
    data?.files.forEach((f, idx) => {
      const label = f.takenAt ? new Date(f.takenAt).toLocaleDateString(undefined, { year: "numeric", month: "long", timeZone: "UTC" }) : "Undated";
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push({ f, idx });
    });
    return out;
  }, [data]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const filterQs = new URLSearchParams({ ...(category ? { category } : {}), ...(kind ? { kind } : {}) }).toString();
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const allCount = data ? Object.values(data.counts.category).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <PageHeader
        title="Archive gallery"
        description={data ? `${data.archive.originalName} · imported ${formatDate(data.archive.createdAt, false)} · ${allCount} files` : "Loading…"}
        action={
          <Link href="/import" className="text-sm text-muted hover:text-[var(--text)]">
            ← All imports
          </Link>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      {data && (
        <>
          <div className="sticky top-16 z-20 -mx-4 mb-6 space-y-3 border-b border-default bg-[var(--bg)]/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              <Chip active={!category} onClick={() => { setCategory(""); setPage(1); }}>All <span className="text-muted">{allCount}</span></Chip>
              {Object.entries(data.counts.category).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                <Chip key={c} active={category === c} onClick={() => { setCategory(c); setPage(1); }}>
                  {CATEGORY_LABEL[c] ?? c} <span className="text-muted">{n}</span>
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-default p-0.5">
                {[["", "All"], ["IMAGE", "Photos"], ["VIDEO", "Videos"]].map(([k, l]) => (
                  <button key={k} onClick={() => { setKind(k); setPage(1); }} className={cn("rounded-lg px-3 py-1 text-sm transition", kind === k ? "bg-[var(--surface-2)] font-medium" : "text-muted")}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {selected.size > 0 && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear ({selected.size})</Button>
                    <LinkButton href={`/api/archives/${archiveId}/zip?ids=${[...selected].join(",")}`} variant="primary">
                      <IconDownload className="size-4" /> Selected ({selected.size})
                    </LinkButton>
                  </>
                )}
                <LinkButton href={`/api/archives/${archiveId}/zip${filterQs ? `?${filterQs}` : ""}`}>
                  <IconDownload className="size-4" /> {category || kind ? `Download ${data.total} filtered` : "Download all"} (ZIP)
                </LinkButton>
              </div>
            </div>
          </div>

          {data.files.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No files match these filters.</p>
          ) : (
            <div className="space-y-8">
              {groups.map((g) => (
                <section key={g.label}>
                  <h3 className="mb-3 text-sm font-semibold text-muted">{g.label}</h3>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 md:grid-cols-6 lg:grid-cols-8">
                    {g.items.map(({ f, idx }) => (
                      <Tile key={f.id} f={f} selected={selected.has(f.id)} onSelect={() => toggle(f.id)} onOpen={() => setLightbox(idx)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><IconChevronLeft className="size-4" /> Previous</Button>
              <span className="text-sm text-muted">Page {page} of {pages}</span>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next <IconChevronRight className="size-4" /></Button>
            </div>
          )}
        </>
      )}

      {lightbox !== null && data?.files[lightbox] && (
        <Lightbox
          file={data.files[lightbox]}
          hasPrev={lightbox > 0}
          hasNext={lightbox < data.files.length - 1}
          onPrev={() => setLightbox(lightbox - 1)}
          onNext={() => setLightbox(lightbox + 1)}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition", active ? "border-transparent bg-[var(--text)] text-[var(--bg)] [&_.text-muted]:text-[var(--bg)]/70" : "border-default hover:bg-[var(--surface-2)]")}>
      {children}
    </button>
  );
}

function Tile({ f, selected, onSelect, onOpen }: { f: FileDTO; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <div className={cn("group relative aspect-square overflow-hidden rounded-lg bg-[var(--surface-2)] ring-offset-2 ring-offset-[var(--bg)] transition", selected && "ring-2 ring-[var(--color-accent-500)]")}>
      <button onClick={onOpen} className="block size-full" aria-label={`Open ${f.filename}`}>
        {f.thumbUrl ? (
          <img src={f.thumbUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <span className="grid size-full place-items-center text-muted">{f.kind === "VIDEO" ? <IconVideo className="size-6" /> : <IconImage className="size-6" />}</span>
        )}
      </button>
      {f.kind === "VIDEO" && (
        <span className="pointer-events-none absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <IconVideo className="size-3" /> {formatDuration(f.durationSec)}
        </span>
      )}
      <button
        onClick={onSelect}
        aria-label={selected ? "Deselect" : "Select"}
        aria-pressed={selected}
        className={cn(
          "absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full border-2 transition",
          selected ? "border-transparent bg-[var(--color-accent-500)] text-white" : "border-white/90 bg-black/20 text-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
        )}
      >
        <IconCheck className="size-3.5" />
      </button>
    </div>
  );
}

function Lightbox({ file, hasPrev, hasNext, onPrev, onNext, onClose }: { file: FileDTO; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onPrev();
      else if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [hasPrev, hasNext, onPrev, onNext, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={file.filename} className="fixed inset-0 z-50 flex flex-col bg-black/92 animate-fade-in" onClick={onClose}>
      <div className="flex items-center gap-3 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-medium">{file.filename}</p>
          <p className="text-xs text-white/60">{file.takenAt ? formatDate(file.takenAt) : "Undated"} · {formatBytes(file.sizeBytes)}{file.width ? ` · ${file.width}×${file.height}` : ""}</p>
        </div>
        <a href={file.url} download className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-medium hover:bg-white/20">
          <IconDownload className="size-4" /> Download
        </a>
        <button onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-xl hover:bg-white/10"><IconX className="size-5" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16" onClick={(e) => e.stopPropagation()}>
        {file.previewable ? (
          file.kind === "VIDEO" ? (
            <video key={file.id} src={`${file.url}?inline=1`} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />
          ) : (
            <img key={file.id} src={`${file.url}?inline=1`} alt={file.caption ?? ""} className="max-h-full max-w-full rounded-lg object-contain" />
          )
        ) : (
          <div className="w-64"><FilePreview file={file} /></div>
        )}
        {hasPrev && (
          <button onClick={onPrev} aria-label="Previous" className="absolute left-2 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-4"><IconChevronLeft className="size-5" /></button>
        )}
        {hasNext && (
          <button onClick={onNext} aria-label="Next" className="absolute right-2 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-4"><IconChevronRight className="size-5" /></button>
        )}
      </div>
      {file.caption && (
        <p className="mx-auto max-w-2xl px-4 pb-6 text-center text-sm text-white/80" onClick={(e) => e.stopPropagation()}>{file.caption}</p>
      )}
    </div>
  );
}
