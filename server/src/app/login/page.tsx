import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getPageAuth } from "@/lib/auth/page";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getPageAuth()) redirect("/");
  const count = await db().user.count();
  if (count === 0) redirect("/register");
  return <AuthForm mode="login" registrationOpen={getConfig().allowRegistration} firstUser={false} />;
}
