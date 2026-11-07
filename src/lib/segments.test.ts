import { describe, expect, it } from "vitest";
import { cleanSegments } from "./segments";

const RATE = 100;
// 0–5 s speech-level noise, 5–10 s digital silence.
const pcm = new Float32Array(10 * RATE);
for (let i = 0; i < 5 * RATE; i++) pcm[i] = 0.2 * Math.sin(i);

describe("cleanSegments", () => {
  it("drops segments over silent audio", () => {
    const out = cleanSegments(
      [
        { start: 0, end: 4, text: "Real speech." },
        { start: 6, end: 9, text: "you" },
      ],
      pcm,
      RATE,
      "",
    );
    expect(out.map((s) => s.text)).toEqual(["Real speech."]);
  });

  it("capitalises sentence starts, including across windows", () => {
    const out = cleanSegments(
      [
        { start: 0, end: 1, text: "the factorial of 0 is 1." },
        { start: 1, end: 2, text: "that is our base case" },
        { start: 2, end: 3, text: "and so on." },
      ],
      pcm,
      RATE,
      "That is the recursive case.",
    );
    expect(out.map((s) => s.text)).toEqual([
      "The factorial of 0 is 1.",
      "That is our base case",
      "and so on.",
    ]);
  });

  it("leaves mid-sentence continuations lowercase", () => {
    const out = cleanSegments([{ start: 0, end: 1, text: "which moves on" }], pcm, RATE, "a case,");
    expect(out[0]!.text).toBe("which moves on");
  });

  it("capitalises sentences inside a segment but not after abbreviations", () => {
    const out = cleanSegments(
      [{ start: 0, end: 1, text: "is 1. that is ours, e.g. the base. dr. smith agrees? yes." }],
      pcm,
      RATE,
      "so",
    );
    expect(out[0]!.text).toBe("is 1. That is ours, e.g. the base. Dr. smith agrees? Yes.");
  });

  it("drops empty text", () => {
    expect(cleanSegments([{ start: 0, end: 1, text: "  " }], pcm, RATE, "")).toEqual([]);
  });
});
