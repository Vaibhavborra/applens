import { useEffect, useRef, useState } from "react";
import type { StoredFlashcard } from "@/lib/db";
import { grade, isFinished, startSession, type Grade, type StudySession } from "@/lib/study";
import { TimeChip } from "./TimeChip";
import { Button } from "./ui";

/**
 * One card at a time. Space/Enter flips; then 1 or ← = "Again" (comes back
 * a few cards later), 2 or → = "Got it". Esc leaves. Keys are handled on the
 * focused study panel and marked handled, so the player shortcuts don't fire.
 */
export function StudyMode({
  cards,
  onExit,
  onSeek,
}: {
  cards: readonly StoredFlashcard[];
  onExit: () => void;
  onSeek?: ((t: number) => void) | undefined;
}) {
  const byId = new Map(cards.map((c) => [c.id!, c]));
  const [session, setSession] = useState<StudySession>(() => startSession(cards.map((c) => c.id!)));
  const [flipped, setFlipped] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const answer = (g: Grade) => {
    setSession((s) => grade(s, g));
    setFlipped(false);
  };
  const restart = (ids: number[]) => {
    setSession(startSession(ids));
    setFlipped(false);
    panel.current?.focus();
  };

  const current = byId.get(session.queue[0] ?? -1);
  const done = isFinished(session);
  const missedIds = Object.keys(session.missed).map(Number);

  return (
    <div
      ref={panel}
      tabIndex={-1}
      className="rounded-xl outline-none"
      data-testid="study"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("button")) return;
        let handled = true;
        if (e.key === "Escape") onExit();
        else if (done) handled = false;
        else if (!flipped && (e.key === " " || e.key === "Enter")) setFlipped(true);
        else if (flipped && (e.key === "1" || e.key === "ArrowLeft")) answer("again");
        else if (
          flipped &&
          (e.key === "2" || e.key === "ArrowRight" || e.key === " " || e.key === "Enter")
        )
          answer("good");
        else handled = false;
        if (handled) e.preventDefault();
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        <span data-testid="study-progress">
          {done
            ? "Session complete"
            : `${session.learned} of ${session.total} learned · ${session.queue.length} to go`}
        </span>
        <Button variant="ghost" onClick={onExit}>
          Exit study
        </Button>
      </div>
      <div
        className="mb-4 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${(session.learned / Math.max(1, session.total)) * 100}%` }}
        />
      </div>

      {done ? (
        <div
          className="rounded-xl border border-zinc-200 p-8 text-center dark:border-zinc-800"
          data-testid="study-done"
        >
          <p className="text-lg font-semibold">All {session.total} cards learned</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {missedIds.length === 0
              ? "You knew every card the first time."
              : `${missedIds.length} card${missedIds.length === 1 ? "" : "s"} needed another look (${session.lapses} repeat${session.lapses === 1 ? "" : "s"}).`}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {missedIds.length > 0 && (
              <Button variant="primary" onClick={() => restart(missedIds)}>
                Review the {missedIds.length} missed
              </Button>
            )}
            <Button onClick={() => restart(cards.map((c) => c.id!))}>Study all again</Button>
            <Button variant="ghost" onClick={onExit}>
              Back to cards
            </Button>
          </div>
        </div>
      ) : (
        current && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-t-xl p-8 text-center outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-zinc-800/40"
              aria-label={flipped ? "Show question" : "Show answer"}
              data-testid="study-card"
            >
              <span className="text-lg leading-relaxed font-medium">{current.question}</span>
              {flipped ? (
                <span
                  className="border-t border-zinc-200 pt-3 leading-relaxed text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                  data-testid="study-answer"
                >
                  {current.answer}
                </span>
              ) : (
                <span className="text-xs text-zinc-400">Click or press Space to reveal</span>
              )}
            </button>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                from <TimeChip t={current.sourceStart} onSeek={onSeek} />
              </span>
              {flipped ? (
                <span className="flex gap-2">
                  <Button onClick={() => answer("again")}>
                    Again <kbd className="text-xs text-zinc-400">1</kbd>
                  </Button>
                  <Button variant="primary" onClick={() => answer("good")}>
                    Got it <kbd className="text-xs text-indigo-200">2</kbd>
                  </Button>
                </span>
              ) : (
                <Button variant="primary" onClick={() => setFlipped(true)}>
                  Show answer
                </Button>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
