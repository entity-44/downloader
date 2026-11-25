import Link from "next/link";
import type { ReactNode } from "react";

const linkCls = "inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium surface hover:bg-[var(--surface-2)]";

const TITLES: Record<string, string> = {
  UNSUPPORTED_URL: "Unsupported URL",
  AUTH_REQUIRED: "Authentication required",
  NOT_CONNECTED: "Connect an account first",
  TOKEN_EXPIRED: "Instagram connection expired",
  PRIVATE_MEDIA_REQUIRES_AUTHORIZATION: "Private media requires authorized access",
  API_UNSUPPORTED: "Instagram API does not support this operation",
  MEDIA_UNAVAILABLE: "Media unavailable",
  RATE_LIMITED: "Slow down",
  TOO_LARGE: "File too large",
  INSTAGRAM_NOT_CONFIGURED: "Instagram API not configured",
  UPSTREAM_ERROR: "Instagram error",
  PROCESSING_FAILED: "Temporary processing failure",
};

export function errorTitle(code: string | null | undefined) {
  return (code && TITLES[code]) || "Download failed";
}

export function errorActions(code: string | null | undefined): ReactNode {
  switch (code) {
    case "NOT_CONNECTED":
    case "INSTAGRAM_NOT_CONFIGURED":
      return (
        <>
          <Link className={linkCls} href="/accounts">Connect Instagram</Link>
          <Link className={linkCls} href="/import">Import data export</Link>
        </>
      );
    case "TOKEN_EXPIRED":
      return <Link className={linkCls} href="/accounts">Reconnect account</Link>;
    case "PRIVATE_MEDIA_REQUIRES_AUTHORIZATION":
      return (
        <>
          <Link className={linkCls} href="/import#provided">Add files you were given</Link>
          <Link className={linkCls} href="/accounts">Manage connections</Link>
        </>
      );
    case "API_UNSUPPORTED":
      return <Link className={linkCls} href="/import">Import your data export</Link>;
    case "TOO_LARGE":
      return <Link className={linkCls} href="/settings">Adjust size limit</Link>;
    default:
      return null;
  }
}
