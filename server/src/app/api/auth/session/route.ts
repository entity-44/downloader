import { authed, json } from "@/lib/http/handler";

export const GET = authed(async ({ auth }) => json({ user: auth.user, csrfToken: auth.csrfToken }));
