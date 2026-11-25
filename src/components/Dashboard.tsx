"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DownloadDTO } from "@/lib/serialize";
import { api } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import { DownloadBox } from "./DownloadBox";
import { IconArchive, IconChevronRight, IconFilm, IconImage, IconLayers, IconSettings, IconShield, IconUser, IconVideo } from "./icons";
import { FilePreview } from "./MediaGrid";
import { Badge, Card, SectionTitle, StatusBadge } from "./ui";

const SUPPORT = [
  { icon: IconFilm, label: "Reels", how: "Your connected account", tone: "green" as const },
  { icon: IconImage, label: "Single-image posts", how: "Your connected account", tone: "green" as const },
  { icon: IconVideo, label: "Single-video posts", how: "Your connected account", tone: "green" as const },
  { icon: IconLayers, label: "Carousels (all items + ZIP)", how: "Your connected account", tone: "green" as const },
  { icon: IconArchive, label: "Stories, private & personal accounts", how: "Data export import", tone: "blue" as const },
  { icon: IconShield, label: "Other people’s posts", how: "Only files the owner gives you", tone: "amber" as const },
];

export function Dashboard({ connections, igConfigured, archiveCount, mediaCount }: { connections: string[]; igConfigured: boolean; archiveCount: number; mediaCount: number }) {
  const [recent, setRecent] = useState<DownloadDTO[] | null>(null);
  const load = useCallback(() => {
    api<{ downloads: DownloadDTO[] }>("/api/downloads?limit=6").then((r) => setRecent(r.downloads)).catch(() => setRecent([]));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-3xl pt-2 text-center sm:pt-8">
        <h1 className="animate-fade-up text-3xl font-semibold tracking-tight sm:text-5xl">
          Save your Instagram media.
          <span className="block bg-clip-text text-transparent brand-gradient">Privately, the authorized way.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl animate-fade-up text-muted [animation-delay:60ms] sm:text-lg">
          Paste a link to a reel, photo, video or carousel from an account you’ve connected. Everything stays on your own server.
        </p>
        <div className="mt-8 animate-fade-up text-left [animation-delay:120ms]">
          <DownloadBox onFinished={load} />
        </div>
        <p className="mt-3 animate-fade-in text-xs text-muted [animation-delay:200ms]">
          {connections.length ? (
            <>Resolving links against {connections.map((c) => `@${c}`).join(", ")}.</>
          ) : (
            <>
              No account connected yet —{" "}
              <Link href="/accounts" className="underline underline-offset-4">connect one</Link> or{" "}
              <Link href="/import" className="underline underline-offset-4">import your data export</Link>.
            </>
          )}
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            title="Recent downloads"
            action={
              <Link href="/history" className="inline-flex items-center text-sm text-muted hover:text-[var(--text)]">
                View all <IconChevronRight className="size-4" />
              </Link>
            }
          />
          {recent === null ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-[var(--surface-2)]" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nothing yet. Your downloads will appear here.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {recent.map((d) => (
                <Link key={d.id} href="/history" className="group relative block overflow-hidden rounded-xl border border-default" title={d.sourceUrl ?? undefined}>
                  {d.files[0] ? (
                    <div className="pointer-events-none">
                      <FilePreview file={d.files[0]} className="aspect-square w-full object-cover" />
                    </div>
                  ) : (
                    <div className="grid aspect-square place-items-center bg-[var(--surface-2)]">
                      <StatusBadge status={d.status} />
                    </div>
                  )}
                  <span className="absolute bottom-1 left-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">{relativeTime(d.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle title="Supported media" description="What can be saved, and how." />
          <ul className="space-y-3">
            {SUPPORT.map((s) => (
              <li key={s.label} className="flex items-start gap-3 text-sm">
                <s.icon className="mt-0.5 size-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{s.label}</p>
                  <Badge tone={s.tone} className="mt-1">{s.how}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <QuickLink href="/import" icon={IconArchive} title="Import Instagram archive" text={archiveCount ? `${archiveCount} import${archiveCount > 1 ? "s" : ""} · ${mediaCount} files in your library` : "Upload your data export ZIP to browse and save everything you’ve posted."} />
        <QuickLink
          href="/accounts"
          icon={IconUser}
          title="Account connections"
          text={!igConfigured ? "Instagram API isn’t configured on this server yet." : connections.length ? `Connected: ${connections.map((c) => `@${c}`).join(", ")}` : "Connect your Instagram professional account."}
        />
        <QuickLink href="/settings" icon={IconSettings} title="Settings" text="Theme, size limits, retention, sessions and security." />
      </div>
    </div>
  );
}

function QuickLink({ href, icon: Icon, title, text }: { href: string; icon: typeof IconArchive; title: string; text: string }) {
  return (
    <Link href={href} className="surface group flex gap-4 rounded-2xl p-5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.04]">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--text)] transition group-hover:scale-105">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-medium">
          {title} <IconChevronRight className="size-4 text-muted transition group-hover:translate-x-0.5" />
        </span>
        <span className="mt-0.5 block text-sm text-muted">{text}</span>
      </span>
    </Link>
  );
}
