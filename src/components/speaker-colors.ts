/** Text colours for speaker names (cycled), readable in light and dark mode. */
const SPEAKER_COLORS = [
  "text-indigo-700 dark:text-indigo-300",
  "text-emerald-700 dark:text-emerald-300",
  "text-amber-700 dark:text-amber-300",
  "text-rose-700 dark:text-rose-300",
  "text-sky-700 dark:text-sky-300",
  "text-fuchsia-700 dark:text-fuchsia-300",
];
export const speakerColor = (i: number) => SPEAKER_COLORS[i % SPEAKER_COLORS.length]!;
