import { useEffect, useRef } from "react";
import { formatTimestamp } from "@/lib/time";
import type { Segment } from "@/types/transcript";

interface Props {
  segments: Segment[];
  /** Transcription still running: stick to the bottom as lines arrive. */
  live: boolean;
  /** Index of the line under the playhead, or -1. */
  active?: number;
  /** Follow the active line (true while media is playing). */
  follow?: boolean;
  onSeek?: ((t: number) => void) | undefined;
}

/** After the user scrolls manually, don't auto-scroll for this long. */
const USER_SCROLL_GRACE_MS = 4000;

export function TranscriptView({ segments, live, active = -1, follow = false, onSeek }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const lastUserScroll = useRef(0);
  const markUserScroll = () => {
    lastUserScroll.current = Date.now();
  };

  // Live transcription: keep the newest line in view.
  useEffect(() => {
    const el = box.current;
    if (el && live && !follow && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [segments, live, follow]);

  // Playback: keep the active line about a third of the way down.
  useEffect(() => {
    const el = box.current;
    if (!el || !follow || active < 0) return;
    if (Date.now() - lastUserScroll.current < USER_SCROLL_GRACE_MS) return;
    const line = el.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!line) return;
    const top = line.offsetTop;
    const visible =
      top >= el.scrollTop && top + line.offsetHeight <= el.scrollTop + el.clientHeight;
    const comfortable = visible && top - el.scrollTop < el.clientHeight * 0.7;
    if (!comfortable) el.scrollTo({ top: top - el.clientHeight / 3, behavior: "smooth" });
  }, [active, follow]);

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
        stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      // Only genuine user input pauses auto-follow (our own smooth scrolls fire
      // scroll events too, so onScroll can't tell them apart).
      onWheel={markUserScroll}
      onTouchMove={markUserScroll}
      onKeyDown={(e) => {
        if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(e.key))
          markUserScroll();
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) markUserScroll(); // scrollbar drag
      }}
      className="relative max-h-[28rem] overflow-y-auto pr-2"
      data-testid="transcript"
    >
      <ol className="space-y-0.5">
        {segments.map((s, i) => {
          const isActive = i === active;
          return (
            <li key={i} data-index={i}>
              <button
                type="button"
                onClick={() => onSeek?.(s.start)}
                disabled={!onSeek}
                aria-current={isActive ? "true" : undefined}
                className={`flex w-full gap-3 rounded-md px-2 py-1 text-left text-[15px] leading-relaxed transition-colors enabled:hover:bg-zinc-100 disabled:cursor-default dark:enabled:hover:bg-zinc-800 ${
                  isActive
                    ? "bg-indigo-50 text-indigo-950 dark:bg-indigo-950/50 dark:text-indigo-100"
                    : ""
                }`}
              >
                <span
                  className={`mt-0.5 shrink-0 self-start rounded px-1.5 py-0.5 font-mono text-xs tabular-nums ${
                    isActive
                      ? "bg-indigo-500 text-white"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                  data-start={s.start}
                >
                  {formatTimestamp(s.start)}
                </span>
                <span>{s.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
