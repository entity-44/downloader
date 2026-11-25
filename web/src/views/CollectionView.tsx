import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCheck, IconChevronLeft, IconChevronRight, IconDownload, IconExternal, IconImage, IconVideo, IconX } from "../components/icons";
import { Button, ConfirmButton, Notice, PageHeader, Progress, cn } from "../components/ui";
import { deleteCollection, deleteItems, getBlob, getCollection, getThumb, listItems, type Collection, type Item } from "../lib/db";
import { formatBytes, formatDuration, saveBlob } from "../lib/files";
import { go } from "../lib/router";
import { downloadZip } from "../lib/zipexport";

const CAT: Record<string, string> = { post: "Posts", reel: "Reels", story: "Stories", igtv: "IGTV", profile: "Profile photos", archived: "Archived", message: "Messages", other: "Other", instagram: "Instagram", reddit: "Reddit", upload: "Your files" };
const PAGE = 120;

function useObjectUrl(loader: () => Promise<Blob | undefined>, deps: unknown[]) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    loader().then((b) => live && b && setUrl((u = URL.createObjectURL(b))));
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return url;
}

function Thumb({ item }: { item: Item }) {
  const url = useObjectUrl(() => (item.hasThumb ? getThumb(item.id) : Promise.resolve(undefined)), [item.id, item.hasThumb]);
  return url ? <img src={url} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <span className="grid size-full place-items-center text-muted">{item.kind === "VIDEO" ? <IconVideo className="size-6" /> : <IconImage className="size-6" />}</span>;
}

