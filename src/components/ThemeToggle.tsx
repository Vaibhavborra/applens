import { updateSettings, useSettings } from "@/app/settings";
import { NEXT_THEME, useApplyTheme } from "@/app/theme";

const LABEL = { system: "System theme", light: "Light theme", dark: "Dark theme" } as const;

/** Cycles System → Light → Dark. */
export function ThemeToggle() {
  const { theme } = useSettings();
  useApplyTheme(theme);
  return (
    <button
      type="button"
      onClick={() => updateSettings({ theme: NEXT_THEME[theme] })}
      className="rounded-md p-1.5 text-zinc-500 outline-none hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      aria-label={`${LABEL[theme]} (click to change)`}
      title={LABEL[theme]}
      data-testid="theme-toggle"
      data-theme={theme}
    >
      <svg
        viewBox="0 0 20 20"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        aria-hidden
      >
        {theme === "light" && (
          <>
            <circle cx="10" cy="10" r="3.5" />
            <path
              d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"
              strokeLinecap="round"
            />
          </>
        )}
        {theme === "dark" && (
          <path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5Z" strokeLinejoin="round" />
        )}
        {theme === "system" && (
          <>
            <rect x="3" y="4" width="14" height="9.5" rx="1.5" />
            <path d="M7.5 16.5h5M10 13.5v3" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  );
}
