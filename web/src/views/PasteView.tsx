import { useState } from "react";
import { IconClipboard } from "../components/icons";
import { PostResult } from "../components/PostResult";
import { Button, Notice } from "../components/ui";
import { asCollected, parseCollected } from "../lib/incoming";
import { UserError, type Post } from "../lib/types";

/** Opened by the iOS Shortcut, which copies the post's data to the clipboard first. */
export function PasteView() {
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const load = (text: string) => {
    setError(null);
    let json: unknown;
    try {
      json = JSON.parse(text.trim());
    } catch {
      return setError("The clipboard doesn't contain post data from the Keepsake Shortcut. Run the Shortcut from Safari's Share menu on the post, then come back.");
    }
    const c = asCollected(json);
    if (!c) return setError("The clipboard doesn't contain post data from the Keepsake Shortcut.");
    try {
      setPost(parseCollected(c));
    } catch (e) {
      setError(e instanceof UserError ? e.message : "Couldn't read that post.");
    }
  };

  const fromClipboard = async () => {
    try {
      load(await navigator.clipboard.readText());
    } catch {
      setError("Your browser didn't allow reading the clipboard. Tap and hold in the box below and choose Paste.");
    }
  };

  if (post) return <div className="mx-auto max-w-4xl"><PostResult post={post} onReset={() => { setPost(null); setManual(""); }} /></div>;

  return (
    <div className="mx-auto max-w-xl space-y-6 pt-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
      <p className="text-muted">The Keepsake Shortcut copied the post. Tap below to load it.</p>
      <Button variant="primary" size="lg" className="w-full" onClick={fromClipboard}>
        <IconClipboard className="size-5" /> Paste from Keepsake
      </Button>
      {error && <div className="text-left"><Notice tone="error">{error}</Notice></div>}
      <details className="text-left text-sm text-muted">
        <summary className="cursor-pointer">Paste manually instead</summary>
        <textarea className="input mt-3 h-24 font-mono text-xs" placeholder="Tap and hold → Paste" value={manual} onChange={(e) => setManual(e.target.value)} />
        <Button className="mt-2" disabled={!manual.trim()} onClick={() => load(manual)}>Load</Button>
      </details>
    </div>
  );
}
