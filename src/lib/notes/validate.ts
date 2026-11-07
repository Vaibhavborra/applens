import type { Card, ChunkNotes, KeyTerm, ReducePlan, TimedText, TranscriptChunk } from "./types";

/** "12:34" / "1:02:03" / "[12:34]" → seconds; null if unparseable. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  const m = /^\[?\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?\s*\]?$/.exec(value.trim());
  if (!m) return null;
  const [, h, mm, ss] = m;
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
}

/** Model-cited time if it falls inside the chunk (±2 s), else the chunk start. */
export function timeInChunk(value: unknown, chunk: TranscriptChunk): number {
  const t = parseTimestamp(value);
  return t !== null && t >= chunk.start - 2 && t <= chunk.end + 2
    ? Math.max(chunk.start, Math.min(t, chunk.end))
    : chunk.start;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Small models sometimes wrap JSON in prose or code fences; take the outermost object. */
export function extractJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(raw.slice(a, b + 1));
      } catch {
        /* fall through */
      }
    }
    return undefined;
  }
}

/**
 * Validate the map step's JSON. Returns null when it's unusable (not an object,
 * or no bullets), which triggers a retry / plain-text fallback.
 */
export function parseChunkNotes(raw: string, chunk: TranscriptChunk): ChunkNotes | null {
  const data = extractJson(raw);
  if (!isObj(data)) return null;

  const bullets: TimedText[] = arr(data.bullets)
    .map((b): TimedText | null => {
      if (typeof b === "string") return str(b) ? { text: str(b), start: chunk.start } : null;
      if (!isObj(b)) return null;
      const text = str(b.text);
      return text ? { text, start: timeInChunk(b.t ?? b.time ?? b.timestamp, chunk) } : null;
    })
    .filter((b): b is TimedText => b !== null)
    .slice(0, 10);
  if (bullets.length === 0) return null;

  const terms: KeyTerm[] = arr(data.terms)
    .map((t) => (isObj(t) ? { term: str(t.term, 80), definition: str(t.definition, 300) } : null))
    .filter((t): t is KeyTerm => t !== null && t.term !== "" && t.definition !== "")
    .slice(0, 6);

  const flashcards: Card[] = arr(data.flashcards)
    .map((c) =>
      isObj(c)
        ? {
            question: str(c.question, 300),
            answer: str(c.answer, 500),
            sourceStart: timeInChunk(c.t, chunk),
          }
        : null,
    )
    .filter((c): c is Card => c !== null && c.question !== "" && c.answer !== "")
    .slice(0, 5);

  return {
    title: str(data.title, 100) || `Part ${chunk.index + 1}`,
    bullets,
    terms,
    flashcards,
    fallback: false,
  };
}

/** Last resort: turn free text ("- point" / "1. point" lines) into bullets. */
export function fallbackChunkNotes(raw: string, chunk: TranscriptChunk): ChunkNotes {
  const bullets = raw
    .split("\n")
    .map((l) => /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l)?.[1]?.trim() ?? "")
    .filter((l) => l.length > 3)
    .slice(0, 10)
    .map((text) => ({ text, start: chunk.start }));
  return {
    title: `Part ${chunk.index + 1}`,
    bullets:
      bullets.length > 0
        ? bullets
        : [{ text: "(No notes could be generated for this part.)", start: chunk.start }],
    terms: [],
    flashcards: [],
    fallback: true,
  };
}

/**
 * Validate and repair the reduce step's plan so every chunk appears exactly
 * once, in order. Falls back to one section per chunk.
 */
export function parseReducePlan(raw: string, chunkTitles: readonly string[]): ReducePlan {
  const n = chunkTitles.length;
  const data = extractJson(raw);
  const obj = isObj(data) ? data : {};
  const title = str(obj.title, 120);
  const summary = str(obj.summary, 2000);

  const seen = new Set<number>();
  const sections: { heading: string; chunks: number[] }[] = [];
  for (const s of arr(obj.sections)) {
    if (!isObj(s)) continue;
    const heading = str(s.heading, 100);
    if (!heading) continue; // its parts stay unassigned and get re-homed below
    const chunks = [
      ...new Set(
        arr(s.parts ?? s.chunks)
          .map((p) => (typeof p === "number" ? p : Number.parseInt(String(p), 10)) - 1) // prompt uses 1-based parts
          .filter((i) => Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)),
      ),
    ];
    if (chunks.length === 0) continue;
    chunks.forEach((i) => seen.add(i));
    sections.push({ heading, chunks: chunks.sort((a, b) => a - b) });
  }

  // Attach each unassigned chunk to the model-made section holding the nearest
  // earlier chunk; chunks before any of those get their own section. (Only
  // model sections are candidates, so orphans don't snowball into one section.)
  const modelSections = [...sections];
  const assigned = new Set(seen);
  for (let i = 0; i < n; i++) {
    if (assigned.has(i)) continue;
    let owner: (typeof sections)[number] | undefined;
    let best = -1;
    for (const s of modelSections) {
      for (const c of s.chunks) {
        if (assigned.has(c) && c < i && c > best) {
          best = c;
          owner = s;
        }
      }
    }
    if (owner) owner.chunks.push(i);
    else sections.push({ heading: chunkTitles[i] ?? `Part ${i + 1}`, chunks: [i] });
  }
  for (const s of sections) s.chunks.sort((a, b) => a - b);
  sections.sort((a, b) => (a.chunks[0] ?? 0) - (b.chunks[0] ?? 0));

  return { title, summary, sections };
}
