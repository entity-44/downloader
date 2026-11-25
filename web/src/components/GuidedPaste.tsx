import { useState } from "react";
import type { IgLink, StoryLink } from "../lib/instagram";
import { dataLinks, parsePastedInstagram } from "../lib/resolve";
import { UserError, type Post } from "../lib/types";
import { IconCheck, IconClipboard, IconDownload, IconExternal, IconLink } from "./icons";
import { Button, Notice, cn } from "./ui";

type Method = "keepsake" | "datalink";
const METHOD_KEY = "ig_method";

/**
 * Instagram only shows posts to signed-in browsers, so the user's own browser
 * fetches the data and hands it over. Two ways, chosen with a toggle:
 *  - Keepsake method (default): one-click button / Shortcut, or the post's
 *    page source on a computer. Ordinary page loads.
 *  - Data link (Snapinsta-style): open Instagram's "?__a=1" data link, copy
 *    the text, paste it. Works the same everywhere, but Instagram sometimes
 *    answers it with {"spam":true}.
 * No login is ever entered on this site.
 */
export function GuidedPaste({ link, onPost }: { link: IgLink | StoryLink; onPost: (p: Post) => void }) {
  const isStory = link.kind === "story" || link.kind === "highlight";
  const what = link.kind === "highlight" ? "highlight" : isStory ? "story" : "post";
  const links = dataLinks(link);
  const [method, setMethodState] = useState<Method>(() => {
    try {
      return (localStorage.getItem(METHOD_KEY) as Method) || "keepsake";
    } catch {
      return "keepsake";
    }
  });
  const setMethod = (m: Method) => {
    setMethodState(m);
    try {
      localStorage.setItem(METHOD_KEY, m);
    } catch {
      /* private mode */
    }
  };
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
  const iphone = /iPhone|iPad/i.test(navigator.userAgent);
  const active: Method = isStory ? "keepsake" : method;

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
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

  const pasteStep = (n: number, placeholder: string) => (
    <Step n={n}>
      <p className="text-sm">Come back and paste it here:</p>
      <textarea className="input h-28 resize-y font-mono text-xs" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={pasteFromClipboard}><IconClipboard className="size-4" /> Paste</Button>
        <Button variant="primary" disabled={!text.trim()} onClick={go}><IconDownload className="size-4" /> Get media</Button>
      </div>
    </Step>
  );

  return (
    <div className="surface space-y-5 rounded-2xl p-5 animate-fade-up">
      <div>
        <p className="font-medium">Instagram {what} links need one extra step</p>
        <p className="mt-0.5 text-sm text-muted">Instagram only shows {what}s to signed-in browsers, so your browser loads it and hands it over. You never enter your Instagram login here.</p>
      </div>

      {!isStory && (
        <div role="tablist" aria-label="Method" className="grid grid-cols-2 gap-1 rounded-xl border border-default p-1">
          {([
            ["keepsake", "Keepsake method"],
            ["datalink", "Data link (Snapinsta-style)"],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={active === m}
              onClick={() => setMethod(m)}
              className={cn("rounded-lg px-3 py-2 text-sm font-medium transition", active === m ? "brand-gradient text-white" : "text-muted hover:bg-[var(--surface-2)]")}
            >
              {label}
              {m === "keepsake" && <span className={cn("ml-1.5 text-xs font-normal", active === m ? "text-white/80" : "text-muted")}>(default)</span>}
            </button>
          ))}
        </div>
      )}

      {active === "keepsake" ? (
        <>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <p className="font-medium">Fastest: the one-click button</p>
            <p className="mt-1 text-muted">Open it on Instagram and tap the Keepsake button (or the Share-menu Shortcut on iPhone). It reads what’s already on the page, so it sends no extra requests, and it also works for stories and highlights.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={links.post} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl surface px-3 text-sm font-medium hover:bg-[var(--surface-2)]"><IconExternal className="size-4" /> Open {what} on Instagram</a>
              <a href="#/button" className="inline-flex h-9 items-center rounded-xl px-3 text-sm text-muted underline-offset-4 hover:underline">Set up the button</a>
            </div>
          </div>
          {iphone ? (
            <p className="text-sm text-muted">
              iPhone Safari can’t show a page’s source, so the manual steps below aren’t available here. Use the button or Shortcut{!isStory && <>, or switch to <button className="underline underline-offset-4" onClick={() => setMethod("datalink")}>Data link</button></>}.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">Or do it by hand{phone ? " (Chrome on Android)" : ""}:</p>
              {isStory && <p className="text-xs text-muted">Stories expire after 24 hours. If the page doesn’t include the story’s media, you’ll see a message saying so; then use the button.</p>}
              <ol className="space-y-5">
                <Step n={1}>
                  <p className="text-sm">Copy this address, open a <span className="font-medium">new tab</span>, paste it into the address bar and press Enter (signed in to instagram.com).</p>
                  <div className="flex gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--surface-2)] px-3 py-2 font-mono text-xs">{links.pageSource}</code>
                    <Button size="sm" onClick={() => copy(links.pageSource, "src")}>{copied === "src" ? <IconCheck className="size-4 text-emerald-500" /> : <IconLink className="size-4" />} {copied === "src" ? "Copied" : "Copy"}</Button>
                  </div>
                </Step>
                <Step n={2}>
                  <p className="text-sm">Select everything on that page and copy it ({phone ? "long-press → Select all → Copy" : "⌘/Ctrl + A, then ⌘/Ctrl + C"}).</p>
                </Step>
                {pasteStep(3, "Paste the copied page source…")}
              </ol>
            </>
          )}
        </>
      ) : (
        <>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted">
            Works the same on iPhone and computer, like Snapinsta. Instagram sometimes answers this link with <code className="font-mono">{'{"spam":true}'}</code>. If that happens, don’t retry; wait a while or use the Keepsake method.
          </div>
          <ol className="space-y-5">
            <Step n={1}>
              <p className="text-sm">Make sure you’re signed in to instagram.com in this browser, then open the data link:</p>
              <div className="flex flex-wrap gap-2">
                <a href={links.data} target="_blank" rel="noopener noreferrer" className="brand-gradient inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium text-white"><IconExternal className="size-4" /> Open data link</a>
                <Button onClick={() => copy(links.data ?? "", "data")}>{copied === "data" ? <IconCheck className="size-4 text-emerald-500" /> : <IconLink className="size-4" />} {copied === "data" ? "Copied" : "Copy link"}</Button>
              </div>
            </Step>
            <Step n={2}>
              <p className="text-sm">The page shows text. Select all of it and copy ({phone ? "tap and hold the text → Select All → Copy" : "⌘/Ctrl + A, then ⌘/Ctrl + C"}).</p>
            </Step>
            {pasteStep(3, "Paste the copied text…")}
          </ol>
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
