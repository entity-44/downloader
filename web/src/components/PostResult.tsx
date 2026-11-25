import { useEffect, useState } from "react";
import { downloadItem, fetchFile } from "../lib/fetchmedia";
import { videoThumb } from "../lib/thumbs";
import { formatDuration, postFilename, saveBlob } from "../lib/files";
import { redditVideoVariants } from "../lib/reddit";
import { UserError, type MediaItem, type Post, type Variant } from "../lib/types";
import { zipAndSave } from "../lib/zipexport";
import { IconCheck, IconDownload, IconExternal, IconImage, IconLayers, IconVideo } from "./icons";
import { Badge, Button, Notice, Spinner, cn } from "./ui";

type ItemState = { status: "idle" | "busy" | "done" | "error"; stage?: string; progress?: number; error?: string; note?: string };

const ATTEST_KEY = "attested_session";
const PLATFORM_NAME: Record<Post["platform"], string> = { instagram: "Instagram", reddit: "Reddit", x: "X", redgifs: "RedGIFs" };

/** Phones that can hand files to the share sheet (iPhone: "Save Image/Video" → Photos). */
const phone = typeof navigator !== "undefined" && typeof navigator.canShare === "function" && /iPhone|iPad|Android/i.test(navigator.userAgent);

async function shareFiles(files: Array<{ name: string; blob: Blob }>) {
  const asFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || "application/octet-stream" }));
  try {
    if (navigator.canShare({ files: asFiles })) {
      await navigator.share({ files: asFiles });
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return; // user closed the share sheet
  }
  for (const f of files) saveBlob(f.blob, f.name);
}

/**
 * One-time result: preview, download (single file or ZIP), then start over.
 * Downloaded files are held only until the page is left or reset.
 */
