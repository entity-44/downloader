import { useEffect, useState } from "react";
import { PostResult } from "../components/PostResult";
import { Notice, Spinner } from "../components/ui";
import { receivePost } from "../lib/bridge";
import { parseInstagramHtml, parseInstagramJson, parseInstagramProfile, parseInstagramReel } from "../lib/instagram";
import { parseRedditJson } from "../lib/reddit";
import { UserError, type Post } from "../lib/types";

/** Landing page opened by the bookmarklet. */
export function Receive() {
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    receivePost()
      .then((msg) => {
        if (cancelled) return;
        let p: Post;
        if (msg.platform === "reddit") p = parseRedditJson(msg.raw);
        else if (msg.kind === "reel") p = parseInstagramReel(msg.raw, msg.reelLabel ?? "stories", msg.url);
        else if (msg.kind === "profile") p = parseInstagramProfile(msg.raw, msg.username ?? "", msg.url);
        else if (msg.raw) p = parseInstagramJson(msg.raw, msg.url, msg.shortcode);
        else if (msg.html) p = parseInstagramHtml(msg.html, msg.shortcode);
        else throw new UserError("No post data was received.");
        setPost(p);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        if (e.message === "no-opener") setError("Open this page by tapping the Keepsake button on an Instagram or Reddit post.");
        else if (e.message === "timeout") setError("Didn't receive the post. Go back to the post tab and tap the button again.");
        else setError(e instanceof UserError ? e.message : "Couldn't read that post.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Save post</h1>
      {!post && !error && (
        <div className="flex items-center gap-3 text-muted"><Spinner /> Receiving post from the other tab…</div>
      )}
      {error && <Notice tone="error" title="Couldn't receive the post">{error}</Notice>}
      {post && (
        <>
          <PostResult post={post} resetLabel="Close tab" onReset={() => { window.close(); setTimeout(() => (location.hash = "#/"), 150); }} />
          <p className="text-xs text-muted">Keep the original tab open until downloads finish. Some files can only be fetched through it.</p>
        </>
      )}
    </div>
  );
}
