import { getConfig } from "../config";
import { AppError } from "../http/errors";
import { log } from "../log";

/**
 * Client for the official Instagram API with Instagram Login
 * (graph.instagram.com). Works with Instagram professional accounts
 * (Business or Creator) that authorized this app.
 *
 * Access tokens are sent as query parameters, as the API requires; URLs are
 * therefore never logged.
 */

export type GraphMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export type GraphChild = {
  id: string;
  media_type: GraphMediaType;
  media_url?: string;
  thumbnail_url?: string;
};

export type GraphMedia = {
  id: string;
  caption?: string;
  media_type: GraphMediaType;
  media_product_type?: "AD" | "FEED" | "STORY" | "REELS";
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  shortcode?: string;
  timestamp?: string;
  username?: string;
  children?: { data: GraphChild[] };
};

export type GraphPage<T> = { data: T[]; paging?: { cursors?: { after?: string }; next?: string } };

export type Fetcher = typeof fetch;

export const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,shortcode,timestamp,username,children{id,media_type,media_url,thumbnail_url}";

export class InstagramGraph {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly cfg = getConfig(),
  ) {}

  private base(path: string) {
    return new URL(`https://graph.instagram.com/${this.cfg.instagram.graphVersion}/${path.replace(/^\//, "")}`);
  }

  private async call<T>(url: URL, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: "error" });
    } catch {
      throw new AppError("UPSTREAM_ERROR");
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) throw mapGraphError(res.status, body);
    return body as T;
  }

  /** Exchanges an OAuth code for a short-lived token. */
  async exchangeCode(code: string): Promise<{ access_token: string; user_id: string | number; permissions?: string[] | string }> {
    const { appId, appSecret, redirectUri } = this.cfg.instagram;
    const form = new URLSearchParams({
      client_id: appId!,
      client_secret: appSecret!,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const res = await this.call<{ access_token?: string; user_id?: string | number; permissions?: string[] | string; data?: Array<{ access_token: string; user_id: string | number; permissions?: string }> }>(
      new URL("https://api.instagram.com/oauth/access_token"),
      { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded" } },
    );
    const d = res.data?.[0] ?? res;
    if (!d.access_token || d.user_id === undefined) throw new AppError("UPSTREAM_ERROR");
    return { access_token: d.access_token, user_id: d.user_id, permissions: d.permissions };
  }

  /** Short-lived (1h) → long-lived (60 days) token. */
  async exchangeLongLived(shortToken: string): Promise<{ access_token: string; expires_in: number }> {
    const url = new URL("https://graph.instagram.com/access_token");
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.cfg.instagram.appSecret!);
    url.searchParams.set("access_token", shortToken);
    return this.call(url);
  }

  async refreshLongLived(token: string): Promise<{ access_token: string; expires_in: number }> {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token);
    return this.call(url);
  }

  async me(token: string): Promise<{ user_id?: string; id: string; username: string; account_type?: string }> {
    const url = this.base("me");
    url.searchParams.set("fields", "user_id,username,account_type");
    url.searchParams.set("access_token", token);
    return this.call(url);
  }

  async listMedia(token: string, after?: string, limit = 50): Promise<GraphPage<GraphMedia>> {
    const url = this.base("me/media");
    url.searchParams.set("fields", MEDIA_FIELDS);
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 100)));
    if (after) url.searchParams.set("after", after);
    url.searchParams.set("access_token", token);
    return this.call(url);
  }

  async getMedia(token: string, mediaId: string): Promise<GraphMedia> {
    if (!/^\d{1,40}$/.test(mediaId)) throw new AppError("VALIDATION");
    const url = this.base(mediaId);
    url.searchParams.set("fields", MEDIA_FIELDS);
    url.searchParams.set("access_token", token);
    return this.call(url);
  }
}

export function mapGraphError(status: number, body: unknown): AppError {
  const err = (body as { error?: { code?: number; type?: string; error_subcode?: number } } | null)?.error;
  log.warn("Instagram API error", { status, code: err?.code, type: err?.type, subcode: err?.error_subcode });
  if (err?.code === 190 || err?.type === "OAuthException" && status === 401) return new AppError("TOKEN_EXPIRED");
  if (err?.code === 4 || err?.code === 17 || err?.code === 32 || err?.code === 613 || status === 429) return new AppError("RATE_LIMITED");
  if (err?.code === 10 || err?.code === 200) return new AppError("PRIVATE_MEDIA_REQUIRES_AUTHORIZATION");
  if (err?.code === 100 && status === 400) return new AppError("MEDIA_UNAVAILABLE");
  if (status === 404) return new AppError("MEDIA_UNAVAILABLE");
  return new AppError("UPSTREAM_ERROR");
}
