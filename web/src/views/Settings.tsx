import { useEffect, useState } from "react";
import { IconExternal, IconMonitor, IconMoon, IconSun } from "../components/icons";
import { PostResult } from "../components/PostResult";
import { Badge, Button, Card, Notice, PageHeader, SectionTitle, cn } from "../components/ui";
import { appUrl, facebookLogout, facebookToken, graphMediaToPost, listIgAccounts, listIgMedia, startFacebookLogin, type GraphMedia, type IgAccount } from "../lib/facebook";
import { applyTheme, getTheme, setSetting, setting } from "../lib/router";
import { UserError, type Post } from "../lib/types";

export function Settings({ justConnected }: { justConnected: boolean }) {
  const [theme, setTheme] = useState(getTheme);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="These settings are remembered in this browser. No media is ever stored." />
      <Card>
        <SectionTitle title="Appearance" />
        <div className="grid max-w-md grid-cols-3 gap-2">
          {([["system", "System", IconMonitor], ["light", "Light", IconSun], ["dark", "Dark", IconMoon]] as const).map(([v, l, I]) => (
            <button key={v} onClick={() => { setTheme(v); applyTheme(v); }} className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition", theme === v ? "border-[var(--color-accent-500)] bg-rose-500/5 font-medium" : "border-default hover:bg-[var(--surface-2)]")}>
              <I className="size-5" /> {l}
            </button>
          ))}
        </div>
      </Card>

      <RedditSettings />
      <InstagramApi justConnected={justConnected} />
    </div>
  );
}

function RedditSettings() {
  const [id, setId] = useState(() => setting("reddit_client_id"));
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <SectionTitle title="Reddit links" description="Optional. Lets you paste Reddit post links directly. The one-click button and v.redd.it links work without this." />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input sm:max-w-sm" placeholder="Reddit client ID (installed app)" value={id} onChange={(e) => { setId(e.target.value.trim()); setSaved(false); }} spellCheck={false} />
        <Button onClick={() => { setSetting("reddit_client_id", id); sessionStorage.removeItem("reddit_token"); setSaved(true); }}>{saved ? "Saved" : "Save"}</Button>
      </div>
      <details className="mt-3 text-sm text-muted">
        <summary className="cursor-pointer">How to get a client ID</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Sign in to Reddit and open <a className="underline" href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener noreferrer">reddit.com/prefs/apps</a> → “create another app”.</li>
          <li>Choose <span className="font-medium text-[var(--text)]">installed app</span> (no secret). Redirect URI: <code className="font-mono text-xs break-all">{appUrl()}</code></li>
          <li>Copy the ID shown under the app name and paste it here. Reddit may require you to request API access first.</li>
        </ol>
      </details>
    </Card>
  );
}

function InstagramApi({ justConnected }: { justConnected: boolean }) {
  const [appId, setAppId] = useState(() => setting("meta_app_id"));
  const [connected, setConnected] = useState(() => !!facebookToken());
  const [accounts, setAccounts] = useState<IgAccount[] | null>(null);
  const [media, setMedia] = useState<{ account: IgAccount; items: GraphMedia[]; after?: string } | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    listIgAccounts().then(setAccounts).catch((e) => { setError(e instanceof UserError ? e.message : "Couldn't load accounts."); setConnected(!!facebookToken()); });
  }, [connected]);

  const loadMedia = async (account: IgAccount, after?: string) => {
    try {
      const r = await listIgMedia(account.id, after);
      setMedia((m) => ({ account, items: after && m ? [...m.items, ...r.data] : r.data, after: r.paging?.next ? r.paging.cursors?.after : undefined }));
    } catch (e) {
      setError(e instanceof UserError ? e.message : "Couldn't load media.");
    }
  };

  return (
    <Card>
      <SectionTitle title="Official Instagram API" description="Optional. Browse and save media from Instagram Business/Creator accounts linked to a Facebook Page, through Meta’s official login." action={connected ? <Badge tone="green">Connected</Badge> : undefined} />
      {justConnected && connected && <div className="mb-4"><Notice tone="success">Connected to Facebook.</Notice></div>}
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      {!connected ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className="input sm:max-w-sm" placeholder="Meta App ID" value={appId} onChange={(e) => setAppId(e.target.value.trim())} inputMode="numeric" />
            <Button variant="primary" disabled={!/^\d{5,20}$/.test(appId)} onClick={() => { setSetting("meta_app_id", appId); startFacebookLogin(appId); }}>Connect with Facebook</Button>
          </div>
          <details className="mt-3 text-sm text-muted">
            <summary className="cursor-pointer">Setup</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Create an app at <a className="underline" href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">developers.facebook.com</a> and add “Facebook Login for Business”.</li>
              <li>Add <code className="font-mono text-xs break-all">{appUrl()}</code> to Valid OAuth Redirect URIs and enable “Login with the JavaScript SDK / implicit flow”.</li>
              <li>Your Instagram account must be Business or Creator and linked to a Facebook Page you manage. Others need App Review.</li>
            </ol>
          </details>
        </>
      ) : (
        <div className="space-y-4">
          {accounts === null ? <p className="text-sm text-muted">Loading accounts…</p> : accounts.length === 0 ? (
            <Notice tone="warn">No Instagram professional accounts are linked to your Facebook Pages.</Notice>
          ) : (
            <div className="flex flex-wrap gap-2">
              {accounts.map((a) => <Button key={a.id} size="sm" variant={media?.account.id === a.id ? "primary" : "secondary"} onClick={() => loadMedia(a)}>@{a.username}</Button>)}
            </div>
          )}
          {media && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {media.items.map((m) => (
                <button key={m.id} onClick={() => setPost(graphMediaToPost(m, media.account.username))} className="aspect-square overflow-hidden rounded-lg bg-[var(--surface-2)]">
                  <img src={m.media_type === "VIDEO" ? m.thumbnail_url : (m.media_url ?? m.children?.data[0]?.media_url)} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {media?.after && <Button size="sm" onClick={() => loadMedia(media.account, media.after)}>Load more</Button>}
          {post && <PostResult key={post.id} post={post} onReset={() => setPost(null)} resetLabel="Close" />}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => { facebookLogout(); setConnected(false); setAccounts(null); setMedia(null); }}>Disconnect</Button>
            <a className="inline-flex items-center gap-1 text-xs text-muted underline-offset-4 hover:underline" href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener noreferrer">Manage app access <IconExternal className="size-3" /></a>
          </div>
        </div>
      )}
    </Card>
  );
}
