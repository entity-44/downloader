import { useRef, useState } from "react";
import { IconArchive, IconClipboard, IconDownload, IconLink, IconChevronRight } from "../components/icons";
import { PostResult } from "../components/PostResult";
import { Badge, Button, Card, Notice, SectionTitle } from "../components/ui";
import { GuidedPaste } from "../components/GuidedPaste";
import type { IgLink } from "../lib/instagram";
import { NeedsButton, NeedsGuidedPaste, resolveInput } from "../lib/resolve";
import { UserError, type Post } from "../lib/types";

export function Home() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<{ message: string; needsButton?: boolean } | null>(null);
  const [guided, setGuided] = useState<IgLink | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setInput("");
    setPost(null);
    setError(null);
    setGuided(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    inputRef.current?.focus();
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    setPost(null);
    setGuided(null);
    try {
      setPost(await resolveInput(input));
    } catch (err) {
      if (err instanceof NeedsGuidedPaste) setGuided(err.link);
      else if (err instanceof NeedsButton) setError({ message: err.message, needsButton: true });
      else setError({ message: err instanceof UserError ? err.message : "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setInput(t.trim());
    } catch {
      /* permission denied */
    }
  }

  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-3xl pt-2 text-center sm:pt-8">
        <h1 className="animate-fade-up text-3xl font-semibold tracking-tight sm:text-5xl">
          Save Instagram & Reddit media.
          <span className="block bg-clip-text text-transparent brand-gradient">Privately, in your browser.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl animate-fade-up text-muted [animation-delay:60ms] sm:text-lg">
          Paste a link, download, done. Or tap the Keepsake button while viewing a post. Reddit videos come with sound. Nothing is stored or uploaded.
        </p>
        <form onSubmit={submit} className="surface mt-8 animate-fade-up rounded-2xl p-2 text-left shadow-xl shadow-black/[0.04] [animation-delay:120ms] sm:p-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative flex flex-1 items-center">
              <span className="sr-only">Post link or pasted data</span>
              <IconLink className="pointer-events-none absolute left-3.5 size-5 text-muted" />
              <input
                ref={inputRef}
                className="h-12 w-full rounded-xl bg-transparent pl-11 pr-24 text-base outline-none placeholder:text-[var(--muted)] sm:h-14"
                placeholder="Paste an Instagram or Reddit link…"
                autoComplete="off"
                spellCheck={false}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="button" onClick={paste} className="absolute right-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
                <IconClipboard className="size-4" /> Paste
              </button>
            </label>
            <Button type="submit" variant="primary" size="lg" className="h-12 sm:h-14 sm:px-8" loading={busy} disabled={!input.trim()}>
              {!busy && <IconDownload className="size-5" />} Download
            </Button>
          </div>
        </form>
      </section>

      {error && (
        <div className="mx-auto max-w-3xl">
          <Notice
            tone={error.needsButton ? "info" : "error"}
            title={error.needsButton ? "Use the one-click button for this link" : "Couldn't get that post"}
            action={error.needsButton ? <a href="#/button" className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium surface hover:bg-[var(--surface-2)]">Set up the button</a> : undefined}
          >
            {error.message}
          </Notice>
        </div>
      )}
      {guided && !post && (
        <div className="mx-auto max-w-3xl">
          <GuidedPaste key={guided.shortcode} link={guided} onPost={(p) => { setPost(p); setGuided(null); }} />
        </div>
      )}
      {post && <div className="mx-auto max-w-4xl"><PostResult key={post.url + post.id} post={post} onReset={reset} /></div>}

      <div className="grid gap-5 sm:grid-cols-2">
        <QuickLink href="#/button" icon={IconLink} title="One-click button" text="Add it once, then tap it on any Instagram or Reddit post to download it." badge="Recommended" />
        <QuickLink href="#/import" icon={IconArchive} title="Import your Instagram data" text="Browse your full export once and download what you want: posts, reels and stories." />
      </div>

      <Card>
        <SectionTitle title="What works" />
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            ["Instagram posts, reels, carousels, stories & highlights", "One-click button on instagram.com"],
            ["Full-size Instagram profile pictures", "Tap the button on a profile"],
            ["Reddit videos (with sound), images & galleries", "Paste a link or use the button"],
            ["v.redd.it video links", "Paste directly"],
            ["Your entire Instagram history", "Data export import"],
          ].map(([a, b]) => (
            <li key={a} className="flex items-start gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full brand-gradient" />
              <span><span className="font-medium">{a}</span><span className="block text-muted">{b}</span></span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function QuickLink({ href, icon: Icon, title, text, badge }: { href: string; icon: typeof IconLink; title: string; text: string; badge?: string }) {
  return (
    <a href={href} className="surface group flex gap-4 rounded-2xl p-5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.04]">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] transition group-hover:scale-105"><Icon className="size-5" /></span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 font-medium">{title} {badge && <Badge tone="green">{badge}</Badge>} <IconChevronRight className="size-4 text-muted transition group-hover:translate-x-0.5" /></span>
        <span className="mt-0.5 block text-sm text-muted">{text}</span>
      </span>
    </a>
  );
}
