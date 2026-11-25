"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import { Logo } from "./AppShell";
import { Button, Notice } from "./ui";

export function AuthForm({ mode, registrationOpen, firstUser }: { mode: "login" | "register"; registrationOpen: boolean; firstUser: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, { method: "POST", body: { username, password } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="surface rounded-2xl p-6 shadow-xl shadow-black/[0.03] sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">{mode === "login" ? "Welcome back" : firstUser ? "Create the admin account" : "Create an account"}</h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "login" ? "Sign in to your private media library." : "This account is for this server only — never use your Instagram password here."}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Username</span>
              <input className="input" autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Password</span>
              <input className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 10 : 1} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} />
              {mode === "register" && <span className="mt-1 block text-xs text-muted">At least 10 characters.</span>}
            </label>
            {mode === "register" && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Confirm password</span>
                <input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          {mode === "login" ? (
            registrationOpen ? (
              <>
                {firstUser ? "First time here? " : "No account? "}
                <Link href="/register" className="font-medium text-[var(--text)] underline-offset-4 hover:underline">
                  {firstUser ? "Set up the admin account" : "Create one"}
                </Link>
              </>
            ) : (
              "Accounts are created by the server administrator."
            )
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-[var(--text)] underline-offset-4 hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
