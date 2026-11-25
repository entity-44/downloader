import { useMemo, useState } from "react";
import { IconCheck, IconClipboard, IconLink } from "../components/icons";
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, cn } from "../components/ui";
import { bookmarkletHref, shortcutSource } from "../lib/bookmarklet";

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
          <p className="max-w-md text-xs text-muted">Already installed an older button? Replace it with this one to get highlights and profile pictures.</p>
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
            "Open any Instagram post, reel, story, highlight or profile (or a Reddit post) and click the bookmark.",
            "This page opens with the post ready to save. Allow pop-ups for instagram.com / reddit.com if asked.",
          ]} />
        )}
        {tab === "iPhone / iPad" && <IosShortcut appUrl={appUrl} />}
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
            <li>• It reads only what you’re looking at: one post, one story or highlight (all its items), or a profile picture. It never browses, scrolls or collects anything else.</li>
            <li>• On a profile, it saves the full-size profile picture. On /stories/name/ without a specific story, it offers all of that person’s current stories.</li>
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

function IosShortcut({ appUrl }: { appUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const pasteUrl = `${appUrl}#/paste`;
  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  };
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium">Recommended on iPhone: a Share-menu Shortcut</p>
        <p className="mt-1 text-muted">Once set up: open the post, story or highlight in Safari → <span className="font-medium text-[var(--text)]">Share → Save with Keepsake</span> → tap “Paste from Keepsake”. It reads the page inside your signed-in Safari, like the button.</p>
      </div>
      <Steps steps={[
        "First, allow scripts: iPhone Settings → Apps → Shortcuts → Advanced → turn on “Allow Running Scripts”. Without this, iOS says “Cannot Run Script”.",
        "Open the Shortcuts app and tap + to create a new shortcut. Name it “Save with Keepsake”.",
        "Tap the ⓘ (or settings) button, turn on “Show in Share Sheet”, and under Share Sheet Types keep only “Safari web pages”.",
        "Add the action “Run JavaScript on Web Page”. Make sure it says “on Shortcut Input” (tap it to change if needed). Tap “Copy Shortcut code” below, then replace all the code in that action with it.",
        "Add the action “Copy to Clipboard” (it uses the JavaScript result).",
        "Add the action “Open URLs” and set the URL to the page address below (tap “Copy page address”).",
        "Use it: in Safari, open the post, story or highlight → Share → Save with Keepsake. The first time, allow it to run on instagram.com. Your site opens. Tap “Paste from Keepsake”.",
        "Always start it from Safari's Share menu while the post is open, not from the Shortcuts app or the Instagram app. Those give the same “Cannot Run Script” error.",
      ]} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => copy(shortcutSource(), "code")}>{copied === "code" ? <IconCheck className="size-4" /> : <IconClipboard className="size-4" />} {copied === "code" ? "Copied" : "Copy Shortcut code"}</Button>
        <Button onClick={() => copy(pasteUrl, "url")}>{copied === "url" ? <IconCheck className="size-4 text-emerald-500" /> : <IconLink className="size-4" />} {copied === "url" ? "Copied" : "Copy page address"}</Button>
      </div>
      <p className="break-all font-mono text-xs text-muted">{pasteUrl}</p>
      <details className="text-sm text-muted">
        <summary className="cursor-pointer">Or use a bookmark (no Shortcuts app needed)</summary>
        <div className="mt-3">
          <Steps steps={[
            "Tap “Copy button code” at the top of this page.",
            "In Safari, bookmark any page: Share → Add Bookmark → Save.",
            "Open Bookmarks → Edit, select the new bookmark, rename it “Save to Keepsake”, and replace its address with the copied code.",
            "On a post in Safari, tap the Bookmarks button (open-book icon) and tap “Save to Keepsake” in the list. Don't run it from the address bar: Safari blocks that with “Cannot Run Script”.",
          ]} />
        </div>
      </details>
      <p className="text-xs text-muted">Both work in Safari, not inside the Instagram app. From the app: Share → Copy link, then open the link in Safari.</p>
    </div>
  );
}
