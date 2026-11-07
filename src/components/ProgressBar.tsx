/** Determinate when `value` (0–1) is given, otherwise an indeterminate shimmer. */
export function ProgressBar({ value, label }: { value?: number | undefined; label: string }) {
  const pct = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
    >
      {pct === undefined ? (
        <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-indigo-500" />
      ) : (
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
