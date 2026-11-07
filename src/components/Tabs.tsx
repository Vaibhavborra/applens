import { useRef, type ReactNode } from "react";

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
}

/** WAI-ARIA tabs: arrow keys / Home / End move between tabs. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
}: {
  tabs: readonly TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focus = (i: number) => {
    const n = tabs.length;
    const idx = (i + n) % n;
    refs.current[idx]?.focus();
    onChange(tabs[idx]!.id);
  };

  return (
    <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") focus(i + 1);
              else if (e.key === "ArrowLeft") focus(i - 1);
              else if (e.key === "Home") focus(0);
              else if (e.key === "End") focus(tabs.length - 1);
              else return;
              e.preventDefault();
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              selected
                ? "border-indigo-500 text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  id,
  children,
}: {
  idPrefix: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      className="pt-4"
    >
      {children}
    </div>
  );
}
