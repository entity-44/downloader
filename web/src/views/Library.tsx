import { useEffect, useState } from "react";
import { IconArchive, IconImage, IconLayers } from "../components/icons";
import { Badge, Button, EmptyState, Notice, PageHeader } from "../components/ui";
import { getThumb, listCollections, requestPersistence, storageInfo, type Collection } from "../lib/db";
import { formatBytes } from "../lib/files";

const SOURCE_LABEL: Record<string, [string, "violet" | "amber" | "blue" | "green" | "neutral"]> = {
  instagram: ["Instagram", "violet"],
  "instagram-api": ["Instagram API", "violet"],
  reddit: ["Reddit", "amber"],
  export: ["Data export", "blue"],
  upload: ["Your files", "green"],
};

function Cover({ id }: { id?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let u: string | null = null;
    getThumb(id).then((b) => b && setUrl((u = URL.createObjectURL(b))));
    return () => void (u && URL.revokeObjectURL(u));
  }, [id]);
  return url ? <img src={url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-muted"><IconImage className="size-7" /></div>;
}

export function Library() {
  const [items, setItems] = useState<Collection[] | null>(null);
  const [info, setInfo] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);

  useEffect(() => {
    listCollections().then(setItems).catch(() => setItems([]));
    storageInfo().then(setInfo);
  }, []);

  return (
    <div>
      <PageHeader title="Your library" description="Saved posts, imports and files, stored only in this browser on this device." />
      {info && !info.persisted && (items?.length ?? 0) > 0 && (
        <div className="mb-6">
          <Notice tone="warn" title="Protect your library" action={<Button size="sm" onClick={async () => { await requestPersistence(); setInfo(await storageInfo()); }}>Keep data permanently</Button>}>
            Browsers can clear website data when space runs low. Ask the browser to keep it.
          </Notice>
        </div>
      )}
      {items === null ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-[var(--surface-2)]" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<IconArchive className="size-8" />} title="Nothing saved yet">Save a post from the Download page, or import your Instagram data.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((c) => {
            const [label, tone] = SOURCE_LABEL[c.source] ?? [c.source, "neutral"];
            return (
              <a key={c.id} href={`#/collection/${c.id}`} className="surface group overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.05] animate-fade-up">
                <div className="relative aspect-square bg-[var(--surface-2)]">
                  <Cover id={c.coverId} />
                  {c.count > 1 && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white"><IconLayers className="size-3" />{c.count}</span>}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted"><Badge tone={tone}>{label}</Badge>{formatBytes(c.sizeBytes)}</div>
                </div>
              </a>
            );
          })}
        </div>
      )}
      {info && info.quota > 0 && <p className="mt-8 text-center text-xs text-muted">Using {formatBytes(info.usage)} of about {formatBytes(info.quota)} available to this site{info.persisted ? " · stored permanently" : ""}.</p>}
    </div>
  );
}
