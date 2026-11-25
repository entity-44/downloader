import { clearSessionCookie, deleteSession } from "@/lib/auth/session";
import { authed, json } from "@/lib/http/handler";

export const POST = authed(async ({ auth }) => {
  await deleteSession(auth.sessionId);
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
});
