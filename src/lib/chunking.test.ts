import { describe, expect, it } from "vitest";
import { isSilent, planWindows } from "./chunking";

const RATE = 100; // small rate keeps fixtures tiny; logic is rate-independent

function tone(seconds: number, amp = 0.5): Float32Array {
  return Float32Array.from({ length: seconds * RATE }, (_, i) => amp * Math.sin(i));
}

describe("planWindows", () => {
  it("returns one window for short audio", () => {
    expect(planWindows(tone(12), RATE)).toEqual([{ start: 0, end: 12 * RATE }]);
  });

  it("returns nothing for empty audio", () => {
    expect(planWindows(new Float32Array(0), RATE)).toEqual([]);
  });

  it("cuts in the quietest spot between min and max", () => {
    const pcm = tone(50);
    pcm.fill(0, 24 * RATE, 25 * RATE); // a 1 s pause at 24–25 s
    const [first, second] = planWindows(pcm, RATE);
    expect(first!.end / RATE).toBeGreaterThanOrEqual(24);
    expect(first!.end / RATE).toBeLessThanOrEqual(25);
    expect(second!.start).toBe(first!.end);
  });

  it("covers the whole buffer contiguously with windows ≤ maxSec", () => {
    const pcm = tone(3 * 60 + 7);
    const ws = planWindows(pcm, RATE);
    expect(ws[0]!.start).toBe(0);
    expect(ws.at(-1)!.end).toBe(pcm.length);
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]!;
      expect(w.end - w.start).toBeLessThanOrEqual(30 * RATE);
      expect(w.end).toBeGreaterThan(w.start);
      if (i > 0) expect(w.start).toBe(ws[i - 1]!.end);
      if (i < ws.length - 1) expect(w.end - w.start).toBeGreaterThanOrEqual(20 * RATE);
    }
  });
});

describe("isSilent", () => {
  it("flags digital silence and keeps speech-level audio", () => {
    const pcm = new Float32Array(10 * RATE);
    pcm.set(tone(5, 0.1), 5 * RATE);
    expect(isSilent(pcm, { start: 0, end: 5 * RATE })).toBe(true);
    expect(isSilent(pcm, { start: 5 * RATE, end: 10 * RATE })).toBe(false);
  });
});
