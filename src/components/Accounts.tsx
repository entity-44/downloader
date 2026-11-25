"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionDTO, DownloadDTO } from "@/lib/serialize";
import { api, ApiRequestError } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";
import { errorTitle } from "./errorGuidance";
import { IconCheck, IconDownload, IconExternal, IconLayers, IconPlug, IconVideo } from "./icons";
import { Badge, Button, Card, ConfirmButton, Notice, PageHeader, SectionTitle, Spinner } from "./ui";

type Status = { configured: boolean; redirectUri: string; connections: ConnectionDTO[] };

const OAUTH_ERRORS: Record<string, string> = {
  denied: "You cancelled the Instagram authorization.",
  oauth: "Instagram didn’t complete the authorization. Please try again.",
  CSRF: "The authorization link expired or was already used. Please try again.",
  INSTAGRAM_NOT_CONFIGURED: "Instagram API credentials aren’t configured on this server.",
  UPSTREAM_ERROR: "Instagram returned an error while connecting. Please try again.",
  TOKEN_EXPIRED: "Instagram rejected the authorization. Please try again.",
};

export function Accounts({ connected, error }: { connected: string | null; error: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const load = useCallback(() => api<Status>("/api/instagram/status").then(setStatus).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { url } = await api<{ url: string }>("/api/instagram/connect", { method: "POST" });
      window.location.assign(url);
    } catch (e) {
      setConnectError(e instanceof ApiRequestError ? e.message : "Could not start the connection.");
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Account connections" description="Connect your own Instagram professional account through Meta’s official login. This app never asks for or stores your Instagram password." />
      {connected && <Notice tone="success" title={`Connected @${connected}`}>You can now paste links to this account’s posts and reels on the Download page.</Notice>}
      {error && <Notice tone="error" title="Connection failed">{OAUTH_ERRORS[error] ?? "Something went wrong while connecting."}</Notice>}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <SectionTitle
              title="Instagram"
              description="Instagram API with Instagram Login · Business and Creator accounts"
              action={status?.configured ? <Button variant="primary" onClick={connect} loading={connecting}><IconPlug className="size-4" /> Connect account</Button> : null}
            />
            {connectError && <div className="mb-4"><Notice tone="error">{connectError}</Notice></div>}
            {!status ? (
              <div className="h-16 animate-pulse rounded-xl bg-[var(--surface-2)]" />
            ) : !status.configured ? (
              <NotConfigured redirectUri={status.redirectUri} />
            ) : status.connections.length === 0 ? (
              <p className="text-sm text-muted">No accounts connected yet.</p>
            ) : (
              <ul className="space-y-4">
                {status.connections.map((c) => (
                  <ConnectionRow key={c.id} c={c} onRemoved={load} />
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="lg:col-span-2">
          <AccessMethods />
        </div>
      </div>
    </div>
  );
}

function NotConfigured({ redirectUri }: { redirectUri: string }) {
  return (
    <div className="space-y-4 text-sm">
      <Notice tone="warn" title="Meta app credentials required">
        The server administrator needs to create a Meta app with the Instagram API (Instagram Login) product and set credentials. Until then, use the{" "}
        <Link href="/import" className="underline underline-offset-4">archive importer</Link>.
      </Notice>
      <ol className="list-decimal space-y-1.5 pl-5 text-muted">
        <li>Create an app at developers.facebook.com and add the “Instagram” product (API setup with Instagram login).</li>
        <li>Add this OAuth redirect URI: <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--text)] break-all">{redirectUri}</code></li>
        <li>Set <code className="font-mono text-xs">INSTAGRAM_APP_ID</code> and <code className="font-mono text-xs">INSTAGRAM_APP_SECRET</code> in the server environment and restart.</li>
        <li>In development mode, add your account as an Instagram tester. Other users require Meta App Review.</li>
      </ol>
    </div>
  );
}

type MediaItem = { id: string; mediaType: string; productType: string | null; permalink: string | null; preview: string | null; caption: string | null; timestamp: string | null; itemCount: number };

function ConnectionRow({ c, onRemoved }: { c: ConnectionDTO; onRemoved: () => void }) {
  const [open, setOpen] = useState(false);
  const expiresSoon = c.tokenExpiresAt && new Date(c.tokenExpiresAt).getTime() - Date.now() < 7 * 86400_000;
  return (
    <li className="rounded-xl border border-default p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="brand-gradient grid size-10 place-items-center rounded-full text-sm font-semibold uppercase text-white">{c.username.slice(0, 1)}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">@{c.username}</p>
          <p className="text-xs text-muted">
            {c.accountType ? c.accountType.toLowerCase().replace("_", " ") : "professional"} · connected {formatDate(c.createdAt, false)}
            {c.tokenExpiresAt && ` · access until ${formatDate(c.tokenExpiresAt, false)}`}
          </p>
        </div>
        {expiresSoon ? <Badge tone="amber">Renewing soon</Badge> : <Badge tone="green"><IconCheck className="size-3" /> Active</Badge>}
        <Button size="sm" onClick={() => setOpen(!open)}>{open ? "Hide media" : "Browse media"}</Button>
        <ConfirmButton onConfirm={async () => { await api(`/api/instagram/connections/${c.id}`, { method: "DELETE" }); onRemoved(); }} confirmLabel="Disconnect">
          Disconnect
        </ConfirmButton>
      </div>
      {open && <MediaBrowser connectionId={c.id} />}
    </li>
  );
}

function MediaBrowser({ connectionId }: { connectionId: string }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState<Record<string, "busy" | "done" | "error">>({});

  const fetchPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      try {
        const r = await api<{ media: MediaItem[]; after: string | null }>(`/api/instagram/connections/${connectionId}/media${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`);
        setItems((prev) => (cursor ? [...prev, ...r.media] : r.media));
        setAfter(r.after);
      } catch (e) {
        setError(e instanceof ApiRequestError ? e.error : { code: "PROCESSING_FAILED", message: "Could not load media." });
      } finally {
        setLoading(false);
      }
    },
    [connectionId],
  );
  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  async function save(m: MediaItem) {
    if (!m.permalink) return;
    setSaving((s) => ({ ...s, [m.id]: "busy" }));
    try {
      const { download } = await api<{ download: DownloadDTO }>("/api/downloads", { method: "POST", body: { url: m.permalink } });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const { download: d } = await api<{ download: DownloadDTO }>(`/api/downloads/${download.id}`);
        if (d.status === "COMPLETED") return setSaving((s) => ({ ...s, [m.id]: "done" }));
        if (d.status === "FAILED") throw new Error(d.errorMessage ?? "failed");
      }
      throw new Error("timeout");
    } catch {
      setSaving((s) => ({ ...s, [m.id]: "error" }));
    }
  }

  return (
    <div className="mt-4 border-t border-default pt-4">
      {error && <Notice tone="error" title={errorTitle(error.code)}>{error.message}</Notice>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((m) => (
          <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--surface-2)]">
            {m.preview && (
              // Instagram CDN thumbnail of the user's own media (allowed by CSP img-src).
              <img src={m.preview} alt={m.caption ?? ""} loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
            )}
            <span className="pointer-events-none absolute left-1 top-1 flex gap-1">
              {m.mediaType === "CAROUSEL_ALBUM" && <span className="rounded bg-black/60 p-1 text-white"><IconLayers className="size-3" /></span>}
              {m.mediaType === "VIDEO" && <span className="rounded bg-black/60 p-1 text-white"><IconVideo className="size-3" /></span>}
            </span>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
              {m.permalink && (
                <a href={m.permalink} target="_blank" rel="noopener noreferrer" className="grid size-7 place-items-center rounded-md text-white hover:bg-white/20" aria-label="Open on Instagram"><IconExternal className="size-3.5" /></a>
              )}
              <button onClick={() => save(m)} disabled={!!saving[m.id]} className="inline-flex h-7 items-center gap-1 rounded-md bg-white/90 px-2 text-xs font-medium text-black disabled:opacity-80">
                {saving[m.id] === "busy" ? <Spinner className="size-3" /> : saving[m.id] === "done" ? <IconCheck className="size-3" /> : <IconDownload className="size-3" />}
                {saving[m.id] === "done" ? "Saved" : saving[m.id] === "error" ? "Failed" : "Save"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {loading && <div className="flex justify-center py-4"><Spinner /></div>}
      {!loading && items.length === 0 && !error && <p className="text-sm text-muted">This account has no media.</p>}
      {!loading && after && <div className="mt-3 flex justify-center"><Button size="sm" onClick={() => fetchPage(after)}>Load more</Button></div>}
      {Object.values(saving).includes("done") && <p className="mt-3 text-xs text-muted">Saved items are in your <Link href="/history" className="underline underline-offset-4">history</Link>.</p>}
    </div>
  );
}

function AccessMethods() {
  const rows = [
    { tone: "violet" as const, title: "Owned by a connected account", text: "Posts, reels, videos and carousels from Instagram Business/Creator accounts you’ve connected, via the official API." },
    { tone: "blue" as const, title: "Your data export", text: "Everything in your own Instagram export — works for personal and private accounts, and includes stories." },
    { tone: "amber" as const, title: "Provided by you", text: "Files you already have and are authorized to keep, e.g. sent to you by the owner." },
    { tone: "neutral" as const, title: "Public posts by others", text: "Visible on Instagram, but Meta offers no official API to download them. Ask the owner for the file." },
    { tone: "red" as const, title: "Private accounts you don’t own", text: "Not accessible. This app never bypasses login, privacy settings or anti-bot protections." },
  ];
  return (
    <Card>
      <SectionTitle title="How access works" />
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.title} className="text-sm">
            <Badge tone={r.tone}>{r.title}</Badge>
            <p className="mt-1.5 text-muted">{r.text}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
