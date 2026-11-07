import { describe, expect, it } from "vitest";
import {
  buildPassages,
  cosine,
  fold,
  keywordSearch,
  mergeRanges,
  parseQuery,
  semanticSearch,
} from "./search";

const seg = (start: number, text: string) => ({ start, end: start + 5, text });

describe("buildPassages", () => {
  const segs = Array.from({ length: 7 }, (_, i) => seg(i * 10, `s${i}`));

  it("makes overlapping windows that cover every segment", () => {
    const p = buildPassages(segs, 3, 2);
    expect(p.map((x) => x.text)).toEqual(["s0 s1 s2", "s2 s3 s4", "s4 s5 s6"]);
    expect(p[1]).toMatchObject({ start: 20, end: 45, segmentIndex: 2 });
  });

  it("covers a short tail", () => {
    expect(buildPassages(segs.slice(0, 4), 3, 2).map((x) => x.text)).toEqual(["s0 s1 s2", "s2 s3"]);
  });

  it("handles tiny and empty inputs", () => {
    expect(buildPassages(segs.slice(0, 1))).toHaveLength(1);
    expect(buildPassages([])).toEqual([]);
  });
});

describe("cosine", () => {
  it("matches the definition", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1);
    expect(cosine([3, 4], [6, 8])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("semanticSearch", () => {
  const items = [
    { start: 0, vector: [1, 0, 0] },
    { start: 5, vector: [0.9, 0.1, 0] }, // near-duplicate moment of the first
    { start: 100, vector: [0.6, 0.8, 0] },
    { start: 200, vector: [0, 0, 1] },
  ];

  it("ranks by similarity, drops weak matches and near-duplicate moments", () => {
    const r = semanticSearch([1, 0, 0], items, { k: 5, minScore: 0.25, minGapSec: 15 });
    expect(r.map((x) => x.item.start)).toEqual([0, 100]);
    expect(r[0]!.score).toBeCloseTo(1);
  });

  it("respects k", () => {
    expect(semanticSearch([1, 0, 0], items, { k: 1 })).toHaveLength(1);
  });
});

describe("parseQuery / fold", () => {
  it("keeps quoted phrases, strips punctuation and duplicates", () => {
    expect(parseQuery('Merge "base case" sort, merge a')).toEqual(["merge", "base case", "sort"]);
    expect(parseQuery("   ")).toEqual([]);
  });

  it("folds accents without changing length", () => {
    expect(fold("Café Ñandú")).toBe("cafe nandu");
    expect(fold("Café").length).toBe(4);
  });
});

describe("keywordSearch", () => {
  const segs = [
    seg(0, "Today we cover sorting algorithms."),
    seg(10, "Quicksort and merge sort are both n log n on average."),
    seg(20, "Resorting to brute force is slow."),
    seg(30, "The base case stops the recursion. Every base case matters."),
  ];

  it("matches word prefixes, not mid-word", () => {
    const hits = keywordSearch(segs, "sort");
    expect(hits.map((h) => h.segment.start)).toEqual([0, 10]); // not "Quicksort"/"Resorting"
    expect(hits[1]!.ranges).toEqual([[20, 24]]);
  });

  it("ranks by distinct terms matched, then time", () => {
    const hits = keywordSearch(segs, "merge sort");
    expect(hits[0]!.segment.start).toBe(10);
    expect(hits[0]!.matched).toBe(2);
  });

  it("finds phrases and every occurrence", () => {
    const [hit] = keywordSearch(segs, '"base case"');
    expect(hit!.segment.start).toBe(30);
    expect(hit!.ranges).toHaveLength(2);
  });

  it("is case and accent insensitive", () => {
    expect(keywordSearch([seg(0, "Le café est fermé")], "CAFE")).toHaveLength(1);
  });

  it("returns nothing for an empty query", () => {
    expect(keywordSearch(segs, " ")).toEqual([]);
  });
});

describe("mergeRanges", () => {
  it("merges overlaps and sorts", () => {
    expect(
      mergeRanges([
        [5, 8],
        [0, 3],
        [2, 4],
        [8, 9],
      ]),
    ).toEqual([
      [0, 4],
      [5, 9],
    ]);
  });
});
