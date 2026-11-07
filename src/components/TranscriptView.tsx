import { useEffect, useRef } from "react";
import { formatTimestamp } from "@/lib/time";
import type { Segment } from "@/types/transcript";

/** Timestamped transcript. While `live`, sticks to the bottom unless the user scrolls up. */
export function TranscriptView({ segments, live }: { segments: Segment[]; live: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && live && stick.current) el.scrollTop = el.scrollHeight;
  }, [segments, live]);

  if (segments.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {live ? "Waiting for the first words…" : "No speech was detected in this file."}
      </p>
    );
  }

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="max-h-[28rem] overflow-y-auto pr-2"
      data-testid="transcript"
    >
      <ol className="space-y-1.5">
        {segments.map((s, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
            <span
              className="mt-0.5 shrink-0 self-start rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-500 tabular-nums dark:bg-zinc-800 dark:text-zinc-400"
              data-start={s.start}
            >
              {formatTimestamp(s.start)}
            </span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
