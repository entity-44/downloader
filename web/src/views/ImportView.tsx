import { useRef, useState } from "react";
import { IconUpload } from "../components/icons";
import { Badge, Button, Card, Notice, PageHeader, Progress, SectionTitle, cn } from "../components/ui";
import { type ImportProgress, importArchive } from "../lib/archive";
import { addItem, newId, putCollection, type Collection } from "../lib/db";
import { sanitize } from "../lib/files";
import { go } from "../lib/router";
import { sniffBlob } from "../lib/sniff";
import { makeThumb } from "../lib/thumbs";
import { UserError } from "../lib/types";

export function ImportView() {
  return (
    <div className="space-y-8">
      <PageHeader title="Import" description="Bring in your full Instagram history from your official data export, or add photos and videos you already have. Files never leave this device." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3"><ArchiveImport /></div>
        <div className="lg:col-span-2"><HowTo /></div>
      </div>
      <OwnFiles />
    </div>
  );
}

function ArchiveImport() {
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; count: number; skipped: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function start(file: File) {
    setError(null);
    setDone(null);
    if (!/\.zip$/i.test(file.name)) return setError("Choose the .zip file you downloaded from Instagram.");
    abort.current = new AbortController();
    setProgress({ phase: "reading", done: 0, total: 0 });
    try {
      const { collection, skipped } = await importArchive(file, setProgress, abort.current.signal);
      setDone({ id: collection.id, count: collection.count, skipped });
    } catch (e) {
      setError(e instanceof UserError ? e.message : "The import failed. The file may be damaged or too large for this browser.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card>
      <SectionTitle title="Instagram data export" description="The ZIP from “Download your information” · processed on this device" />
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
              label={progress.phase === "reading" ? "Reading archive…" : `Importing ${progress.done + 1} of ${progress.total}${progress.current ? ` · ${progress.current}` : ""}`}
            />
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => abort.current?.abort()}>Cancel</Button>
          </div>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        {done && (
          <Notice tone="success" title={`Imported ${done.count} files`} action={<Button size="sm" onClick={() => go(`collection/${done.id}`)}>Open gallery</Button>}>
            {done.skipped ? `${done.skipped} other entries (HTML, text, etc.) were skipped.` : "Organized by type and date."}
          </Notice>
        )}
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
          "Instagram → Settings → Accounts Center → Your information and permissions.",
          "“Download your information” → “Download or transfer information” → pick your account.",
          "Choose “All available information” (or just Content) → “Download to device”.",
          "Format: JSON (keeps dates and captions). Media quality: High.",
          "When Instagram emails you, download the ZIP and import it here. Big exports may come as several ZIPs: import each.",
        ].map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold">{i + 1}</span>
            <span className="text-muted">{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 rounded-xl bg-[var(--surface-2)] p-3 text-xs text-muted">Works for personal and private accounts. Only photos and videos (verified by content) are kept.</p>
    </Card>
  );
}

function OwnFiles() {
  const [attested, setAttested] = useState(false);
  const [status, setStatus] = useState<{ done: number; total: number; id?: string; failed: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function run(files: File[]) {
    const c: Collection = { id: newId(), source: "upload", title: files.length === 1 ? files[0].name : `${files.length} files`, createdAt: new Date().toISOString(), count: 0, sizeBytes: 0 };
    await putCollection(c);
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      setStatus({ done: i, total: files.length, failed });
      const f = files[i];
      const sn = await sniffBlob(f);
      if (!sn) {
        failed++;
        continue;
      }
      const blob = new Blob([f], { type: sn.mime });
      const { thumb, width, height, ...rest } = await makeThumb(blob, sn.kind);
      const id = newId();
      await addItem({ id, collectionId: c.id, kind: sn.kind, mime: sn.mime, size: f.size, filename: `${sanitize(f.name.replace(/\.[^.]*$/, ""))}.${sn.ext}`, category: "upload", position: i, width, height, durationSec: "durationSec" in rest ? (rest.durationSec as number | undefined) : undefined, hasThumb: !!thumb }, blob, thumb);
      c.count++;
      c.sizeBytes += f.size;
      c.coverId ??= id;
    }
    await putCollection(c);
    setStatus({ done: files.length, total: files.length, id: c.id, failed });
  }

  return (
    <Card>
      <SectionTitle title="Add files you were given" description="Keep photos or videos you already have in your library, e.g. ones a creator sent you." action={<Badge tone="green">Your files</Badge>} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent-500)]" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          <span>I own this media or have the owner’s permission to keep a copy.</span>
        </label>
        <Button variant="primary" disabled={!attested || (status !== null && status.done < status.total)} onClick={() => input.current?.click()}><IconUpload className="size-4" /> Choose photos or videos</Button>
        <input ref={input} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) run(fs); e.target.value = ""; }} />
      </div>
      {status && (
        <div className="mt-4">
          {status.done < status.total ? (
            <Progress value={status.done / status.total} label={`Adding ${status.done + 1} of ${status.total}…`} />
          ) : (
            <Notice tone={status.failed === status.total ? "error" : "success"} title={status.failed === status.total ? "No supported files" : `Added ${status.total - status.failed} file(s)`} action={status.id && status.failed < status.total ? <Button size="sm" onClick={() => go(`collection/${status.id}`)}>Open</Button> : undefined}>
              {status.failed ? `${status.failed} file(s) weren't supported images or videos.` : undefined}
            </Notice>
          )}
        </div>
      )}
    </Card>
  );
}
