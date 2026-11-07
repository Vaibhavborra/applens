import type { Segment } from "@/types/transcript";

/** A few consecutive segments embedded together, so a hit carries its context. */
export interface Passage {
  start: number;
  end: number;
  text: string;
  /** Index of the first segment in the passage. */
  segmentIndex: number;
}

/**
 * Overlapping windows of `size` segments, advancing by `stride` (overlap keeps
 * an idea that straddles a boundary findable). The tail is always covered.
 */
export function buildPassages(segments: readonly Segment[], size = 3, stride = 2): Passage[] {
  const out: Passage[] = [];
  if (segments.length === 0) return out;
  for (let i = 0; ; i += stride) {
    const group = segments.slice(i, i + size);
    if (group.length === 0) break;
    out.push({
      start: group[0]!.start,
      end: group.at(-1)!.end,
      text: group.map((s) => s.text.trim()).join(" "),
      segmentIndex: i,
    });
    if (i + size >= segments.length) break;
  }
  return out;
}

/** Dot product; equals cosine similarity for the L2-normalised vectors we store. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const d = dot(a, b);
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na === 0 || nb === 0 ? 0 : d / (na * nb);
}

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Top-k items by cosine similarity, dropping weak matches. Results closer than
 * `minGapSec` to a better result are skipped so overlapping passages don't
 * all show up for the same moment.
 */
export function semanticSearch<T extends { start: number; vector: ArrayLike<number> }>(
  query: ArrayLike<number>,
  items: readonly T[],
  { k = 5, minScore = 0.25, minGapSec = 15 } = {},
): Scored<T>[] {
  const ranked = items
    .map((item) => ({ item, score: cosine(query, item.vector) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);
  const out: Scored<T>[] = [];
  for (const r of ranked) {
    if (out.some((o) => Math.abs(o.item.start - r.item.start) < minGapSec)) continue;
    out.push(r);
    if (out.length === k) break;
  }
  return out;
}

/**
 * Query → terms. "Quoted phrases" stay together; other words split on spaces.
 * Lowercased, accents stripped, 1-letter words dropped.
 */
export function parseQuery(q: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    const t = fold(m[1] ?? m[2] ?? "")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .trim();
    if (t.length >= 2 && !terms.includes(t)) terms.push(t);
  }
  return terms;
}

/** Lowercase + strip diacritics, keeping string length stable for highlight offsets. */
export function fold(s: string): string {
  return [...s]
    .map((ch) => {
      const base = ch.normalize("NFD").replace(/\p{M}+/gu, "");
      return base.length === 1 ? base.toLowerCase() : ch.toLowerCase();
    })
    .join("");
}

export interface KeywordHit {
  segmentIndex: number;
  segment: Segment;
  /** [start, end) character ranges to highlight, sorted, non-overlapping. */
  ranges: [number, number][];
  /** Distinct query terms matched. */
  matched: number;
}

/**
 * Segments containing query terms (word-prefix match: "sort" finds "sorting"),
 * ranked by distinct terms matched, then by time.
 */
export function keywordSearch(
  segments: readonly Segment[],
  query: string,
  limit = 50,
): KeywordHit[] {
  const terms = parseQuery(query);
  if (terms.length === 0) return [];
  const hits: KeywordHit[] = [];
  segments.forEach((segment, segmentIndex) => {
    const text = fold(segment.text);
    const ranges: [number, number][] = [];
    let matched = 0;
    for (const term of terms) {
      let found = false;
      for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
        const atWordStart = i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]!);
        if (!atWordStart) continue;
        ranges.push([i, i + term.length]);
        found = true;
      }
      if (found) matched++;
    }
    if (matched > 0) hits.push({ segmentIndex, segment, ranges: mergeRanges(ranges), matched });
  });
  return hits
    .sort((a, b) => b.matched - a.matched || a.segment.start - b.segment.start)
    .slice(0, limit);
}

export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
