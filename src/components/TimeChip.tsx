import { formatTimestamp } from "@/lib/time";

/** Timestamp that seeks the player when clicked (plain text when no player). */
export function TimeChip({
  t,
  onSeek,
  label,
}: {
  t: number;
  onSeek?: ((t: number) => void) | undefined;
  label?: string;
}) {
  const text = formatTimestamp(t);
  const cls =
    "inline-flex shrink-0 items-center rounded bg-zinc-100 px-1.5 py-0.5 align-middle font-mono text-xs text-zinc-600 tabular-nums dark:bg-zinc-800 dark:text-zinc-400";
  if (!onSeek) {
    return (
      <span className={cls} data-start={t}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSeek(t)}
      className={`${cls} transition-colors outline-none hover:bg-indigo-100 hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-950 dark:hover:text-indigo-300`}
      aria-label={`${label ?? "Jump to"} ${text}`}
      data-start={t}
    >
      {text}
    </button>
  );
}
