import { useState } from "react";
import type { IgLink, StoryLink } from "../lib/instagram";
import { dataLinks, parsePastedInstagram } from "../lib/resolve";
import { UserError, type Post } from "../lib/types";
import { IconCheck, IconClipboard, IconDownload, IconExternal, IconLink } from "./icons";
import { Button, Notice } from "./ui";

const isPhone = () => /iPhone|iPad|Android/i.test(navigator.userAgent);

/**
 * Manual flow: the user's own signed-in browser loads the post's normal page
 * (viewed as source) and they paste it here. It's an ordinary page load, unlike
 * Instagram's "?__a=1" data address, which gets flagged as spam. No login is
 * ever entered on this site.
 */
export function GuidedPaste({ link, onPost }: { link: IgLink | StoryLink; onPost: (p: Post) => void }) {
  const isStory = link.kind === "story" || link.kind === "highlight";
  const what = link.kind === "highlight" ? "highlight" : isStory ? "story" : "post";
  const links = dataLinks(link);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phone = isPhone();
  const iphone = /iPhone|iPad/i.test(navigator.userAgent);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(links.pageSource);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* select manually */
    }
  };
  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t);
    } catch {
      /* permission denied */
    }
  };
  const go = () => {
    setError(null);
    try {
      onPost(parsePastedInstagram(text, link));
    } catch (e) {
      setError(e instanceof UserError ? e.message : "Couldn't read that text.");
    }
  };

  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <li className="flex gap-3">
      <span className="brand-gradient grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">{children}</div>
    </li>
  );

  return (
    <div className="surface space-y-5 rounded-2xl p-5 animate-fade-up">
      <div>
        <p className="font-medium">Instagram {what} links need one extra step</p>
        <p className="mt-0.5 text-sm text-muted">Instagram only shows {what}s to signed-in browsers, so your browser loads it and hands it over. You never enter your Instagram login here.</p>
      </div>

      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium">Fastest: the one-click button</p>
        <p className="mt-1 text-muted">Open it on Instagram and tap the Keepsake button. It reads what’s already on the page, so it sends no extra requests, and it also works for stories and highlights.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={links.post} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl surface px-3 text-sm font-medium hover:bg-[var(--surface-2)]"><IconExternal className="size-4" /> Open {what} on Instagram</a>
          <a href="#/button" className="inline-flex h-9 items-center rounded-xl px-3 text-sm text-muted underline-offset-4 hover:underline">Set up the button</a>
        </div>
      </div>

      {iphone ? (
        <p className="text-sm text-muted">iPhone and iPad browsers can’t show a page’s source, so the manual steps don’t work there. Use the button above.</p>
      ) : (
        <>
          <p className="text-sm font-medium">Or do it by hand{phone ? " (Chrome on Android)" : ""}:</p>
          {isStory && <p className="text-xs text-muted">Stories expire after 24 hours. If the page doesn't include the story's media, you'll see a message saying so; then use the button.</p>}
          <ol className="space-y-5">
            <Step n={1}>
              <p className="text-sm">Copy this address, open a <span className="font-medium">new tab</span>, paste it into the address bar and press Enter. You need to be signed in to instagram.com in this browser.</p>
              <div className="flex gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--surface-2)] px-3 py-2 font-mono text-xs">{links.pageSource}</code>
                <Button size="sm" onClick={copy}>{copied ? <IconCheck className="size-4 text-emerald-500" /> : <IconLink className="size-4" />} {copied ? "Copied" : "Copy"}</Button>
              </div>
            </Step>
            <Step n={2}>
              <p className="text-sm">On that page, select everything and copy it ({phone ? "long-press → Select all → Copy" : "⌘/Ctrl + A, then ⌘/Ctrl + C"}).</p>
            </Step>
            <Step n={3}>
              <p className="text-sm">Paste it here:</p>
              <textarea className="input h-28 resize-y font-mono text-xs" placeholder="Paste the copied page source…" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={pasteFromClipboard}><IconClipboard className="size-4" /> Paste</Button>
                <Button variant="primary" disabled={!text.trim()} onClick={go}><IconDownload className="size-4" /> Get media</Button>
              </div>
            </Step>
          </ol>
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
