import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronLeft, IconChevronRight, IconDownload, IconImage, IconUpload, IconVideo, IconX } from "../components/icons";
import { Button, Card, Notice, PageHeader, Progress, SectionTitle, cn } from "../components/ui";
import { openExport, type ExportItem, type ImportProgress, type OpenedExport } from "../lib/archive";
import { formatBytes, formatDuration, saveBlob } from "../lib/files";
import { UserError } from "../lib/types";
import { zipAndSave } from "../lib/zipexport";

const CAT: Record<string, string> = { post: "Posts", reel: "Reels", story: "Stories", igtv: "IGTV", profile: "Profile photos", archived: "Archived", message: "Messages", other: "Other" };
const PAGE = 120;

export function ImportView() {
  const [opened, setOpened] = useState<OpenedExport | null>(null);
  // Free thumbnails and the ZIP handle when leaving the page.
  useEffect(() => () => void opened?.close(), [opened]);

  if (opened) {
    return (
      <Gallery
        exp={opened}
        onReset={() => {
          void opened.close();
          setOpened(null);
        }}
      />
    );
  }
  return (
    <div className="space-y-8">
      <PageHeader title="Import your Instagram data" description="Open your official data export, browse it, and download what you want. It’s one-time: nothing is stored, and reloading clears it." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3"><Opener onOpened={setOpened} /></div>
        <div className="lg:col-span-2"><HowTo /></div>
      </div>
    </div>
  );
}

function Opener({ onOpened }: { onOpened: (e: OpenedExport) => void }) {
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function start(file: File) {
    setError(null);
    if (!/\.zip$/i.test(file.name)) return setError("Choose the .zip file you downloaded from Instagram.");
    abort.current = new AbortController();
    setProgress({ phase: "reading", done: 0, total: 0 });
    try {
      onOpened(await openExport(file, setProgress, abort.current.signal));
    } catch (e) {
      setError(e instanceof UserError ? e.message : "Couldn't open that file. It may be damaged or too large for this browser.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card>
      <SectionTitle title="Open your export" description="The ZIP from “Download your information” · read on this device only" />
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) start(f); }}
        className={cn("flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition", drag ? "border-[var(--color-accent-500)] bg-rose-500/5" : "border-default")}
      >
        {!progress ? (
          <>
            <span className="brand-gradient mb-3 grid size-12 place-items-center rounded-2xl text-white"><IconUpload className="size-6" /></span>
            <p className="font-medium">Drop your export ZIP here</p>
            <p className="mt-1 text-sm text-muted">or</p>
            <Button className="mt-3" onClick={() => input.current?.click()}>Choose file</Button>
            <input ref={input} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f); e.target.value = ""; }} />
          </>
        ) : (
          <div className="w-full max-w-sm text-left">
            <Progress
              value={progress.phase === "importing" && progress.total ? progress.done / progress.total : null}
              label={progress.phase === "reading" ? "Reading archive…" : `Preparing previews ${progress.done + 1} of ${progress.total}`}
            />
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => abort.current?.abort()}>Cancel</Button>
          </div>
        )}
      </div>
      {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
    </Card>
  );
}

