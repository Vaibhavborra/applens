import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { getFlashcards, type StoredFlashcard } from "@/lib/db";
import { TimeChip } from "./TimeChip";

export function FlashcardsPanel({
  lectureId,
  onSeek,
}: {
  lectureId: string;
  onSeek?: ((t: number) => void) | undefined;
}) {
  const cards = useLiveQuery(() => getFlashcards(lectureId), [lectureId]);
  if (!cards) return null;
  if (cards.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400" data-testid="flashcards-empty">
        Flashcards are created together with the notes. Generate notes from the Notes tab.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        {cards.length} cards · click a card to reveal the answer
      </p>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="flashcards">
        {cards.map((c) => (
          <FlipCard key={c.id} card={c} onSeek={onSeek} />
        ))}
      </ul>
    </div>
  );
}

function FlipCard({
  card,
  onSeek,
}: {
  card: StoredFlashcard;
  onSeek?: ((t: number) => void) | undefined;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <li className="flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        aria-pressed={flipped}
        onClick={() => setFlipped((f) => !f)}
        className={`min-h-28 flex-1 rounded-t-lg p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          flipped
            ? "bg-indigo-50 dark:bg-indigo-950/40"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        }`}
      >
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
          {flipped ? "Answer" : "Question"}
        </span>
        <span className="mt-1 block leading-relaxed">{flipped ? card.answer : card.question}</span>
      </button>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        from <TimeChip t={card.sourceStart} onSeek={onSeek} />
      </div>
    </li>
  );
}
