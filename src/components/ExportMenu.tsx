import { useLiveQuery } from "dexie-react-hooks";
import { shownSpeakerNames } from "@/lib/speakers";
import { useEffect, useRef, useState } from "react";
import { db, getFlashcards, type Lecture } from "@/lib/db";
import {
  downloadText,
  flashcardsToCsv,
  safeFileName,
  transcriptToSrt,
  transcriptToTxt,
} from "@/lib/export";
import type { Segment } from "@/types/transcript";

interface Item {
  id: string;
  label: string;
  hint: string;
  disabled: boolean;
  run: () => void;
}

/** Export menu: notes .md, flashcards .csv (Anki), transcript .txt, subtitles .srt. */
export function ExportMenu({
  lecture,
  segments,
}: {
  lecture: Lecture;
  segments: readonly Segment[];
}) {
  const notes = useLiveQuery(() => db.notes.get(lecture.id), [lecture.id]);
  const cards = useLiveQuery(() => getFlashcards(lecture.id), [lecture.id], []);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const base = safeFileName(lecture.title);
  const hasTranscript = segments.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Item[] = [
    {
      id: "notes",
      label: "Notes",
      hint: ".md",
      disabled: !notes,
      run: () => notes && downloadText(`${base} - notes.md`, notes.markdown, "text/markdown"),
    },
    {
      id: "flashcards",
      label: "Flashcards (Anki)",
      hint: ".csv",
      disabled: cards.length === 0,
      run: () => downloadText(`${base} - flashcards.csv`, flashcardsToCsv(cards), "text/csv"),
    },
    {
      id: "transcript",
      label: "Transcript",
      hint: ".txt",
      disabled: !hasTranscript,
      run: () =>
        downloadText(
          `${base} - transcript.txt`,
          transcriptToTxt(segments, lecture.title, shownSpeakerNames(lecture)),
          "text/plain",
        ),
    },
    {
      id: "srt",
      label: "Subtitles",
      hint: ".srt",
      disabled: !hasTranscript,
      run: () =>
        downloadText(
          `${base}.srt`,
          transcriptToSrt(segments, 0.5, shownSpeakerNames(lecture)),
          "application/x-subrip",
        ),
    },
  ];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-sm font-medium outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:hover:bg-zinc-800"
        data-testid="export-button"
      >
        Export
        <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="currentColor">
          <path
            d="M5.5 7.5 10 12l4.5-4.5"
            stroke="currentColor"
            strokeWidth={1.6}
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                it.run();
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm outline-none hover:bg-zinc-100 focus-visible:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800"
              data-testid={`export-${it.id}`}
            >
              {it.label}
              <span className="font-mono text-xs text-zinc-400">{it.hint}</span>
            </button>
          ))}
          {!notes && (
            <p className="border-t border-zinc-200 px-3 pt-1.5 pb-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Generate notes to export notes and flashcards.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
