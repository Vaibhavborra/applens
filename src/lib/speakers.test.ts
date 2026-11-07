import { describe, expect, it } from "vitest";
import {
  assignSpeakers,
  clusterSpeakers,
  measurableSegments,
  speakerName,
  voicedAudio,
} from "./speakers";

/** Unit vector near `base` (one of a few orthogonal axes) with some noise. */
function voice(base: number, noise: number, seed: number): Float32Array {
  const v = new Float32Array(16);
  let x = seed;
  for (let i = 0; i < v.length; i++) {
    x = (x * 9301 + 49297) % 233280;
    v[i] = (x / 233280 - 0.5) * noise;
  }
  v[base] = (v[base] ?? 0) + 1;
  const n = Math.hypot(...v);
  return v.map((y) => y / n);
}

describe("clusterSpeakers", () => {
  it("finds the number of speakers and numbers them by first appearance", () => {
    const seq = [2, 2, 5, 2, 5, 2, 9, 2];
    const vectors = seq.map((b, i) => voice(b, 0.4, i + 1));
    expect(clusterSpeakers(vectors, 0.7)).toEqual([0, 0, 1, 0, 1, 0, 2, 0]);
  });

  it("keeps a single speaker together", () => {
    const vectors = Array.from({ length: 12 }, (_, i) => voice(3, 0.5, i + 7));
    expect(new Set(clusterSpeakers(vectors, 0.7)).size).toBe(1);
  });

  it("handles empty input", () => {
    expect(clusterSpeakers([], 0.7)).toEqual([]);
  });
});

describe("assignSpeakers", () => {
  const segs = [
    { start: 0, end: 5, text: "a" },
    { start: 5, end: 5.4, text: "short" },
    { start: 6, end: 10, text: "b" },
    { start: 10.2, end: 10.5, text: "short" },
    { start: 11, end: 14, text: "c" },
  ];

  it("lets short segments inherit the nearest measured speaker", () => {
    const measured = measurableSegments(segs);
    expect(measured).toEqual([0, 2, 4]);
    expect(assignSpeakers(segs, measured, [3, 1, 3])).toEqual([0, 0, 1, 1, 0]);
  });

  it("defaults to one speaker when nothing could be measured", () => {
    expect(assignSpeakers(segs, [], [])).toEqual([0, 0, 0, 0, 0]);
  });

  it("names speakers, with custom names", () => {
    expect(speakerName(0)).toBe("Speaker 1");
    expect(speakerName(1, ["Prof", "  "])).toBe("Speaker 2");
    expect(speakerName(0, ["Prof"])).toBe("Prof");
  });
});

describe("voicedAudio", () => {
  const SR = 1000;
  const clip = (voiced: [number, number][], sec: number) =>
    Float32Array.from({ length: sec * SR }, (_, i) =>
      voiced.some(([a, b]) => i / SR >= a && i / SR < b) ? 0.3 * Math.sin(i) : 0.0005,
    );

  it("keeps only the voiced frames", () => {
    const out = voicedAudio(clip([[0.5, 1.5]], 4), SR);
    expect(out).not.toBeNull();
    expect(out!.length / SR).toBeGreaterThan(0.9);
    expect(out!.length / SR).toBeLessThan(1.1);
  });

  it("returns null when there's too little speech", () => {
    expect(voicedAudio(clip([[1, 1.3]], 4), SR)).toBeNull();
    expect(voicedAudio(new Float32Array(4 * SR), SR)).toBeNull();
  });
});