export function CollectionView({ id }: { id: string }) {
  const [col, setCol] = useState<Collection | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [zipping, setZipping] = useState<number | null>(null);

  const load = useCallback(async () => {
    setCol((await getCollection(id)) ?? null);
    setItems(await listItems(id));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.category ?? "other"] = (m[it.category ?? "other"] ?? 0) + 1;
    return m;
  }, [items]);
  const filtered = useMemo(
    () => items.filter((i) => (!category || (i.category ?? "other") === category) && (!kind || i.kind === kind)).sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? "") || a.position - b.position),
    [items, category, kind],
  );
  const pageItems = filtered.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: Array<{ it: Item; idx: number }> }> = [];
    pageItems.forEach((it, idx) => {
      const label = it.takenAt ? new Date(it.takenAt).toLocaleDateString(undefined, { year: "numeric", month: "long", timeZone: "UTC" }) : "Undated";
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push({ it, idx });
    });
    return out;
  }, [pageItems]);

  if (col === undefined) return <div className="h-64 animate-pulse rounded-2xl bg-[var(--surface-2)]" />;
  if (col === null) return <Notice tone="error" title="Not found">This collection doesn’t exist in this browser. <a className="underline" href="#/library">Back to library</a></Notice>;

  const zip = async (list: Item[], suffix: string) => {
    setZipping(0);
    try {
      await downloadZip(list, `keepsake_${col.title.replace(/[^\w-]+/g, "_").slice(0, 40)}_${suffix}.zip`, (d, t) => setZipping(d / t));
    } finally {
      setZipping(null);
    }
  };
  const toggle = (iid: string) => setSelected((p) => { const n = new Set(p); if (n.has(iid)) n.delete(iid); else n.add(iid); return n; });
  const showFilters = Object.keys(counts).length > 1 || items.length > 12;

  return (
    <div>
      <PageHeader
        title={col.title}
        description={<>{col.count} file{col.count === 1 ? "" : "s"} · {formatBytes(col.sizeBytes)}{col.sourceUrl && <> · <a href={col.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">original <IconExternal className="size-3" /></a></>}</>}
        action={<a href="#/library" className="text-sm text-muted hover:text-[var(--text)]">← Library</a>}
      />
      <div className="sticky top-16 z-20 -mx-4 mb-6 space-y-3 border-b border-default bg-[var(--bg)]/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        {showFilters && (
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            <Chip active={!category} onClick={() => { setCategory(""); setPage(1); }}>All <span className="text-muted">{items.length}</span></Chip>
            {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
              <Chip key={c} active={category === c} onClick={() => { setCategory(c); setPage(1); }}>{CAT[c] ?? c} <span className="text-muted">{n}</span></Chip>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {showFilters && (
            <div className="inline-flex rounded-xl border border-default p-0.5">
              {[["", "All"], ["IMAGE", "Photos"], ["VIDEO", "Videos"]].map(([k, l]) => (
                <button key={k} onClick={() => { setKind(k); setPage(1); }} className={cn("rounded-lg px-3 py-1 text-sm transition", kind === k ? "bg-[var(--surface-2)] font-medium" : "text-muted")}>{l}</button>
              ))}
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear ({selected.size})</Button>
                <ConfirmButton onConfirm={async () => { await deleteItems(id, [...selected]); setSelected(new Set()); load(); }} confirmLabel={`Delete ${selected.size}`}>Delete</ConfirmButton>
                <Button size="sm" variant="primary" disabled={zipping !== null} onClick={() => zip(items.filter((i) => selected.has(i.id)), "selection")}><IconDownload className="size-4" /> Selected ({selected.size})</Button>
              </>
            )}
            <Button size="sm" disabled={zipping !== null || !filtered.length} onClick={() => zip(filtered, category || kind ? "filtered" : "all")}>
              <IconDownload className="size-4" /> {category || kind ? `Download ${filtered.length}` : "Download all"} (ZIP)
            </Button>
            <ConfirmButton onConfirm={async () => { await deleteCollection(id); go("library"); }} confirmLabel="Delete collection">Delete all</ConfirmButton>
          </div>
        </div>
        {zipping !== null && <Progress value={zipping} label={`Preparing ZIP… ${Math.round(zipping * 100)}%`} />}
      </div>

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.label}>
            {items.length > 1 && <h3 className="mb-3 text-sm font-semibold text-muted">{g.label}</h3>}
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 md:grid-cols-6 lg:grid-cols-8">
              {g.items.map(({ it, idx }) => (
                <div key={it.id} className={cn("group relative aspect-square overflow-hidden rounded-lg bg-[var(--surface-2)] ring-offset-2 ring-offset-[var(--bg)]", selected.has(it.id) && "ring-2 ring-[var(--color-accent-500)]")}>
                  <button onClick={() => setOpen(idx)} className="block size-full" aria-label={`Open ${it.filename}`}><Thumb item={it} /></button>
                  {it.kind === "VIDEO" && <span className="pointer-events-none absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"><IconVideo className="size-3" /> {formatDuration(it.durationSec)}</span>}
                  <button onClick={() => toggle(it.id)} aria-pressed={selected.has(it.id)} aria-label="Select" className={cn("absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full border-2 transition", selected.has(it.id) ? "border-transparent bg-[var(--color-accent-500)] text-white" : "border-white/90 bg-black/20 text-transparent sm:opacity-0 sm:group-hover:opacity-100")}>
                    <IconCheck className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><IconChevronLeft className="size-4" /> Previous</Button>
          <span className="text-sm text-muted">Page {page} of {pages}</span>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next <IconChevronRight className="size-4" /></Button>
        </div>
      )}
      {open !== null && pageItems[open] && (
        <Lightbox item={pageItems[open]} hasPrev={open > 0} hasNext={open < pageItems.length - 1} onPrev={() => setOpen(open - 1)} onNext={() => setOpen(open + 1)} onClose={() => setOpen(null)} />
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

function Lightbox({ item, hasPrev, hasNext, onPrev, onNext, onClose }: { item: Item; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const url = useObjectUrl(() => getBlob(item.id), [item.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onPrev();
      else if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [hasPrev, hasNext, onPrev, onNext, onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={item.filename} className="fixed inset-0 z-50 flex flex-col bg-black/92 animate-fade-in" onClick={onClose}>
      <div className="flex items-center gap-3 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-medium">{item.filename}</p>
          <p className="text-xs text-white/60">{item.takenAt ? new Date(item.takenAt).toLocaleString() : "Undated"} · {formatBytes(item.size)}{item.width ? ` · ${item.width}×${item.height}` : ""}</p>
        </div>
        <button onClick={async () => { const b = await getBlob(item.id); if (b) saveBlob(b, item.filename); }} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-medium hover:bg-white/20"><IconDownload className="size-4" /> Download</button>
        <button onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-xl hover:bg-white/10"><IconX className="size-5" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16" onClick={(e) => e.stopPropagation()}>
        {url && (item.kind === "VIDEO" ? <video key={item.id} src={url} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" /> : <img key={item.id} src={url} alt={item.caption ?? ""} className="max-h-full max-w-full rounded-lg object-contain" />)}
        {hasPrev && <button onClick={onPrev} aria-label="Previous" className="absolute left-2 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-4"><IconChevronLeft className="size-5" /></button>}
        {hasNext && <button onClick={onNext} aria-label="Next" className="absolute right-2 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-4"><IconChevronRight className="size-5" /></button>}
      </div>
      {item.caption && <p className="mx-auto max-w-2xl px-4 pb-6 text-center text-sm text-white/80" onClick={(e) => e.stopPropagation()}>{item.caption}</p>}
    </div>
  );
}
