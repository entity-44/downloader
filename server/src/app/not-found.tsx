import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-sm font-medium text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-4">Back to dashboard</Link>
      </div>
    </div>
  );
}