function HowTo() {
  return (
    <Card>
      <SectionTitle title="How to get your export" />
      <ol className="space-y-3 text-sm">
        {[
          "Instagram → Settings → Accounts Center → Your information and permissions.",
          "“Download your information” → “Download or transfer information” → pick your account.",
          "Choose “All available information” (or just Content) → “Download to device”.",
          "Format: JSON (keeps dates and captions). Media quality: High.",
          "When Instagram emails you, download the ZIP and open it here. Big exports may come as several ZIPs: open each.",
        ].map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold">{i + 1}</span>
            <span className="text-muted">{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 rounded-xl bg-[var(--surface-2)] p-3 text-xs text-muted">Works for personal and private accounts, including expired stories. Only photos and videos (verified by content) are shown.</p>
    </Card>
  );
}

function Gallery({ exp, onReset }: { exp: OpenedExport; onReset: () => void }) {
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [zipping, setZipping] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of exp.items) m[it.category] = (m[it.category] ?? 0) + 1;
    return m;
  }, [exp]);
  const filtered = useMemo(
    () => exp.items.filter((i) => (!category || i.category === category) && (!kind || i.kind === kind)).sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? "")),
    [exp, category, kind],
  );
  const pageItems = filtered.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: Array<{ it: ExportItem; idx: number }> }> = [];
    pageItems.forEach((it, idx) => {
      const label = it.takenAt ? new Date(it.takenAt).toLocaleDateString(undefined, { year: "numeric", month: "long", timeZone: "UTC" }) : "Undated";
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push({ it, idx });
    });
    return out;
  }, [pageItems]);

  const zip = async (list: ExportItem[], suffix: string) => {
    setError(null);
    setZipping(0);
    try {
      await zipAndSave(
        list.map((it) => ({ name: `${it.category}/${it.filename}`, getBlob: () => exp.getBlob(it), date: it.takenAt ? new Date(it.takenAt) : undefined })),
        `keepsake_instagram_export_${suffix}.zip`,
        (d, t) => setZipping(d / t),
      );
    } catch {
      setError("Couldn't create the ZIP. Try downloading fewer files at once.");
    } finally {
      setZipping(null);
    }
  };
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <PageHeader
        title={exp.name}
        description={`${exp.items.length} photos and videos${exp.skipped ? ` · ${exp.skipped} other files skipped` : ""} · temporary, cleared when you leave`}
        action={<Button variant="ghost" onClick={onReset}>Start over</Button>}
      />
      <div className="sticky top-16 z-20 -mx-4 mb-6 space-y-3 border-b border-default bg-[var(--bg)]/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <Chip active={!category} onClick={() => { setCategory(""); setPage(1); }}>All <span className="text-muted">{exp.items.length}</span></Chip>
          {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
            <Chip key={c} active={category === c} onClick={() => { setCategory(c); setPage(1); }}>{CAT[c] ?? c} <span className="text-muted">{n}</span></Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-default p-0.5">
            {[["", "All"], ["IMAGE", "Photos"], ["VIDEO", "Videos"]].map(([k, l]) => (
              <button key={k} onClick={() => { setKind(k); setPage(1); }} className={cn("rounded-lg px-3 py-1 text-sm transition", kind === k ? "bg-[var(--surface-2)] font-medium" : "text-muted")}>{l}</button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear ({selected.size})</Button>
                <Button size="sm" variant="primary" disabled={zipping !== null} onClick={() => zip(exp.items.filter((i) => selected.has(i.id)), "selection")}><IconDownload className="size-4" /> Selected ({selected.size})</Button>
              </>
            )}
            <Button size="sm" disabled={zipping !== null || !filtered.length} onClick={() => zip(filtered, category || kind ? [category, kind.toLowerCase()].filter(Boolean).join("_") : "all")}>
              <IconDownload className="size-4" /> {category || kind ? `Download ${filtered.length}` : "Download all"} (ZIP)
            </Button>
          </div>
        </div>
        {zipping !== null && <Progress value={zipping} label={`Preparing ZIP… ${Math.round(zipping * 100)}%`} />}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.label}>
            <h3 className="mb-3 text-sm font-semibold text-muted">{g.label}</h3>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 md:grid-cols-6 lg:grid-cols-8">
              {g.items.map(({ it, idx }) => (
                <div key={it.id} className={cn("group relative aspect-square overflow-hidden rounded-lg bg-[var(--surface-2)] ring-offset-2 ring-offset-[var(--bg)]", selected.has(it.id) && "ring-2 ring-[var(--color-accent-500)]")}>
                  <button onClick={() => setOpen(idx)} className="block size-full" aria-label={`Open ${it.filename}`}>
                    {it.thumbUrl ? <img src={it.thumbUrl} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <span className="grid size-full place-items-center text-muted">{it.kind === "VIDEO" ? <IconVideo className="size-6" /> : <IconImage className="size-6" />}</span>}
                  </button>
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
        <Lightbox exp={exp} item={pageItems[open]} hasPrev={open > 0} hasNext={open < pageItems.length - 1} onPrev={() => setOpen(open - 1)} onNext={() => setOpen(open + 1)} onClose={() => setOpen(null)} />
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

function Lightbox({ exp, item, hasPrev, hasNext, onPrev, onNext, onClose }: { exp: OpenedExport; item: ExportItem; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    setUrl(null);
    exp.getBlob(item).then((b) => live && setUrl((u = URL.createObjectURL(b))));
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [exp, item]);
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
        <button onClick={async () => saveBlob(await exp.getBlob(item), item.filename)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-medium hover:bg-white/20"><IconDownload className="size-4" /> Download</button>
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
