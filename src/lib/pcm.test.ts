import { describe, expect, it } from "vitest";
import { computePeaks, downmixToMono, resampleLinear } from "./pcm";

describe("downmixToMono", () => {
  it("returns mono input as-is", () => {
    const ch = new Float32Array([0.1, 0.2]);
    expect(downmixToMono([ch])).toBe(ch);
  });

  it("averages stereo channels", () => {
    const out = downmixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 0.5, -1])]);
    expect(Array.from(out)).toEqual([0.5, 0.25, -1]);
  });

  it("handles no channels", () => {
    expect(downmixToMono([])).toHaveLength(0);
  });
});

describe("resampleLinear", () => {
  it("is a no-op at equal rates", () => {
    const x = new Float32Array([1, 2, 3]);
    expect(resampleLinear(x, 16000, 16000)).toBe(x);
  });

  it("downsamples 48k → 16k to a third of the length", () => {
    const x = new Float32Array(48000).fill(0.5);
    const y = resampleLinear(x, 48000, 16000);
    expect(y).toHaveLength(16000);
    expect(y.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it("interpolates when upsampling", () => {
    const y = resampleLinear(new Float32Array([0, 1]), 1, 2);
    expect(Array.from(y)).toEqual([0, 0.5, 1, 1]);
  });

  it("preserves a sine's frequency", () => {
    const from = 44100;
    const to = 16000;
    const freq = 440;
    const x = Float32Array.from({ length: from }, (_, i) =>
      Math.sin((2 * Math.PI * freq * i) / from),
    );
    const y = resampleLinear(x, from, to);
    // Count rising zero crossings ≈ frequency over 1 second.
    let crossings = 0;
    for (let i = 1; i < y.length; i++) if (y[i - 1]! < 0 && y[i]! >= 0) crossings++;
    expect(Math.abs(crossings - freq)).toBeLessThanOrEqual(1);
  });
});

describe("computePeaks", () => {
  it("finds min/max per bucket", () => {
    const { min, max } = computePeaks(new Float32Array([0.1, -0.5, 0.9, -0.2]), 2);
    expect(Array.from(min)).toEqual([-0.5, -0.2].map(Math.fround));
    expect(Array.from(max)).toEqual([0.1, 0.9].map(Math.fround));
  });

  it("never makes more buckets than samples", () => {
    expect(computePeaks(new Float32Array(3), 100).min).toHaveLength(3);
  });

  it("handles empty input", () => {
    expect(computePeaks(new Float32Array(0), 10).max).toHaveLength(1);
  });
});
