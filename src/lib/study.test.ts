import { describe, expect, it } from "vitest";
import { grade, isFinished, REQUEUE_GAP, startSession } from "./study";

const noShuffle = () => 0.999999; // Fisher–Yates with j = i keeps the order

describe("study session", () => {
  it("shuffles but keeps every card exactly once", () => {
    const ids = Array.from({ length: 20 }, (_, i) => i);
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const s = startSession(ids, rnd);
    expect([...s.queue].sort((a, b) => a - b)).toEqual(ids);
    expect(s.queue).not.toEqual(ids);
  });

  it("retires a card on 'good'", () => {
    let s = startSession([1, 2, 3], noShuffle);
    s = grade(s, "good");
    expect(s.queue).toEqual([2, 3]);
    expect(s.learned).toBe(1);
  });

  it("brings a missed card back after a few others", () => {
    let s = startSession([1, 2, 3, 4, 5, 6], noShuffle);
    s = grade(s, "again");
    expect(s.queue.indexOf(1)).toBe(REQUEUE_GAP);
    expect(s.lapses).toBe(1);
    expect(s.missed[1]).toBe(1);
  });

  it("re-queues at the end when few cards remain, and finishes", () => {
    let s = startSession([1, 2], noShuffle);
    s = grade(s, "again"); // [2, 1]
    expect(s.queue).toEqual([2, 1]);
    s = grade(grade(s, "good"), "good");
    expect(isFinished(s)).toBe(true);
    expect(s.learned).toBe(2);
    expect(grade(s, "good")).toBe(s); // no-op when empty
  });
});