export function PostResult({ post, onReset, resetLabel = "Start over" }: { post: Post; onReset?: () => void; resetLabel?: string }) {
  const [attested, setAttested] = useState(() => sessionStorage.getItem(ATTEST_KEY) === "1");
  const [states, setStates] = useState<Record<number, ItemState>>({});
  const [blobs] = useState(() => new Map<string, Blob>());
  // Extra sizes loaded on demand (Reddit resolutions).
  const [extra, setExtra] = useState<Record<number, Variant[]>>({});
  const optionsFor = (i: number): Variant[] => post.items[i].variants ?? extra[i] ?? [];
  const sizeTag = (i: number, url: string) => {
    if (url === post.items[i].url) return "";
    const v = optionsFor(i).find((o) => o.url === url);
    return v?.width && v.height ? `_${v.width}x${v.height}` : v?.height ? `_${v.height}p` : "";
  };
  // Reddit: load every resolution as soon as the post is shown.
  useEffect(() => {
    post.items.forEach((it, i) => {
      if (it.dashUrl && !it.variants) {
        redditVideoVariants(it.dashUrl)
          .then((v) => v.length > 1 && setExtra((x) => ({ ...x, [i]: v })))
          .catch(() => {});
      }
    });
  }, [post]);
  const [zipping, setZipping] = useState(false);
  const [readyFiles, setReadyFiles] = useState<Array<{ name: string; blob: Blob }> | null>(null);
  const zipName = `keepsake_${post.platform}_${post.author ? `${post.author}_` : ""}${post.id}.zip`;
  const [error, setError] = useState<string | null>(null);

  const ext = (b: Blob, item: MediaItem) => b.type.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov") ?? (item.kind === "VIDEO" ? "mp4" : "jpg");
  const name = (i: number, b: Blob, url: string = post.items[i].url) => postFilename({ platform: post.platform, author: post.author, id: post.id, takenAt: post.takenAt, index: i, total: post.items.length, ext: ext(b, post.items[i]) }).replace(/(\.[^.]+)$/, `${sizeTag(i, url)}$1`);
  const set = (i: number, s: ItemState) => setStates((prev) => ({ ...prev, [i]: s }));

  async function get(i: number, url: string = post.items[i].url): Promise<Blob> {
    const key = `${i}|${url}`;
    const cached = blobs.get(key);
    if (cached) return cached;
    set(i, { status: "busy", stage: "Downloading" });
    try {
      const audio = optionsFor(i).find((o) => o.url === url)?.audioUrl;
      const r = await downloadItem(post.items[i], (stage, p) => set(i, { status: "busy", stage, progress: p }), url, audio);
      blobs.set(key, r.blob);
      set(i, { status: "done", note: r.note });
      return r.blob;
    } catch (e) {
      set(i, { status: "error", error: e instanceof UserError ? e.message : "Download failed. Try again." });
      throw e;
    }
  }

  async function downloadOne(i: number, url: string = post.items[i].url) {
    try {
      const b = await get(i, url);
      // Phones: the share sheet ("Save Image/Video" → Photos) needs a fresh tap,
      // so prepare the file here and show Save buttons for the next tap.
      if (phone) setReadyFiles([{ name: name(i, b, url), blob: b }]);
      else saveBlob(b, name(i, b, url));
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
      if (phone) setReadyFiles(files);
      else await zipAndSave(files, zipName);
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
    const opts = optionsFor(i);
    if (opts.length < 2) return null;
    const busyItem = states[i]?.status === "busy";
    return (
      <div className="space-y-1.5 p-2">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted">Download quality</p>
        {opts.map((o, k) => (
          <button
            key={o.url}
            disabled={!attested || busyItem}
            onClick={() => downloadOne(i, o.url)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition disabled:opacity-40",
              k === 0 ? "brand-gradient text-white" : "border border-default hover:bg-[var(--surface-2)]",
            )}
          >
            <span>{label(o)}{k === 0 ? " · HD" : ""}</span>
            <IconDownload className="size-4 shrink-0" />
          </button>
        ))}
      </div>
    );
  };

  const busy = zipping || Object.values(states).some((s) => s.status === "busy");
  const multi = post.items.length > 1;

  return (
    <div className="surface rounded-2xl p-5 animate-fade-up">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={post.platform === "reddit" ? "amber" : post.platform === "x" ? "neutral" : post.platform === "redgifs" ? "red" : "violet"}>{PLATFORM_NAME[post.platform]}</Badge>
        {post.author && <span className="text-sm font-medium">{post.platform === "reddit" ? `u/${post.author}` : post.platform === "redgifs" ? post.author : `@${post.author}`}</span>}
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
          <div className={cn("grid gap-3", multi ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "mx-auto w-full grid-cols-1 sm:max-w-md")}>
            {post.items.map((it, i) => {
              const s = states[i] ?? { status: "idle" };
              return (
                <div key={i} className="overflow-hidden rounded-xl border border-default bg-[var(--surface)]">
                  <div className={cn("relative grid place-items-center bg-[var(--surface-2)]", multi ? "aspect-square" : "min-h-48")}>
                    <Preview item={it} multi={multi} />
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
                {!zipping && <IconDownload className="size-5" />} {phone ? `Download all (${post.items.length})` : `Download all (${post.items.length}) as ZIP`}
              </Button>
            ) : (
              <Button variant="primary" size="lg" disabled={!attested || busy} loading={states[0]?.status === "busy"} onClick={() => downloadOne(0, optionsFor(0)[0]?.url ?? post.items[0].url)}>
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
          {phone && readyFiles && (
            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 animate-fade-up">
              <p className="text-sm font-medium">{readyFiles.length === 1 ? "Ready to save" : `${readyFiles.length} files ready to save`}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => shareFiles(readyFiles)}>
                  <IconDownload className="size-4" /> Save to Photos
                </Button>
                <Button onClick={() => (readyFiles.length === 1 ? saveBlob(readyFiles[0].blob, readyFiles[0].name) : zipAndSave(readyFiles, zipName))}>
                  {readyFiles.length === 1 ? "Save to Files" : "Save as ZIP to Files"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted">“Save to Photos” opens the share sheet. Choose “Save Image” or “Save Video”.</p>
            </div>
          )}
          {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
        </>
      )}
      {post.items.length === 0 && onReset && (
        <div className="mt-4"><Button onClick={onReset}>{resetLabel}</Button></div>
      )}
    </div>
  );
}

/**
 * Shows the whole image (or a video's first frame). If the media server won't
 * display it on this site, fetches it through the relay and shows it from memory.
 */
function Preview({ item, multi }: { item: MediaItem; multi: boolean }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<"direct" | "fallback" | "failed">("direct");
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);
  const cls = multi ? "size-full object-contain" : "h-auto max-h-[75vh] w-full object-contain";
  const style = !multi && item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined;
  const imageUrl = item.thumbUrl ?? (item.kind === "IMAGE" ? item.url : undefined);
  const onError = async () => {
    if (stage !== "direct") return setStage("failed");
    setStage("fallback");
    try {
      setBlobUrl(URL.createObjectURL(await fetchFile(imageUrl ?? item.url)));
    } catch {
      setStage("failed");
    }
  };
  if (stage === "failed") {
    return <div className="grid size-full min-h-48 place-items-center text-muted">{item.kind === "VIDEO" ? <IconVideo className="size-8" /> : <IconImage className="size-8" />}</div>;
  }
  if (imageUrl) return <img src={blobUrl ?? imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className={cls} style={style} onError={onError} />;
  return <VideoPreview item={item} className={cls} style={style} />;
}

/**
 * Video without a thumbnail. iPhone Safari doesn't draw a video's first frame
 * until it plays, so fetch the video (directly or via the relay), grab a frame
 * as the poster, and show a playable preview.
 */
function VideoPreview({ item, className, style }: { item: MediaItem; className: string; style?: React.CSSProperties }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    fetchFile(item.url)
      .then(async (blob) => {
        if (!live) return;
        const v = URL.createObjectURL(blob);
        urls.push(v);
        setVideoUrl(v);
        const { thumb } = await videoThumb(blob);
        if (thumb && live) {
          const p = URL.createObjectURL(thumb);
          urls.push(p);
          setPoster(p);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [item.url]);
  if (failed) return <div className="grid size-full min-h-48 place-items-center text-muted"><IconVideo className="size-8" /></div>;
  if (!videoUrl) return <div className="grid size-full min-h-48 place-items-center text-muted"><Spinner /></div>;
  return <video src={videoUrl} poster={poster ?? undefined} controls muted playsInline preload="metadata" className={className} style={style} />;
}
