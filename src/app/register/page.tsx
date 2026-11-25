import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getPageAuth } from "@/lib/auth/page";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getPageAuth()) redirect("/");
  const count = await db().user.count();
  const open = count === 0 || getConfig().allowRegistration;
  if (!open) redirect("/login");
  return <AuthForm mode="register" registrationOpen firstUser={count === 0} />;
}
