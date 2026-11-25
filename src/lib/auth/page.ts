import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName, validateSessionToken, type AuthContext } from "./session";

/** For server components: returns the session or null. */
export async function getPageAuth(): Promise<AuthContext | null> {
  const jar = await cookies();
  return validateSessionToken(jar.get(sessionCookieName())?.value);
}

/** For server components: redirects to /login when not signed in. */
export async function requirePageAuth(): Promise<AuthContext> {
  const auth = await getPageAuth();
  if (!auth) redirect("/login");
  return auth;
}
