import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../prompts";
import { NotesCancelled, runNotes, type NotesLLM } from "./run";

const segments = Array.from({ length: 30 }, (_, i) => ({
  start: i * 10,
  end: i * 10 + 9,
  text: `Sentence number ${i} about recursion and base cases. `.repeat(6),
}));

/** Fake LLM: answers map/reduce prompts with canned JSON, recording calls. */
function fakeLLM(behaviour: { badMapAttempts?: number; reduce?: string } = {}) {
  const calls: { kind: string; schema: boolean }[] = [];
  let mapCalls = 0;
  const llm: NotesLLM = {
    complete(messages: ChatMessage[], { schema }) {
      const prompt = messages.at(-1)!.content;
      if (prompt.includes("outline of a lecture")) {
        calls.push({ kind: "reduce", schema: !!schema });
        const n = Number(/split into (\d+)/.exec(prompt)![1]);
        return Promise.resolve(
          behaviour.reduce ??
            JSON.stringify({
              title: "Recursion",
              summary: "A lecture about recursion.",
              sections: [
                { heading: "Everything", parts: Array.from({ length: n }, (_, i) => i + 1) },
              ],
            }),
        );
      }
      if (!schema) {
        calls.push({ kind: "fallback", schema: false });
        return Promise.resolve("- Fallback point one\n- Fallback point two");
      }
      calls.push({ kind: "map", schema: true });
      mapCalls++;
      if (mapCalls <= (behaviour.badMapAttempts ?? 0)) return Promise.resolve('{"title": "trunc');
      const t = /\[(\d+:\d{2})\]/.exec(prompt)![1];
      return Promise.resolve(
        JSON.stringify({
          title: `Part at ${t}`,
          bullets: [{ text: `Point from ${t}`, t }],
          terms: [{ term: "Recursion", definition: "A function calling itself" }],
          flashcards: [{ question: "What stops recursion?", answer: "A base case", t }],
        }),
      );
    },
  };
  return { llm, calls };
}

describe("runNotes", () => {
  it("maps each chunk then reduces once", async () => {
    const { llm, calls } = fakeLLM();
    const progress: string[] = [];
    const notes = await runNotes(segments, llm, {
      chunkTokens: 300,
      onProgress: (p) => progress.push(p.stage === "map" ? `map ${p.done}/${p.total}` : "reduce"),
    });
    const maps = calls.filter((c) => c.kind === "map").length;
    expect(maps).toBeGreaterThan(3);
    expect(calls.at(-1)!.kind).toBe("reduce");
    expect(progress.at(-1)).toBe("reduce");
    expect(progress).toContain(`map ${maps}/${maps}`);
    expect(notes.title).toBe("Recursion");
    expect(notes.sections).toHaveLength(1);
    expect(notes.sections[0]!.bullets).toHaveLength(maps);
    expect(notes.sections[0]!.bullets[1]!.start).toBeGreaterThan(0); // timestamps preserved
    expect(notes.keyTerms).toHaveLength(1); // deduped across chunks
    expect(notes.flashcards).toHaveLength(1);
    expect(notes.fallbackParts).toBe(0);
  });

  it("retries a bad map response once", async () => {
    const { llm, calls } = fakeLLM({ badMapAttempts: 1 });
    const notes = await runNotes(segments.slice(0, 3), llm);
    expect(calls.filter((c) => c.kind === "map")).toHaveLength(2);
    expect(notes.fallbackParts).toBe(0);
  });

  it("falls back to plain-text bullets after two bad responses", async () => {
    const { llm, calls } = fakeLLM({ badMapAttempts: 2 });
    const notes = await runNotes(segments.slice(0, 3), llm);
    expect(calls.map((c) => c.kind)).toEqual(["map", "map", "fallback", "reduce"]);
    expect(notes.fallbackParts).toBe(1);
    expect(notes.sections[0]!.bullets.map((b) => b.text)).toEqual([
      "Fallback point one",
      "Fallback point two",
    ]);
  });

  it("survives an unusable reduce response", async () => {
    const { llm } = fakeLLM({ reduce: "nope" });
    const notes = await runNotes(segments, llm, { chunkTokens: 300 });
    expect(notes.sections.length).toBeGreaterThan(1); // one per part
    expect(notes.summary).toContain("Part at"); // chunk titles as summary
  });

  it("stops when cancelled", async () => {
    const { llm } = fakeLLM();
    let n = 0;
    await expect(
      runNotes(segments, llm, { chunkTokens: 300, isCancelled: () => ++n > 3 }),
    ).rejects.toBeInstanceOf(NotesCancelled);
  });

  it("uses part titles as headings when there are too few parts to group", async () => {
    const { llm } = fakeLLM();
    const notes = await runNotes(segments.slice(0, 2), llm); // 1 part
    expect(notes.sections.map((s) => s.heading)).toEqual(["Part at 0:00"]);
    expect(notes.summary).toBe("A lecture about recursion.");
  });

  it("rejects an empty transcript", async () => {
    await expect(runNotes([], fakeLLM().llm)).rejects.toThrow(/no transcript/);
  });
});
