import { startOAuth } from "@/lib/instagram/connections";
import { authed, json } from "@/lib/http/handler";

/** Returns the Instagram authorization URL (POST so it is CSRF-protected). */
export const POST = authed(async ({ auth }) => json({ url: await startOAuth(auth.user.id) }));
