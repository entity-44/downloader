import type { Metadata, Viewport } from "next";
import { getPageAuth } from "@/lib/auth/page";
import { getSettings } from "@/lib/settings";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Keepsake — media downloader", template: "%s · Keepsake" },
  description: "Self-hosted downloader for your own Instagram media and data exports.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#16171b" },
  ],
};

// Applies the "system" theme before first paint to avoid a flash.
const themeScript = `(function(){try{var d=document.documentElement;if(d.dataset.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark')}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const auth = await getPageAuth().catch(() => null);
  const theme = auth ? (await getSettings(auth.user.id)).theme : "system";
  return (
    <html lang="en" data-theme={theme} className={theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
