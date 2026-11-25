import { useEffect, useState } from "react";
import { IconClipboard } from "../components/icons";
import { PostResult } from "../components/PostResult";
import { Button, Notice } from "../components/ui";
import { CODE_VERSION } from "../lib/bookmarklet";
import { asCollected, fromPasteLink, parseCollected } from "../lib/incoming";
import { UserError, type Post } from "../lib/types";

/**
 * Opened by the iOS Shortcut. Current Shortcut code opens this page with the
 * post data in the link (#/paste/<data>); older setups copy it to the clipboard.
 */
export function PasteView({ data }: { data?: string }) {
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [manual, setManual] = useState("");

  const load = (text: string) => {
    setError(null);
    let json: unknown;
    const peek = text.trim() ? ` The clipboard had ${text.length} characters, starting with: “${text.trim().slice(0, 80)}”` : " The clipboard was empty.";
    json = fromPasteLink(text);
    if (json === undefined) {
      try {
        json = JSON.parse(text.trim());
      } catch {
        return setError("The clipboard doesn't contain post data from the Keepsake Shortcut." + peek);
      }
    }
    const c = asCollected(json);
    if (!c) return setError("The clipboard doesn't contain post data from the Keepsake Shortcut.");
    try {
      setOutdated((c.v ?? 0) < CODE_VERSION);
      setPost(parseCollected(c));
    } catch (e) {
      setError(e instanceof UserError ? e.message : "Couldn't read that post.");
    }
  };

  // Data arrived inside the link: load it right away, then tidy the address bar.
  useEffect(() => {
    if (!data) return;
    load("#/paste/" + data);
    history.replaceState(null, "", location.pathname + "#/paste");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const fromClipboard = async () => {
    try {
      load(await navigator.clipboard.readText());
    } catch {
      setError("Your browser didn't allow reading the clipboard. Tap and hold in the box below and choose Paste.");
    }
  };

  if (post)
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {outdated && (
          <Notice tone="warn" title="Your Shortcut code is out of date">
            It may grab the wrong media. On the <a href="#/button" className="underline underline-offset-4">Button page</a>, copy the new Shortcut code, clear the old code completely, and paste it in.
          </Notice>
        )}
        <PostResult post={post} onReset={() => { setPost(null); setManual(""); }} />
      </div>
    );

  return (
    <div className="mx-auto max-w-xl space-y-6 pt-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
      <p className="text-muted">The Keepsake Shortcut copied the post. Tap below to load it.</p>
      <Button variant="primary" size="lg" className="w-full" onClick={fromClipboard}>
        <IconClipboard className="size-5" /> Paste from Keepsake
      </Button>
      {outdated && (
        <Notice tone="warn" title="Your Shortcut code is out of date">
          It may grab the wrong media. On the <a href="#/button" className="underline underline-offset-4">Button page</a>, copy the new code, clear the old code completely, and paste it in.
        </Notice>
      )}
      {error && <div className="text-left"><Notice tone="error">{error}</Notice></div>}
      <details className="text-left text-sm text-muted">
        <summary className="cursor-pointer">Paste manually instead</summary>
        <textarea className="input mt-3 h-24 font-mono text-xs" placeholder="Tap and hold → Paste" value={manual} onChange={(e) => setManual(e.target.value)} />
        <Button className="mt-2" disabled={!manual.trim()} onClick={() => load(manual)}>Load</Button>
      </details>
    </div>
  );
}
