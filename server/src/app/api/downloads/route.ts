import { z } from "zod";
import { db } from "@/lib/db";
import { clearHistory, requestDownload } from "@/lib/downloads/service";
import { authed, json, readJson } from "@/lib/http/handler";
import { limiters } from "@/lib/security/rate-limit";
import { downloadDTO } from "@/lib/serialize";

export const GET = authed(async ({ req, auth }) => {
  const sp = new URL(req.url).searchParams;
  const take = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const cursor = sp.get("cursor");
  const rows = await db().download.findMany({
    where: { userId: auth.user.id },
    include: { files: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = rows.slice(0, take);
  return json({ downloads: page.map(downloadDTO), nextCursor: hasMore ? page[page.length - 1].id : null });
});

const bodySchema = z.object({ url: z.string().min(1).max(2048) });

export const POST = authed(
  async ({ req, auth }) => {
    const { url } = bodySchema.parse(await readJson(req));
    const dl = await requestDownload(auth.user.id, url);
    return json({ download: downloadDTO(dl) }, { status: 202 });
  },
  { limit: limiters.download },
);

export const DELETE = authed(async ({ auth }) => {
  const removed = await clearHistory(auth.user.id);
  return json({ removed });
});
