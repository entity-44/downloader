import { useEffect, useState } from "react";

export function useRoute(): string[] {
  const read = () => (location.hash.startsWith("#/") ? location.hash.slice(2) : "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (path: string) => {
  location.hash = `#/${path.replace(/^\//, "")}`;
};

export function applyTheme(theme: string) {
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* private mode */
  }
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function getTheme() {
  try {
    return localStorage.getItem("theme") ?? "system";
  } catch {
    return "system";
  }
}

export function setting(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function setSetting(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
