import { Accounts } from "@/components/Accounts";

export const metadata = { title: "Accounts" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <Accounts connected={sp.connected ?? null} error={sp.error ?? null} />;
}
