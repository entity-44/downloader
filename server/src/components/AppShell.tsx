"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, setCsrfToken } from "@/lib/client/api";
import { applyTheme } from "./theme";
import { IconArchive, IconHistory, IconHome, IconLogout, IconMonitor, IconMoon, IconSettings, IconSun, IconUser } from "./icons";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "Download", icon: IconHome },
  { href: "/history", label: "History", icon: IconHistory },
  { href: "/import", label: "Import", icon: IconArchive },
  { href: "/accounts", label: "Accounts", icon: IconUser },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="brand-gradient grid size-8 place-items-center rounded-[10px] text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 4v11" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
          <path d="M5 20h14" />
        </svg>
      </span>
      Keepsake
    </span>
  );
}

function ThemeSwitch({ initial }: { initial: string }) {
  const [theme, setTheme] = useState(initial);
  const order = ["system", "light", "dark"];
  const Icon = theme === "dark" ? IconMoon : theme === "light" ? IconSun : IconMonitor;
  return (
    <button
      type="button"
      className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      aria-label={`Theme: ${theme}. Click to change.`}
      title={`Theme: ${theme}`}
      onClick={async () => {
        const next = order[(order.indexOf(theme) + 1) % order.length];
        setTheme(next);
        applyTheme(next);
        await api("/api/settings", { method: "PUT", body: { theme: next } }).catch(() => {});
      }}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}

export function AppShell({ user, csrfToken, theme, children }: { user: { username: string }; csrfToken: string; theme: string; children: ReactNode }) {
  setCsrfToken(csrfToken);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => document.documentElement.dataset.theme === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-default bg-[var(--bg)]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="Keepsake home">
            <Logo />
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  isActive(n.href) ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-muted hover:text-[var(--text)]",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <ThemeSwitch initial={theme} />
            <span className="hidden px-2 text-sm text-muted sm:inline">{user.username}</span>
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              onClick={async () => {
                await api("/api/auth/logout", { method: "POST" }).catch(() => {});
                router.replace("/login");
                router.refresh();
              }}
            >
              <IconLogout className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-8 sm:px-6 md:pb-16 md:pt-12">{children}</main>

      {/* Mobile tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-default bg-[var(--bg)]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition", isActive(n.href) ? "text-[var(--color-accent-500)]" : "text-muted")}>
              <n.icon className="size-5" />
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
