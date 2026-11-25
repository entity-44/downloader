import { db } from "@/lib/db";
import { deleteArchive } from "@/lib/archive/import";
import { AppError } from "@/lib/http/errors";
import { authed, json } from "@/lib/http/handler";
import { archiveDTO, fileDTO } from "@/lib/serialize";
import { ARCHIVE_CATEGORIES } from "@/lib/types";

/** Archive details plus a filtered, paginated page of its media. */
export const GET = authed<{ id: string }>(async ({ req, auth, params }) => {
  const archive = await db().archiveImport.findFirst({ where: { id: params.id, userId: auth.user.id } });
  if (!archive) throw new AppError("NOT_FOUND");
  const sp = new URL(req.url).searchParams;
  const category = sp.get("category");
  const kind = sp.get("kind");
  const page = Math.max(Number(sp.get("page")) || 1, 1);
  const pageSize = Math.min(Math.max(Number(sp.get("pageSize")) || 120, 1), 500);
  const where = {
    archiveId: archive.id,
    userId: auth.user.id,
    ...(category && (ARCHIVE_CATEGORIES as readonly string[]).includes(category) ? { category } : {}),
    ...(kind === "IMAGE" || kind === "VIDEO" ? { kind } : {}),
  };
  const [files, total, byCategory, byKind] = await Promise.all([
    db().mediaFile.findMany({
      where,
      orderBy: [{ takenAt: "desc" }, { position: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db().mediaFile.count({ where }),
    db().mediaFile.groupBy({ by: ["category"], where: { archiveId: archive.id }, _count: true }),
    db().mediaFile.groupBy({ by: ["kind"], where: { archiveId: archive.id }, _count: true }),
  ]);
  return json({
    archive: archiveDTO(archive),
    files: files.map(fileDTO),
    total,
    page,
    pageSize,
    counts: {
      category: Object.fromEntries(byCategory.map((c) => [c.category ?? "other", c._count])),
      kind: Object.fromEntries(byKind.map((c) => [c.kind, c._count])),
    },
  });
});

export const DELETE = authed<{ id: string }>(async ({ auth, params }) => {
  await deleteArchive(auth.user.id, params.id);
  return json({ ok: true });
});
