import { useEffect, useState } from "react";
import { IconArchive, IconHome, IconMonitor, IconMoon, IconSettings, IconSun, IconLink } from "./components/icons";
import { cn } from "./components/ui";
import { consumeFacebookRedirect } from "./lib/facebook";
import { applyTheme, getTheme, useRoute } from "./lib/router";
import { ButtonSetup } from "./views/ButtonSetup";
import { Home } from "./views/Home";
import { ImportView } from "./views/ImportView";
import { Receive } from "./views/Receive";
import { Settings } from "./views/Settings";

const NAV = [
  { path: "", label: "Download", icon: IconHome },
  { path: "import", label: "Import", icon: IconArchive },
  { path: "button", label: "Button", icon: IconLink },
  { path: "settings", label: "Settings", icon: IconSettings },
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

function ThemeSwitch() {
  const [theme, setTheme] = useState(getTheme);
  const order = ["system", "light", "dark"];
  const Icon = theme === "dark" ? IconMoon : theme === "light" ? IconSun : IconMonitor;
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => getTheme() === "system" && applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return (
    <button
      type="button"
      title={`Theme: ${theme}`}
      aria-label={`Theme: ${theme}. Click to change.`}
      className="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      onClick={() => {
        const next = order[(order.indexOf(theme) + 1) % order.length];
        setTheme(next);
        applyTheme(next);
      }}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}

export function App() {
  const route = useRoute();
  const [fbConnected] = useState(() => consumeFacebookRedirect());
  const top = route[0] ?? "";
  const active = (p: string) => (p === "" ? top === "" || top === "receive" : top === p);

  let view: React.ReactNode;
  if (top === "receive") view = <Receive />;
  else if (top === "import") view = <ImportView />;
  else if (top === "button") view = <ButtonSetup />;
  else if (top === "settings") view = <Settings justConnected={fbConnected} />;
  else view = <Home />;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-default bg-[var(--bg)]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <a href="#/" aria-label="Keepsake home"><Logo /></a>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.path} href={`#/${n.path}`} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition", active(n.path) ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-muted hover:text-[var(--text)]")}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto md:ml-0"><ThemeSwitch /></div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-8 sm:px-6 md:pb-16 md:pt-12">{view}</main>
      <footer className="hidden pb-8 text-center text-xs text-muted md:block">Everything runs in your browser. Nothing is stored or uploaded.</footer>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-default bg-[var(--bg)]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition", active(n.path) ? "text-[var(--color-accent-500)]" : "text-muted")}>
              <n.icon className="size-5" />
              {n.label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
