import { describe, expect, it } from "vitest";
import { assembleNotes, dedupeCards, dedupeTerms } from "./assemble";
import { chunkTranscript, estimateTokens } from "./chunk";
import type { ChunkNotes, TranscriptChunk } from "./types";
import {
  extractJson,
  fallbackChunkNotes,
  parseChunkNotes,
  parseReducePlan,
  parseTimestamp,
  timeInChunk,
} from "./validate";

const chunk: TranscriptChunk = { index: 0, start: 60, end: 120, text: "" };

describe("chunkTranscript", () => {
  const segs = Array.from({ length: 50 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 9,
    text: "word ".repeat(40), // ~200 chars ≈ 50 tokens + timestamp
  }));

  it("keeps chunks under the token budget and covers every segment in order", () => {
    const chunks = chunkTranscript(segs, 300);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(310);
    const lines = chunks.flatMap((c) => c.text.split("\n"));
    expect(lines).toHaveLength(50);
    expect(lines[0]).toMatch(/^\[0:00\] word/);
    expect(chunks[1]!.start).toBe(chunks[0]!.end + 1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("puts an over-long segment in its own chunk", () => {
    const chunks = chunkTranscript(
      [{ start: 0, end: 5, text: "x".repeat(10_000) }, ...segs.slice(0, 2)],
      300,
    );
    expect(chunks[0]!.text.split("\n")).toHaveLength(1);
  });

  it("handles no segments", () => {
    expect(chunkTranscript([])).toEqual([]);
  });
});

describe("parseTimestamp / timeInChunk", () => {
  it("parses common forms", () => {
    expect(parseTimestamp("1:05")).toBe(65);
    expect(parseTimestamp("[12:34]")).toBe(754);
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp(42)).toBe(42);
    expect(parseTimestamp("soon")).toBeNull();
    expect(parseTimestamp("1:5")).toBeNull();
  });

  it("only trusts times inside the chunk", () => {
    expect(timeInChunk("1:30", chunk)).toBe(90);
    expect(timeInChunk("9:00", chunk)).toBe(60); // hallucinated → chunk start
    expect(timeInChunk(undefined, chunk)).toBe(60);
  });
});

describe("extractJson", () => {
  it("parses plain, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":{"b":2}} Hope this helps')).toEqual({ a: { b: 2 } });
    expect(extractJson('{"a":')).toBeUndefined();
  });
});

describe("parseChunkNotes", () => {
  it("validates, trims and clamps", () => {
    const raw = JSON.stringify({
      title: "  Recursion basics ",
      bullets: [
        { text: "Base case stops recursion", t: "1:10" },
        "plain string bullet",
        { text: "" },
        7,
      ],
      terms: [
        { term: "Recursion", definition: "A function calling itself" },
        { term: "", definition: "x" },
      ],
      flashcards: [
        { question: "What stops recursion?", answer: "The base case", t: "5:00" },
        { question: "No answer" },
      ],
    });
    const n = parseChunkNotes(raw, chunk)!;
    expect(n.title).toBe("Recursion basics");
    expect(n.bullets).toEqual([
      { text: "Base case stops recursion", start: 70 },
      { text: "plain string bullet", start: 60 },
    ]);
    expect(n.terms).toHaveLength(1);
    expect(n.flashcards).toEqual([
      { question: "What stops recursion?", answer: "The base case", sourceStart: 60 },
    ]);
    expect(n.fallback).toBe(false);
  });

  it("rejects output without bullets or that isn't JSON", () => {
    expect(parseChunkNotes('{"title":"x","bullets":[]}', chunk)).toBeNull();
    expect(parseChunkNotes("I cannot help with that", chunk)).toBeNull();
    expect(parseChunkNotes("[1,2]", chunk)).toBeNull();
  });

  it("defaults the title", () => {
    expect(parseChunkNotes('{"bullets":["a point"]}', { ...chunk, index: 2 })!.title).toBe(
      "Part 3",
    );
  });
});

describe("fallbackChunkNotes", () => {
  it("extracts list lines from free text", () => {
    const n = fallbackChunkNotes(
      "Here are notes:\n- First point\n* Second point\n2. Third point\nnot a bullet",
      chunk,
    );
    expect(n.bullets.map((b) => b.text)).toEqual(["First point", "Second point", "Third point"]);
    expect(n.fallback).toBe(true);
  });

  it("never returns an empty section", () => {
    expect(fallbackChunkNotes("nothing useful", chunk).bullets).toHaveLength(1);
  });
});

