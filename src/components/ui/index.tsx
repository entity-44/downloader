"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cn(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "brand-gradient text-white shadow-sm shadow-rose-500/20 hover:brightness-110 active:brightness-95",
  secondary: "surface hover:bg-[var(--surface-2)]",
  ghost: "hover:bg-[var(--surface-2)]",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 select-none",
        size === "sm" ? "h-8 px-3 text-sm" : size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "secondary", className, children, download }: { href: string; variant?: Variant; className?: string; children: ReactNode; download?: boolean }) {
  const cls = cn("inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-all", variants[variant], className);
  if (download || href.startsWith("/api/")) {
    return (
      <a href={href} className={cls} download={download ? "" : undefined}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** Two-step destructive action: no browser popups. */
export function ConfirmButton({ onConfirm, children, confirmLabel = "Confirm", size = "sm", className }: { onConfirm: () => Promise<void> | void; children: ReactNode; confirmLabel?: string; size?: "sm" | "md"; className?: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed) {
    return (
      <Button size={size} variant="ghost" className={cn("text-red-600 dark:text-red-400", className)} onClick={() => setArmed(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 animate-fade-in">
      <Button
        size={size}
        variant="danger"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button size={size} variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("surface rounded-2xl p-5 sm:p-6", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted sm:text-base">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const badgeTone = {
  neutral: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  red: "bg-red-500/12 text-red-700 dark:text-red-400",
  blue: "bg-sky-500/12 text-sky-700 dark:text-sky-400",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
};
export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof badgeTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", badgeTone[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [keyof typeof badgeTone, string]> = {
    PENDING: ["blue", "Queued"],
    PROCESSING: ["blue", "Processing"],
    COMPLETED: ["green", "Ready"],
    FAILED: ["red", "Failed"],
    EXPIRED: ["neutral", "Expired"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return (
    <Badge tone={tone}>
      {(status === "PENDING" || status === "PROCESSING") && <Spinner className="size-3" />}
      {label}
    </Badge>
  );
}

export function SourceBadge({ source, owner }: { source: string; owner?: string | null }) {
  if (source === "CONNECTED_ACCOUNT") return <Badge tone="violet">{owner ? `Owned · @${owner}` : "Connected account"}</Badge>;
  if (source === "USER_UPLOAD") return <Badge tone="amber">Provided by you</Badge>;
  if (source === "ARCHIVE_IMPORT") return <Badge tone="blue">Data export</Badge>;
  return <Badge>{source}</Badge>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className ?? "size-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "error" | "success" | "warn"; title?: string; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    info: "border-sky-500/25 bg-sky-500/5",
    error: "border-red-500/30 bg-red-500/5",
    success: "border-emerald-500/30 bg-emerald-500/5",
    warn: "border-amber-500/30 bg-amber-500/5",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-xl border p-4 text-sm animate-fade-up", tones[tone])}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn("text-muted", title && "mt-1")}>{children}</div>}
      {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-default px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", checked ? "bg-[var(--color-accent-500)]" : "bg-zinc-400/40")}
    >
      <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
    </button>
  );
}
