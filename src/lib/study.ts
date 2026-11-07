/** A study session over card ids: "good" retires a card, "again" re-queues it a few cards later. */
export interface StudySession {
  queue: number[];
  total: number;
  /** Cards answered "good" (each card counts once). */
  learned: number;
  /** "again" presses, for the summary. */
  lapses: number;
  /** Per-card "again" counts. */
  missed: Record<number, number>;
}

export type Grade = "good" | "again";

/** How many other cards to show before a missed card comes back. */
export const REQUEUE_GAP = 3;

export function startSession(
  ids: readonly number[],
  random: () => number = Math.random,
): StudySession {
  const queue = [...ids];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [queue[i], queue[j]] = [queue[j]!, queue[i]!];
  }
  return { queue, total: ids.length, learned: 0, lapses: 0, missed: {} };
}

export function grade(s: StudySession, g: Grade): StudySession {
  const [current, ...rest] = s.queue;
  if (current === undefined) return s;
  if (g === "good") return { ...s, queue: rest, learned: s.learned + 1 };
  const queue = [...rest];
  queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, current);
  return {
    ...s,
    queue,
    lapses: s.lapses + 1,
    missed: { ...s.missed, [current]: (s.missed[current] ?? 0) + 1 },
  };
}

export const isFinished = (s: StudySession) => s.queue.length === 0;
