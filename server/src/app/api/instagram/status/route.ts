import { instagramConfigured, getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { authed, json } from "@/lib/http/handler";
import { connectionDTO } from "@/lib/serialize";

export const GET = authed(async ({ auth }) => {
  const conns = await db().instagramConnection.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: "asc" } });
  return json({
    configured: instagramConfigured(),
    redirectUri: getConfig().instagram.redirectUri,
    connections: conns.map(connectionDTO),
  });
});
