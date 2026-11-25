"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadDTO } from "@/lib/serialize";
import { api, ApiRequestError } from "@/lib/client/api";
import { errorActions, errorTitle } from "./errorGuidance";
import { IconClipboard, IconDownload, IconLink } from "./icons";
import { MediaResult } from "./MediaGrid";
import { Button, Notice, SourceBadge, Spinner, StatusBadge } from "./ui";

const URL_HINT = /instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,}/i;

export function DownloadBox({ onFinished }: { onFinished?: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [current, setCurrent] = useState<DownloadDTO | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const poll = useCallback(
    (id: string, delay = 800) => {
      timer.current = setTimeout(async () => {
        try {
          const { download } = await api<{ download: DownloadDTO }>(`/api/downloads/${id}`);
          setCurrent(download);
          if (download.status === "PENDING" || download.status === "PROCESSING") poll(id, Math.min(delay * 1.4, 4000));
          else {
            setBusy(false);
            onFinished?.();
          }
        } catch (e) {
          setBusy(false);
          setError(e instanceof ApiRequestError ? e.error : { code: "PROCESSING_FAILED", message: "Lost connection while processing." });
        }
      }, delay);
    },
    [onFinished],
  );

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url.trim() || busy) return;
    setError(null);
    setCurrent(null);
    setBusy(true);
    try {
      const { download } = await api<{ download: DownloadDTO }>("/api/downloads", { method: "POST", body: { url: url.trim() } });
      setCurrent(download);
      poll(download.id);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiRequestError ? err.error : { code: "PROCESSING_FAILED", message: "Something went wrong." });
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      /* clipboard permission denied: user can paste manually */
    }
  }

  const looksValid = !url || URL_HINT.test(url);

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="surface relative rounded-2xl p-2 shadow-xl shadow-black/[0.04] transition focus-within:shadow-rose-500/10 sm:p-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative flex flex-1 items-center">
            <span className="sr-only">Instagram post or reel URL</span>
            <IconLink className="pointer-events-none absolute left-3.5 size-5 text-muted" />
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste an Instagram post or reel link…"
              className="h-12 w-full rounded-xl bg-transparent pl-11 pr-24 text-base outline-none placeholder:text-[var(--muted)] sm:h-14"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2048}
            />
            <button type="button" onClick={paste} className="absolute right-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
              <IconClipboard className="size-4" /> Paste
            </button>
          </label>
          <Button type="submit" variant="primary" size="lg" className="h-12 sm:h-14 sm:px-8" loading={busy} disabled={!url.trim()}>
            {!busy && <IconDownload className="size-5" />}
            Download
          </Button>
        </div>
      </form>
      {!looksValid && !error && <p className="px-1 text-sm text-amber-600 dark:text-amber-400">That doesn’t look like a post or reel link (it should contain /p/ or /reel/).</p>}

      {error && (
        <Notice tone="error" title={errorTitle(error.code)} action={errorActions(error.code)}>
          {error.message}
        </Notice>
      )}

      {current && (
        <div className="surface rounded-2xl p-5 animate-fade-up">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={current.status} />
            {current.status === "COMPLETED" && <SourceBadge source={current.source} owner={current.ownerUsername} />}
            {current.mediaType && <span className="text-xs text-muted">{current.mediaType.toLowerCase()}</span>}
            <a href={current.sourceUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="ml-auto truncate text-xs text-muted hover:underline">
              {current.sourceUrl}
            </a>
          </div>
          {(current.status === "PENDING" || current.status === "PROCESSING") && (
            <div className="flex items-center gap-3 py-6 text-sm text-muted">
              <Spinner /> Checking your connected accounts and fetching media…
            </div>
          )}
          {current.status === "FAILED" && (
            <Notice tone="error" title={errorTitle(current.errorCode)} action={errorActions(current.errorCode)}>
              {current.errorMessage}
            </Notice>
          )}
          {current.status === "COMPLETED" && (
            <>
              {current.errorCode === "PARTIAL" && <div className="mb-4"><Notice tone="warn">{current.errorMessage}</Notice></div>}
              {current.caption && <p className="mb-4 line-clamp-3 text-sm text-muted">{current.caption}</p>}
              <MediaResult download={current} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
