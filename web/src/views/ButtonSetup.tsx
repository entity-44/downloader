import { useMemo, useState } from "react";
import { IconCheck, IconClipboard, IconLink } from "../components/icons";
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, cn } from "../components/ui";
import { bookmarkletHref } from "../lib/bookmarklet";

const TABS = ["Computer", "iPhone / iPad", "Android"] as const;

export function ButtonSetup() {
  const appUrl = `${location.origin}${import.meta.env.BASE_URL}`;
  const href = useMemo(() => bookmarkletHref(appUrl), [appUrl]);
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => (/iPhone|iPad/.test(navigator.userAgent) ? "iPhone / iPad" : /Android/.test(navigator.userAgent) ? "Android" : "Computer"));
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="One-click button" description="A bookmark that saves the Instagram or Reddit post you’re looking at. It reads only that post, using what your browser can already see, and sends it straight to this page." />

      <Card>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <a
            href={href}
            onClick={(e) => e.preventDefault()}
            draggable
            className="brand-gradient inline-flex h-12 cursor-grab items-center gap-2 rounded-2xl px-6 font-semibold text-white shadow-lg shadow-rose-500/25 active:cursor-grabbing"
            title="Drag me to your bookmarks bar"
          >
            <IconLink className="size-5" /> Save to Keepsake
          </a>
          <p className="max-w-md text-sm text-muted">On a computer, <span className="font-medium text-[var(--text)]">drag this button to your bookmarks bar</span>. On a phone, follow the steps below.</p>
          <Button size="sm" onClick={copy}>{copied ? <IconCheck className="size-4 text-emerald-500" /> : <IconClipboard className="size-4" />} {copied ? "Copied" : "Copy button code"}</Button>
        </div>
      </Card>

      <Card>
        <div className="mb-5 inline-flex rounded-xl border border-default p-0.5">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded-lg px-3 py-1.5 text-sm transition", tab === t ? "bg-[var(--surface-2)] font-medium" : "text-muted")}>{t}</button>
          ))}
        </div>
        {tab === "Computer" && (
          <Steps steps={[
            "Show your bookmarks bar (Chrome/Edge: ⌘/Ctrl + Shift + B · Safari: View → Show Favorites Bar · Firefox: View → Toolbars).",
            "Drag the “Save to Keepsake” button above onto the bar.",
            "Open any Instagram post, reel or story (or a Reddit post) and click the bookmark.",
            "This page opens with the post ready to save. Allow pop-ups for instagram.com / reddit.com if asked.",
          ]} />
        )}
        {tab === "iPhone / iPad" && (
          <Steps steps={[
            "Tap “Copy button code” above.",
            "In Safari, bookmark any page: tap Share → Add Bookmark → Save.",
            "Open Bookmarks, tap Edit, select the new bookmark, rename it “Save to Keepsake”, and replace its address with the copied code. Tap Done.",
            "Open a post on instagram.com or reddit.com in Safari (not the apps). Tap the address bar, type “Save to Keepsake” and tap the bookmark when it appears, or open it from Bookmarks.",
            "Tip: in the Instagram or Reddit app, use Share → Copy link, then open the link in Safari first.",
          ]} />
        )}
        {tab === "Android" && (
          <Steps steps={[
            "Tap “Copy button code” above.",
            "In Chrome, bookmark this page (⋮ → ☆), then tap Edit on the bookmark.",
            "Rename it “Save to Keepsake” and paste the copied code into the URL field. Save.",
            "Open a post on instagram.com or reddit.com in Chrome, tap the address bar, type “Save to Keepsake” and tap the bookmark suggestion.",
            "Chrome only runs bookmarks typed in the address bar, not opened from the bookmarks list.",
          ]} />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Good to know" />
          <ul className="space-y-2 text-sm text-muted">
            <li>• You need to be able to see the post yourself (signed in, if it’s private and you follow it).</li>
            <li>• Keep the original tab open until downloads finish. Instagram files are sometimes fetched through it.</li>
            <li>• It reads only the single post you’re on. It never browses, scrolls or collects anything else.</li>
            <li>• If Instagram changes its site and the button stops working, this page is updated, so there’s nothing to reinstall.</li>
          </ul>
        </Card>
        <Card>
          <SectionTitle title="Backup: paste the data" action={<Badge>Manual</Badge>} />
          <p className="text-sm text-muted">If the button can’t be used, you can paste the post’s data on the Download page instead:</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>• <span className="font-medium text-[var(--text)]">Reddit:</span> add <code className="rounded bg-[var(--surface-2)] px-1 font-mono text-xs">.json</code> to the end of the post address, open it, select all and copy.</li>
            <li>• <span className="font-medium text-[var(--text)]">Instagram (computer):</span> open the post, view the page source (⌘/Ctrl + U), select all and copy.</li>
          </ul>
        </Card>
      </div>
      <Notice tone="info">Only save media you own or have permission to keep.</Notice>
    </div>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-3 text-sm">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-semibold">{i + 1}</span>
          <span className="text-muted">{s}</span>
        </li>
      ))}
    </ol>
  );
}
