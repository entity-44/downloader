import { AppShell } from "@/components/AppShell";
import { requirePageAuth } from "@/lib/auth/page";
import { getSettings } from "@/lib/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePageAuth();
  const settings = await getSettings(auth.user.id);
  return (
    <AppShell user={{ username: auth.user.username }} csrfToken={auth.csrfToken} theme={settings.theme}>
      {children}
    </AppShell>
  );
}
