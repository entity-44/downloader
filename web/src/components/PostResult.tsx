import { useState } from "react";
import { downloadItem } from "../lib/fetchmedia";
import { formatDuration, postFilename, saveBlob } from "../lib/files";
import { redditVideoVariants } from "../lib/reddit";
import { UserError, type MediaItem, type Post, type Variant } from "../lib/types";
import { zipAndSave } from "../lib/zipexport";
import { IconCheck, IconDownload, IconExternal, IconImage, IconLayers, IconVideo } from "./icons";
import { Badge, Button, Notice, Spinner, cn } from "./ui";

type ItemState = { status: "idle" | "busy" | "done" | "error"; stage?: string; progress?: number; error?: string; note?: string };

const ATTEST_KEY = "attested_session";

/**
 * One-time result: preview, download (single file or ZIP), then start over.
 * Downloaded files are held only until the page is left or reset.
 */
export function PostResult({ post, onReset, resetLabel = "Start over" }: { post: Post; onReset?: () => void; resetLabel?: string }) {
  const [attested, setAttested] = useState(() => sessionStorage.getItem(ATTEST_KEY) === "1");
  const [states, setStates] = useState<Record<number, ItemState>>({});
  const [blobs] = useState(() => new Map<string, Blob>());
  // Chosen size per item (defaults to the best / HD version) and lazily loaded Reddit sizes.
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState<Record<number, Variant[]>>({});
  const optionsFor = (i: number): Variant[] => post.items[i].variants ?? extra[i] ?? [];
  const urlFor = (i: number) => choice[i] ?? post.items[i].url;
  const sizeTag = (i: number) => {
    if (!choice[i] || choice[i] === post.items[i].url) return "";
    const v = optionsFor(i).find((o) => o.url === choice[i]);
    return v?.width && v.height ? `_${v.width}x${v.height}` : v?.height ? `_${v.height}p` : "";
  };
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ext = (b: Blob, item: MediaItem) => b.type.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov") ?? (item.kind === "VIDEO" ? "mp4" : "jpg");
  const name = (i: number, b: Blob) => postFilename({ platform: post.platform, author: post.author, id: post.id, takenAt: post.takenAt, index: i, total: post.items.length, ext: ext(b, post.items[i]) }).replace(/(\.[^.]+)$/, `${sizeTag(i)}$1`);
  const set = (i: number, s: ItemState) => setStates((prev) => ({ ...prev, [i]: s }));

  async function get(i: number): Promise<Blob> {
    const key = `${i}|${urlFor(i)}`;
    const cached = blobs.get(key);
    if (cached) return cached;
    set(i, { status: "busy", stage: "Downloading" });
    try {
      const r = await downloadItem(post.items[i], (stage, p) => set(i, { status: "busy", stage, progress: p }), urlFor(i));
      blobs.set(key, r.blob);
      set(i, { status: "done", note: r.note });
      return r.blob;
    } catch (e) {
      set(i, { status: "error", error: e instanceof UserError ? e.message : "Download failed. Try again." });
      throw e;
    }
  }

  async function downloadOne(i: number) {
    try {
      const b = await get(i);
      saveBlob(b, name(i, b));
    } catch {
      /* shown on the item */
    }
  }

  async function downloadAll() {
    setError(null);
    setZipping(true);
    try {
      const files: Array<{ name: string; blob: Blob }> = [];
      for (let i = 0; i < post.items.length; i++) {
        try {
          const b = await get(i);
          files.push({ name: name(i, b), blob: b });
        } catch {
          /* skip failed items */
        }
      }
      if (!files.length) throw new UserError("None of the files could be downloaded.");
      await zipAndSave(files, `${post.platform}_${post.author ? `${post.author}_` : ""}${post.id}.zip`);
    } catch (e) {
      setError(e instanceof UserError ? e.message : "Couldn't create the ZIP.");
    } finally {
      setZipping(false);
    }
  }

  const confirm = (v: boolean) => {
    setAttested(v);
    if (v) sessionStorage.setItem(ATTEST_KEY, "1");
    else sessionStorage.removeItem(ATTEST_KEY);
  };

  const label = (o: Variant) => (o.width && o.height ? `${o.width}×${o.height}` : o.height ? `${o.height}p` : "Original");
  const quality = (i: number) => {
    const it = post.items[i];
    const opts = optionsFor(i);
    if (opts.length > 1) {
      return (
        <div className="px-2 pt-2">
          <select aria-label="Quality" className="input h-8 py-0 text-xs" value={urlFor(i)} onChange={(e) => setChoice((c) => ({ ...c, [i]: e.target.value }))}>
            {opts.map((o, k) => (
              <option key={o.url} value={o.url}>{label(o)}{k === 0 ? " · HD (best)" : ""}</option>
            ))}
          </select>
        </div>
      );
    }
    if (it.dashUrl && !extra[i]) {
      return (
        <div className="px-2 pt-2">
          <button
            className="text-xs text-muted underline-offset-4 hover:underline"
            onClick={async () => {
              const v = await redditVideoVariants(it.dashUrl!).catch(() => []);
              setExtra((x) => ({ ...x, [i]: v.length ? v : [{ url: it.url, height: it.height }] }));
              if (v.length) setChoice((c) => ({ ...c, [i]: v[0].url }));
            }}
          >
            Other qualities…
          </button>
        </div>
      );
    }
    return null;
  };

  const busy = zipping || Object.values(states).some((s) => s.status === "busy");
  const multi = post.items.length > 1;

  return (
    <div className="surface rounded-2xl p-5 animate-fade-up">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={post.platform === "reddit" ? "amber" : "violet"}>{post.platform === "reddit" ? "Reddit" : "Instagram"}</Badge>
        {post.author && <span className="text-sm font-medium">{post.platform === "reddit" ? `u/${post.author}` : `@${post.author}`}</span>}
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          {multi ? <IconLayers className="size-3.5" /> : post.items[0]?.kind === "VIDEO" ? <IconVideo className="size-3.5" /> : <IconImage className="size-3.5" />}
          {multi ? `${post.items.length} items` : post.items[0]?.kind === "VIDEO" ? "Video" : "Image"}
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
          <div className={cn("grid gap-3", multi ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-1 sm:max-w-md")}>
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
                  {quality(i)}
                  {multi && (
                    <div className="flex items-center justify-between gap-1 p-2">
                      <a href={it.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-[var(--surface-2)]" title="Open the original file">
                        <IconExternal className="size-3.5" /> Open
                      </a>
                      <button disabled={!attested || s.status === "busy"} onClick={() => downloadOne(i)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition hover:bg-[var(--surface-2)] disabled:opacity-40">
                        {s.status === "done" ? <IconCheck className="size-4 text-emerald-500" /> : <IconDownload className="size-4" />} Download
                      </button>
                    </div>
                  )}
                  {s.status === "error" && <p className="px-2.5 py-2 text-xs text-red-600 dark:text-red-400">{s.error}</p>}
                  {s.note && <p className="px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400">{s.note}</p>}
                </div>
              );
            })}
          </div>

          <label className="mt-5 flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent-500)]" checked={attested} onChange={(e) => confirm(e.target.checked)} />
            <span>I own this media or have the owner’s permission to keep a copy.</span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {multi ? (
              <Button variant="primary" size="lg" disabled={!attested || busy} loading={zipping} onClick={downloadAll}>
                {!zipping && <IconDownload className="size-5" />} Download all ({post.items.length}) as ZIP
              </Button>
            ) : (
              <Button variant="primary" size="lg" disabled={!attested || busy} loading={states[0]?.status === "busy"} onClick={() => downloadOne(0)}>
                {states[0]?.status !== "busy" && (states[0]?.status === "done" ? <IconCheck className="size-5" /> : <IconDownload className="size-5" />)}
                {states[0]?.status === "done" ? "Download again" : `Download ${post.items[0].kind === "VIDEO" ? "video" : "image"}`}
              </Button>
            )}
            {!multi && (
              <a href={post.items[0].url} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center gap-1.5 rounded-xl px-4 text-sm text-muted hover:bg-[var(--surface-2)]" title="Open the original file (long-press or right-click to save)">
                <IconExternal className="size-4" /> Open file
              </a>
            )}
            {onReset && (
              <Button size="lg" variant="ghost" className="ml-auto" onClick={onReset}>
                {resetLabel}
              </Button>
            )}
          </div>
          {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
        </>
      )}
      {post.items.length === 0 && onReset && (
        <div className="mt-4"><Button onClick={onReset}>{resetLabel}</Button></div>
      )}
    </div>
  );
}
