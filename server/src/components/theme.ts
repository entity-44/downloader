"use client";

export function applyTheme(theme: string) {
  const d = document.documentElement;
  d.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  d.classList.toggle("dark", dark);
}
