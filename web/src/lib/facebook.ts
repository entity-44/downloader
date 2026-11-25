import { UserError, type MediaItem, type Post } from "./types";

/**
 * Optional official route: Facebook Login (browser-only token flow, no app
 * secret) + Instagram Graph API for professional accounts linked to a Page.
 */
const GRAPH = "https://graph.facebook.com/v23.0";
const SCOPES = ["instagram_basic", "pages_show_list"];

export function appUrl() {
  return `${location.origin}${import.meta.env.BASE_URL}`;
}

export function startFacebookLogin(appId: string) {
  const state = crypto.randomUUID();
  sessionStorage.setItem("fb_state", state);
  const u = new URL("https://www.facebook.com/v23.0/dialog/oauth");
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", appUrl());
  u.searchParams.set("response_type", "token");
  u.searchParams.set("scope", SCOPES.join(","));
  u.searchParams.set("state", state);
  location.assign(u.toString());
}

/** Reads the token Facebook returns in the URL fragment, verifying state. */
export function consumeFacebookRedirect(hash = location.hash): boolean {
  if (!hash.includes("access_token=") || hash.startsWith("#/")) return false;
  const p = new URLSearchParams(hash.slice(1));
  const state = sessionStorage.getItem("fb_state");
  sessionStorage.removeItem("fb_state");
  history.replaceState(null, "", `${location.pathname}#/settings`);
  if (!state || p.get("state") !== state) return false;
  const token = p.get("access_token");
  if (!token) return false;
  sessionStorage.setItem("fb_token", JSON.stringify({ token, exp: Date.now() + Number(p.get("expires_in") ?? 3600) * 1000 }));
  return true;
}

export function facebookToken(): string | null {
  const raw = sessionStorage.getItem("fb_token");
  if (!raw) return null;
  const { token, exp } = JSON.parse(raw) as { token: string; exp: number };
  return exp > Date.now() ? token : null;
}

export function facebookLogout() {
  sessionStorage.removeItem("fb_token");
}

async function graph<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = facebookToken();
  if (!token) throw new UserError("Your Facebook session expired. Connect again in Settings.");
  const u = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const res = await fetch(u, { credentials: "omit" });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
  if (!res.ok) throw new UserError(body.error?.code === 190 ? "Your Facebook session expired. Connect again." : "The Instagram API returned an error.");
  return body as T;
}

export type IgAccount = { id: string; username: string; pageName: string };

export async function listIgAccounts(): Promise<IgAccount[]> {
  const r = await graph<{ data: Array<{ name: string; instagram_business_account?: { id: string; username: string } }> }>("me/accounts", {
    fields: "name,instagram_business_account{id,username}",
  });
  return r.data.filter((p) => p.instagram_business_account).map((p) => ({ id: p.instagram_business_account!.id, username: p.instagram_business_account!.username, pageName: p.name }));
}

export type GraphMedia = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  children?: { data: Array<{ media_type: string; media_url?: string; thumbnail_url?: string }> };
};

export async function listIgMedia(igId: string, after?: string) {
  return graph<{ data: GraphMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${igId}/media`, {
    fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}",
    limit: "24",
    ...(after ? { after } : {}),
  });
}

export function graphMediaToPost(m: GraphMedia, username: string): Post {
  const parts = m.media_type === "CAROUSEL_ALBUM" ? (m.children?.data ?? []) : [m];
  const items: MediaItem[] = parts
    .filter((c) => c.media_url)
    .map((c) => ({ kind: c.media_type === "VIDEO" ? "VIDEO" : "IMAGE", url: c.media_url!, thumbUrl: c.thumbnail_url }));
  const code = m.permalink?.match(/\/(?:p|reel|tv)\/([\w-]+)/)?.[1];
  return { platform: "instagram", id: code ?? m.id, url: m.permalink ?? "", author: username, caption: m.caption, takenAt: m.timestamp, items };
}
