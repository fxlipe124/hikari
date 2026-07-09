import { useEffect } from "react";
import { create } from "zustand";

type Theme = "dark" | "light" | "system";

const STORAGE_KEY = "hikari.theme";

function applyTheme(theme: Theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
}

// Zustand instead of per-hook useState so every consumer (Settings, the
// command palette, App) sees the same value live — with local state, a
// theme change from the palette wouldn't refresh an already-mounted
// Settings screen.
const useThemeStore = create<{ theme: Theme; setTheme: (t: Theme) => void }>(
  (set) => ({
    theme:
      typeof window === "undefined"
        ? "dark"
        : ((localStorage.getItem(STORAGE_KEY) as Theme) || "dark"),
    setTheme: (theme) => set({ theme }),
  })
);

export function useTheme() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // Effects run once per consumer, but applyTheme/localStorage writes are
  // idempotent — same behavior as the previous per-hook implementation.
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme };
}
