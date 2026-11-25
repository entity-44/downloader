"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import { formatDate, relativeTime } from "@/lib/client/format";
import { applyTheme } from "./theme";
import { IconMonitor, IconMoon, IconSun } from "./icons";
import { Badge, Button, Card, ConfirmButton, Notice, PageHeader, SectionTitle, Toggle, cn } from "./ui";

type Settings = {
  theme: string;
  maxDownloadMb: number;
  retentionHours: number;
  autoCleanup: boolean;
  limits: { maxDownloadMbCap: number; maxUploadMb: number; maxArchiveUploadMb: number };
};
type SessionInfo = { id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string };

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ settings: Settings }>("/api/settings").then((r) => setS(r.settings));
  }, []);

  async function save(patch: Partial<Settings>) {
    setError(null);
    setSaving(true);
    try {
      const r = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: patch });
      setS(r.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (!s) return <div className="h-64 animate-pulse rounded-2xl bg-[var(--surface-2)]" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" action={saved ? <Badge tone="green">Saved</Badge> : null} />
      {error && <Notice tone="error">{error}</Notice>}

      <Card>
        <SectionTitle title="Appearance" />
        <div className="grid max-w-md grid-cols-3 gap-2">
          {[
            ["system", "System", IconMonitor],
            ["light", "Light", IconSun],
            ["dark", "Dark", IconMoon],
          ].map(([value, label, Icon]) => {
            const I = Icon as typeof IconSun;
            return (
              <button
                key={value as string}
                onClick={() => {
                  applyTheme(value as string);
                  save({ theme: value as string });
                }}
                className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition", s.theme === value ? "border-[var(--color-accent-500)] bg-rose-500/5 font-medium" : "border-default hover:bg-[var(--surface-2)]")}
              >
                <I className="size-5" /> {label as string}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Downloads & storage" description="Applies to media fetched from connected accounts." />
        <DownloadSettings s={s} saving={saving} onSave={save} />
      </Card>

      <SecuritySettings />
      <DangerZone />
    </div>
  );
}

function DownloadSettings({ s, saving, onSave }: { s: Settings; saving: boolean; onSave: (p: Partial<Settings>) => void }) {
  const [maxMb, setMaxMb] = useState(String(s.maxDownloadMb));
  const [hours, setHours] = useState(String(s.retentionHours));
  const dirty = maxMb !== String(s.maxDownloadMb) || hours !== String(s.retentionHours);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Maximum download size</span>
          <div className="relative">
            <input className="input pr-12" type="number" min={1} max={s.limits.maxDownloadMbCap} value={maxMb} onChange={(e) => setMaxMb(e.target.value)} />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">MB</span>
          </div>
          <span className="mt-1 block text-xs text-muted">Per post. Server limit: {s.limits.maxDownloadMbCap} MB.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Temporary file retention</span>
          <div className="relative">
            <input className="input pr-16" type="number" min={1} max={2160} value={hours} onChange={(e) => setHours(e.target.value)} disabled={!s.autoCleanup} />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">hours</span>
          </div>
          <span className="mt-1 block text-xs text-muted">Downloaded files are deleted after this period.</span>
        </label>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl bg-[var(--surface-2)] p-4">
        <div>
          <p className="text-sm font-medium">Automatic cleanup</p>
          <p className="text-xs text-muted">When off, downloads are kept until you delete them. Archive imports and files you add are always kept until deleted.</p>
        </div>
        <Toggle label="Automatic cleanup" checked={s.autoCleanup} onChange={(v) => onSave({ autoCleanup: v })} />
      </div>
      <Button variant="primary" disabled={!dirty} loading={saving} onClick={() => onSave({ maxDownloadMb: Number(maxMb), retentionHours: Number(hours) })}>
        Save changes
      </Button>
    </div>
  );
}

function SecuritySettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const loadSessions = useCallback(() => api<{ sessions: SessionInfo[] }>("/api/auth/sessions").then((r) => setSessions(r.sessions)), []);
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ revokedSessions: number }>("/api/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setMsg({ tone: "success", text: `Password updated.${r.revokedSessions ? ` Signed out ${r.revokedSessions} other session(s).` : ""}` });
      setCurrent("");
      setNext("");
      loadSessions();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof ApiRequestError ? err.message : "Could not update password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle title="Security" description="Your Instagram password is never requested or stored. Instagram access tokens are encrypted at rest." />
      <div className="grid gap-8 lg:grid-cols-2">
        <form onSubmit={changePassword} className="space-y-3">
          <p className="text-sm font-medium">Change password</p>
          <input className="input" type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <input className="input" type="password" placeholder="New password (10+ characters)" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button type="submit" loading={busy}>Update password</Button>
        </form>
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">Active sessions</p>
            {sessions.length > 1 && (
              <ConfirmButton onConfirm={async () => { await api("/api/auth/sessions", { method: "DELETE" }); loadSessions(); }} confirmLabel="Sign out others">
                Sign out other sessions
              </ConfirmButton>
            )}
          </div>
          <ul className="space-y-2">
            {sessions.map((x) => (
              <li key={x.id} className="flex items-center gap-3 rounded-xl border border-default p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{describeAgent(x.userAgent)}</p>
                  <p className="text-xs text-muted">Signed in {formatDate(x.createdAt, false)} · active {relativeTime(x.lastSeenAt)}</p>
                </div>
                {x.current ? (
                  <Badge tone="green">This device</Badge>
                ) : (
                  <ConfirmButton onConfirm={async () => { await api(`/api/auth/sessions/${x.id}`, { method: "DELETE" }); loadSessions(); }} confirmLabel="Revoke">Revoke</ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function describeAgent(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function DangerZone() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="border-red-500/30">
      <SectionTitle title="Delete account" description="Permanently deletes your account, Instagram connections, history, imports and every stored file." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input className="input sm:max-w-xs" type="password" placeholder="Confirm with your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ConfirmButton
          size="md"
          confirmLabel="Delete everything"
          onConfirm={async () => {
            setError(null);
            try {
              await api("/api/account", { method: "DELETE", body: { password } });
              router.replace("/login");
              router.refresh();
            } catch (e) {
              setError(e instanceof ApiRequestError ? e.message : "Could not delete account.");
            }
          }}
        >
          Delete account
        </ConfirmButton>
      </div>
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      <p className="mt-4 text-xs text-muted">
        Connected Instagram accounts can also revoke this app in Instagram under Settings → Website permissions → Apps and websites. See <Link href="/accounts" className="underline underline-offset-4">Accounts</Link>.
      </p>
    </Card>
  );
}
