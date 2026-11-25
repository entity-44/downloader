import { useMemo, useState } from "react";
import { addItem, newId, putCollection, type Collection, type Source } from "../lib/db";
import { downloadItem } from "../lib/fetchmedia";
import { formatDuration, postFilename, saveBlob } from "../lib/files";
import { go } from "../lib/router";
import { sniffBlob } from "../lib/sniff";
import { makeThumb } from "../lib/thumbs";
import { UserError, type MediaItem, type Post } from "../lib/types";
import { zipBlobs } from "../lib/zipexport";
import { IconCheck, IconDownload, IconExternal, IconImage, IconLayers, IconVideo } from "./icons";
import { Badge, Button, Notice, Spinner, cn } from "./ui";

type ItemState = { status: "idle" | "busy" | "done" | "error"; stage?: string; progress?: number; error?: string; note?: string };

const ATTEST_KEY = "attested_session";

export function PostResult({ post, source }: { post: Post; source?: Source }) {
  const [attested, setAttested] = useState(() => sessionStorage.getItem(ATTEST_KEY) === "1");
  const [states, setStates] = useState<Record<number, ItemState>>({});
  const [blobs] = useState(() => new Map<number, Blob>());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ext = (b: Blob, item: MediaItem) => (b.type.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov") ?? (item.kind === "VIDEO" ? "mp4" : "jpg"));
  const name = (i: number, b: Blob) => postFilename({ platform: post.platform, author: post.author, id: post.id, takenAt: post.takenAt, index: i, total: post.items.length, ext: ext(b, post.items[i]) });
  const set = (i: number, s: ItemState) => setStates((prev) => ({ ...prev, [i]: s }));

  async function get(i: number): Promise<Blob> {
    const cached = blobs.get(i);
    if (cached) return cached;
    set(i, { status: "busy", stage: "Downloading" });
    try {
      const r = await downloadItem(post.items[i], (stage, p) => set(i, { status: "busy", stage, progress: p }));
      blobs.set(i, r.blob);
      set(i, { status: "done", note: r.note });
      return r.blob;
    } catch (e) {
      const msg = e instanceof UserError ? e.message : "Download failed. Try again.";
      set(i, { status: "error", error: msg });
      throw e;
    }
  }

  const confirm = (v: boolean) => {
    setAttested(v);
    if (v) sessionStorage.setItem(ATTEST_KEY, "1");
    else sessionStorage.removeItem(ATTEST_KEY);
  };

  async function downloadOne(i: number) {
    try {
      const b = await get(i);
      saveBlob(b, name(i, b));
    } catch {
      /* state shows the error */
    }
  }

  async function downloadAll() {
    setError(null);
    const files: Array<{ name: string; blob: Blob }> = [];
    for (let i = 0; i < post.items.length; i++) {
      try {
        const b = await get(i);
        files.push({ name: name(i, b), blob: b });
      } catch {
        /* skip failed items */
      }
    }
    if (!files.length) return setError("None of the files could be downloaded.");
    await zipBlobs(files, `${post.platform}_${post.author ? `${post.author}_` : ""}${post.id}.zip`);
  }

  async function saveToLibrary() {
    setSaving(true);
    setError(null);
    try {
      const c: Collection = {
        id: newId(),
        source: source ?? post.platform,
        title: post.title ?? post.caption?.split("\n")[0]?.slice(0, 120) ?? `${post.platform === "reddit" ? "Reddit" : "Instagram"} post`,
        sourceUrl: post.url,
        author: post.author,
        caption: post.caption,
        takenAt: post.takenAt,
        createdAt: new Date().toISOString(),
        count: 0,
        sizeBytes: 0,
      };
      await putCollection(c);
      for (let i = 0; i < post.items.length; i++) {
        let b: Blob;
        try {
          b = await get(i);
        } catch {
          continue;
        }
        const sn = await sniffBlob(b);
        if (!sn) continue;
        const { thumb, width, height, ...rest } = await makeThumb(b, sn.kind);
        const id = newId();
        await addItem(
          {
            id,
            collectionId: c.id,
            kind: sn.kind,
            mime: sn.mime,
            size: b.size,
            filename: name(i, b),
            category: post.platform,
            caption: post.caption,
            takenAt: post.takenAt,
            position: i,
            width,
            height,
            durationSec: "durationSec" in rest ? (rest.durationSec as number | undefined) : post.items[i].durationSec,
            hasThumb: !!thumb,
          },
          b,
          thumb,
        );
        c.count++;
        c.sizeBytes += b.size;
        c.coverId ??= id;
      }
      if (!c.count) throw new UserError("Nothing could be saved.");
      await putCollection(c);
      setSaved(c.id);
    } catch (e) {
      setError(e instanceof UserError ? e.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  }

  const busy = useMemo(() => Object.values(states).some((s) => s.status === "busy"), [states]);
  const isCarousel = post.items.length > 1;

  return (
    <div className="surface rounded-2xl p-5 animate-fade-up">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={post.platform === "reddit" ? "amber" : "violet"}>{post.platform === "reddit" ? "Reddit" : "Instagram"}</Badge>
        {post.author && <span className="text-sm font-medium">{post.platform === "reddit" ? `u/${post.author}` : `@${post.author}`}</span>}
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          {isCarousel ? <IconLayers className="size-3.5" /> : post.items[0]?.kind === "VIDEO" ? <IconVideo className="size-3.5" /> : <IconImage className="size-3.5" />}
          {isCarousel ? `${post.items.length} items` : post.items[0]?.kind === "VIDEO" ? "Video" : "Image"}
        </span>
        {post.url && (
          <a href={post.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex max-w-full items-center gap-1 truncate text-xs text-muted hover:underline">
            <span className="truncate">{post.url.replace(/^https:\/\/(www\.)?/, "")}</span> <IconExternal className="size-3 shrink-0" />
          </a>
        )}
      </div>
      {(post.title || post.caption) && <p className="mb-4 line-clamp-3 text-sm text-muted">{post.title ?? post.caption}</p>}
      {post.notes?.map((n) => <div key={n} className="mb-4"><Notice tone="warn">{n}</Notice></div>)}

      {post.items.length === 0 ? (
        <Notice tone="error" title="Nothing to download">This post doesn't contain downloadable images or videos.</Notice>
      ) : (
        <>
          <div className={cn("grid gap-3", post.items.length === 1 ? "grid-cols-1 sm:max-w-md" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
            {post.items.map((it, i) => {
              const s = states[i] ?? { status: "idle" };
              return (
                <div key={i} className="overflow-hidden rounded-xl border border-default bg-[var(--surface)]">
                  <div className="relative aspect-square bg-[var(--surface-2)]">
                    {it.thumbUrl || it.kind === "IMAGE" ? (
                      <img src={it.thumbUrl ?? it.url} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                    ) : (
                      <div className="grid size-full place-items-center text-muted"><IconVideo className="size-8" /></div>
                    )}
                    {it.kind === "VIDEO" && (
                      <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        <IconVideo className="size-3" /> {formatDuration(it.durationSec) || "Video"}
                      </span>
                    )}
                    {s.status === "busy" && (
                      <div className="absolute inset-0 grid place-items-center bg-black/50 text-center text-xs text-white">
                        <div className="flex flex-col items-center gap-2 px-2"><Spinner />{s.stage}{s.progress !== undefined ? ` ${Math.round(s.progress * 100)}%` : "…"}</div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 p-2">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-[var(--surface-2)]" title="Open the original file (long-press or right-click to save)">
                      <IconExternal className="size-3.5" /> Open file
                    </a>
                    <button disabled={!attested || s.status === "busy"} onClick={() => downloadOne(i)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition hover:bg-[var(--surface-2)] disabled:opacity-40">
                      {s.status === "done" ? <IconCheck className="size-4 text-emerald-500" /> : <IconDownload className="size-4" />} Save
                    </button>
                  </div>
                  {s.status === "error" && <p className="px-2.5 pb-2.5 text-xs text-red-600 dark:text-red-400">{s.error}</p>}
                  {s.note && <p className="px-2.5 pb-2.5 text-xs text-amber-600 dark:text-amber-400">{s.note}</p>}
                </div>
              );
            })}
          </div>

          <label className="mt-5 flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent-500)]" checked={attested} onChange={(e) => confirm(e.target.checked)} />
            <span>I own this media or have the owner’s permission to keep a copy.</span>
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!attested || busy} loading={saving} onClick={saveToLibrary}>
              <IconCheck className="size-4" /> Save to library
            </Button>
            {isCarousel && (
              <Button disabled={!attested || busy} onClick={downloadAll}>
                <IconDownload className="size-4" /> Download all as ZIP
              </Button>
            )}
          </div>
          {saved && (
            <div className="mt-4">
              <Notice tone="success" title="Saved to your library" action={<Button size="sm" onClick={() => go(`collection/${saved}`)}>Open</Button>}>
                Stored privately in this browser.
              </Notice>
            </div>
          )}
          {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
        </>
      )}
    </div>
  );
}
