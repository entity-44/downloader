import { Dashboard } from "@/components/Dashboard";
import { requirePageAuth } from "@/lib/auth/page";
import { instagramConfigured } from "@/lib/config";
import { db } from "@/lib/db";

export default async function HomePage() {
  const auth = await requirePageAuth();
  const [connections, archives, mediaCount] = await Promise.all([
    db().instagramConnection.findMany({ where: { userId: auth.user.id }, select: { username: true } }),
    db().archiveImport.count({ where: { userId: auth.user.id, status: "COMPLETED" } }),
    db().mediaFile.count({ where: { userId: auth.user.id } }),
  ]);
  return (
    <Dashboard
      connections={connections.map((c) => c.username)}
      igConfigured={instagramConfigured()}
      archiveCount={archives}
      mediaCount={mediaCount}
    />
  );
}
