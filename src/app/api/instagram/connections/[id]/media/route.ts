import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { authed, json } from "@/lib/http/handler";
import { getAccessToken } from "@/lib/instagram/connections";
import { InstagramGraph } from "@/lib/instagram/graph";
import { limiters } from "@/lib/security/rate-limit";

/** Browse the connected account's own media (official API). */
export const GET = authed<{ id: string }>(
  async ({ req, auth, params }) => {
    const conn = await db().instagramConnection.findFirst({ where: { id: params.id, userId: auth.user.id } });
    if (!conn) throw new AppError("NOT_FOUND");
    const after = new URL(req.url).searchParams.get("after") ?? undefined;
    if (after && !/^[A-Za-z0-9_=-]{1,512}$/.test(after)) throw new AppError("VALIDATION");
    const graph = new InstagramGraph();
    const token = await getAccessToken(conn, graph);
    const page = await graph.listMedia(token, after, 24);
    return json({
      media: page.data.map((m) => ({
        id: m.id,
        mediaType: m.media_type,
        productType: m.media_product_type ?? null,
        permalink: m.permalink ?? null,
        preview: m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? m.children?.data[0]?.media_url ?? null),
        caption: m.caption?.slice(0, 200) ?? null,
        timestamp: m.timestamp ?? null,
        itemCount: m.children?.data.length ?? 1,
      })),
      after: page.paging?.next ? (page.paging.cursors?.after ?? null) : null,
    });
  },
  { limit: limiters.download },
);
