import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getPassages, type Lecture, type StoredPassage } from "@/lib/db";
import { getEmbedder } from "@/lib/embed-client";
import { startIndexing, useIndexStatus, type IndexStatus } from "@/app/indexer";
import { formatBytes } from "@/lib/format";
import { keywordSearch, semanticSearch, type Scored } from "@/lib/search";
import { needsIndex } from "@/lib/search-index";
import type { Segment } from "@/types/transcript";
import { ProgressBar } from "./ProgressBar";
import { TimeChip } from "./TimeChip";
import { Button } from "./ui";

interface Props {
  lecture: Lecture;
  segments: readonly Segment[];
  /** Tab is visible: focus the box and build a missing index. */
  active: boolean;
  /** This tab's job is still processing the lecture (it will index it). */
  processing: boolean;
  onSeek?: ((t: number) => void) | undefined;
}

export function SearchPanel({ lecture, segments, active, processing, onSeek }: Props) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const input = useRef<HTMLInputElement>(null);
  const indexState = useIndexStatus(lecture.id);
  const passages = useLiveQuery(() => getPassages(lecture.id), [lecture.id, lecture.searchModel]);
  const indexed = !needsIndex(lecture) && (passages?.length ?? 0) > 0;

  useEffect(() => {
    if (active) input.current?.focus();
  }, [active]);

  // Older lectures (or a failed index step) get indexed when the tab is first opened.
  const shouldAutoIndex =
    active && !processing && needsIndex(lecture) && indexState.kind === "idle";
  const lectureId = lecture.id;
  useEffect(() => {
    if (shouldAutoIndex) startIndexing(lectureId);
  }, [shouldAutoIndex, lectureId]);
  const startIndex = () => startIndexing(lectureId);

  const keywordHits = useMemo(() => keywordSearch(segments, debounced), [segments, debounced]);
  const semantic = useSemanticResults(debounced, indexed ? (passages ?? []) : null);

  return (
    <div className="space-y-5" data-testid="search">
      <div className="relative">
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3 3" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this lecture, e.g. “where did they explain recursion?”"
          aria-label="Search this lecture"
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pr-3 pl-9 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-900"
          data-testid="search-input"
        />
      </div>

      <IndexStatus
        state={indexState}
        indexed={indexed}
        processing={processing}
        onRetry={startIndex}
      />

      {debounced === "" ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ask a question or type keywords. Meaning-based matches find passages even when they use
          different words; exact matches highlight every occurrence.
        </p>
      ) : (
        <>
          {indexed && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                Best matches
              </h3>
              {semantic.status === "loading" && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Searching…</p>
              )}
              {semantic.status === "error" && (
                <p className="text-sm text-red-600 dark:text-red-400">{semantic.message}</p>
              )}
              {semantic.status === "done" &&
                (semantic.results.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No passage closely matches that meaning.
                  </p>
                ) : (
                  <ol className="space-y-1" data-testid="semantic-results">
                    {semantic.results.map((r) => (
                      <ResultRow
                        key={r.item.id ?? r.item.start}
                        start={r.item.start}
                        onSeek={onSeek}
                        meta={<Relevance score={r.score} />}
                      >
                        {truncate(r.item.text, 260)}
                      </ResultRow>
                    ))}
                  </ol>
                ))}
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Exact matches{keywordHits.length > 0 && ` (${keywordHits.length})`}
            </h3>
            {keywordHits.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No line contains {debounced.includes(" ") ? "these words" : "that word"}.
              </p>
            ) : (
              <ol className="space-y-1" data-testid="keyword-results">
                {keywordHits.map((h) => (
                  <ResultRow key={h.segmentIndex} start={h.segment.start} onSeek={onSeek}>
                    {highlight(h.segment.text, h.ranges)}
                  </ResultRow>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function IndexStatus({
  state,
  indexed,
  processing,
  onRetry,
}: {
  state: IndexStatus;
  indexed: boolean;
  processing: boolean;
  onRetry: () => void;
}) {
  if (state.kind === "running") {
    const downloading = state.total === 0 && state.loadTotal > 0;
    const label = downloading
      ? `Downloading the search model (${formatBytes(state.loaded)} / ${formatBytes(state.loadTotal)}, first time only)…`
      : state.total > 0
        ? `Preparing meaning-based search… ${state.done} / ${state.total}`
        : "Preparing meaning-based search…";
    const value = downloading
      ? state.loaded / state.loadTotal
      : state.total > 0
        ? state.done / state.total
        : undefined;
    return (
      <div className="space-y-2" data-testid="index-progress">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {label} Exact-word search works already.
        </p>
        <ProgressBar label="Indexing" value={value} />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-red-600 dark:text-red-400">
        Meaning-based search isn't available: {state.message}
        <Button variant="ghost" className="text-xs" onClick={onRetry}>
          Try again
        </Button>
      </p>
    );
  }
  if (!indexed && processing) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Meaning-based search will be ready when transcription finishes.
      </p>
    );
  }
  return null;
}

function ResultRow({
  start,
  onSeek,
  meta,
  children,
}: {
  start: number;
  onSeek?: ((t: number) => void) | undefined;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const body = (
    <>
      <TimeChip t={start} />
      <span className="min-w-0 flex-1 leading-relaxed">{children}</span>
      {meta}
    </>
  );
  const cls = "flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-[15px]";
  return (
    <li>
      {onSeek ? (
        <button
          type="button"
          onClick={() => onSeek(start)}
          className={`${cls} transition-colors outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-zinc-800`}
        >
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

function Relevance({ score }: { score: number }) {
  // MiniLM cosine for a good match is ~0.4–0.7; map 0.25→0, 0.7→1 for the bar.
  const pct = Math.round(Math.max(0, Math.min(1, (score - 0.25) / 0.45)) * 100);
  return (
    <span
      className="mt-2 flex shrink-0 items-center gap-1"
      title={`Similarity ${score.toFixed(2)}`}
    >
      <span className="h-1 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="sr-only">{pct}% match</span>
    </span>
  );
}

function highlight(text: string, ranges: readonly [number, number][]): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([a, b], i) => {
    if (a > pos) out.push(text.slice(pos, a));
    out.push(
      <mark key={i} className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40">
        {text.slice(a, b)}
      </mark>,
    );
    pos = b;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, "")}…`;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type SemanticState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: Scored<StoredPassage>[] }
  | { status: "error"; message: string };

/** Embed the query (in the worker) and rank stored passages; stale queries are dropped. */
function useSemanticResults(
  query: string,
  passages: readonly StoredPassage[] | null,
): SemanticState {
  const [state, setState] = useState<{ key: string; value: SemanticState }>({
    key: "",
    value: { status: "idle" },
  });
  const key = passages && query ? `${query}\u0000${passages.length}` : "";

  useEffect(() => {
    if (!key || !passages) return;
    let alive = true;
    getEmbedder()
      .embed([query])
      .then(
        ([q]) => {
          if (alive && q) {
            setState({ key, value: { status: "done", results: semanticSearch(q, passages) } });
          }
        },
        (e: unknown) => {
          if (alive) {
            setState({
              key,
              value: { status: "error", message: e instanceof Error ? e.message : String(e) },
            });
          }
        },
      );
    return () => {
      alive = false;
    };
  }, [key, query, passages]);

  if (!key) return { status: "idle" };
  return state.key === key ? state.value : { status: "loading" };
}