describe("parseReducePlan", () => {
  const titles = ["Intro", "Base case", "Factorial", "Fibonacci", "Memoization"];

  it("accepts a valid plan (1-based parts → 0-based chunks)", () => {
    const plan = parseReducePlan(
      JSON.stringify({
        title: "Recursion",
        summary: "Covers recursion.",
        sections: [
          { heading: "Foundations", parts: [1, 2] },
          { heading: "Examples", parts: [3, 4, 5] },
        ],
      }),
      titles,
    );
    expect(plan.sections).toEqual([
      { heading: "Foundations", chunks: [0, 1] },
      { heading: "Examples", chunks: [2, 3, 4] },
    ]);
    expect(plan.summary).toBe("Covers recursion.");
  });

  it("repairs duplicates, out-of-range parts, gaps and ordering", () => {
    const plan = parseReducePlan(
      JSON.stringify({
        sections: [
          { heading: "Later", parts: [4, "5", 99] },
          { heading: "Early", parts: [2, 4] },
          { heading: "", parts: [3] },
        ],
      }),
      titles,
    );
    // Part 1 has no earlier owner → its own section; part 3 joins "Early" (owner of part 2).
    expect(plan.sections).toEqual([
      { heading: "Intro", chunks: [0] },
      { heading: "Early", chunks: [1, 2] },
      { heading: "Later", chunks: [3, 4] },
    ]);
  });

  it("falls back to one section per chunk on garbage", () => {
    const plan = parseReducePlan("not json", titles.slice(0, 2));
    expect(plan.sections).toEqual([
      { heading: "Intro", chunks: [0] },
      { heading: "Base case", chunks: [1] },
    ]);
    expect(plan.summary).toBe("");
  });
});

describe("assembleNotes", () => {
  const c = (title: string, start: number, extra: Partial<ChunkNotes> = {}): ChunkNotes => ({
    title,
    bullets: [{ text: `${title} point`, start }],
    terms: [],
    flashcards: [],
    fallback: false,
    ...extra,
  });

  it("builds sections, dedupes terms/cards and renders markdown", () => {
    const chunks = [
      c("A", 0, {
        terms: [{ term: "Recursion", definition: "self call" }],
        flashcards: [{ question: "What is recursion?", answer: "x", sourceStart: 0 }],
      }),
      c("B", 40, {
        terms: [
          { term: "recursion.", definition: "dup" },
          { term: "Base case", definition: "stop" },
        ],
        flashcards: [{ question: "what is recursion", answer: "dup", sourceStart: 40 }],
      }),
    ];
    const notes = assembleNotes(chunks, {
      title: "Recursion",
      summary: "Sum.",
      sections: [{ heading: "All", chunks: [0, 1] }],
    });
    expect(notes.sections).toEqual([
      {
        heading: "All",
        start: 0,
        bullets: [
          { text: "A point", start: 0 },
          { text: "B point", start: 40 },
        ],
      },
    ]);
    expect(notes.keyTerms.map((t) => t.term)).toEqual(["Base case", "Recursion"]);
    expect(notes.flashcards).toHaveLength(1);
    expect(notes.markdown).toBe(
      "# Recursion\n\n## Summary\n\nSum.\n\n## All\n\n- A point [0:00]\n- B point [0:40]\n\n## Key terms\n\n- **Base case**: stop\n- **Recursion**: self call\n",
    );
  });

  it("falls back to chunk titles when the summary is missing", () => {
    const notes = assembleNotes([c("A", 0), c("B", 5)], {
      title: "",
      summary: "",
      sections: [{ heading: "H", chunks: [0, 1] }],
    });
    expect(notes.summary).toBe("A; B");
  });

  it("dedupe helpers ignore case and punctuation", () => {
    expect(
      dedupeTerms([
        { term: "Big-O", definition: "1" },
        { term: "big o", definition: "2" },
      ]),
    ).toHaveLength(2);
    expect(
      dedupeCards([
        { question: "Why?", answer: "", sourceStart: 0 },
        { question: "why", answer: "", sourceStart: 1 },
      ]),
    ).toHaveLength(1);
  });
});
