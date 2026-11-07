import { useEffect } from "react";
import type { Theme } from "./settings";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Keep the <html> class in sync with the setting (and the OS, when "system"). */
export function useApplyTheme(theme: Theme): void {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = media();
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}

export const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
