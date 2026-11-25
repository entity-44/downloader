import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { authenticate } from "@/lib/http/handler";
import { isAppError } from "@/lib/http/errors";
import { clearMediaIndex, completeOAuth } from "@/lib/instagram/connections";
import { log } from "@/lib/log";

/** OAuth redirect target registered in the Meta app dashboard. */
export async function GET(req: Request) {
  const back = (params: Record<string, string>) => {
    const u = new URL("/accounts", getConfig().appUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return NextResponse.redirect(u, { status: 303 });
  };
  const auth = await authenticate(req);
  if (!auth) return NextResponse.redirect(new URL("/login", getConfig().appUrl), { status: 303 });
  const sp = new URL(req.url).searchParams;
  if (sp.get("error")) return back({ error: sp.get("error_reason") === "user_denied" ? "denied" : "oauth" });
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return back({ error: "oauth" });
  try {
    const conn = await completeOAuth(auth.user.id, code, state);
    clearMediaIndex(conn.id);
    return back({ connected: conn.username });
  } catch (e) {
    if (!isAppError(e)) log.error("OAuth callback failed", { error: e });
    return back({ error: isAppError(e) ? e.code : "oauth" });
  }
}
