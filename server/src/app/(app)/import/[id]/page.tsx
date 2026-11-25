import { notFound } from "next/navigation";
import { Gallery } from "@/components/Gallery";
import { requirePageAuth } from "@/lib/auth/page";
import { db } from "@/lib/db";

export const metadata = { title: "Archive gallery" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requirePageAuth();
  const archive = await db().archiveImport.findFirst({ where: { id, userId: auth.user.id }, select: { id: true } });
  if (!archive) notFound();
  return <Gallery archiveId={id} />;
}
