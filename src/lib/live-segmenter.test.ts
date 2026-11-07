import { describe, expect, it } from "vitest";
import { LiveSegmenter } from "./live-segmenter";
import { computePeaks } from "./pcm";
import { RecordingBuffer } from "./recording";

const SR = 1000; // small rate keeps the tests fast; the logic is rate-independent

/** "Speech" (a loud tone) with silent gaps at the given [start, end) seconds. */
function audio(sec: number, gaps: [number, number][] = []): Float32Array {
  const pcm = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < pcm.length; i++) {
    const t = i / SR;
    pcm[i] = gaps.some(([a, b]) => t >= a && t < b) ? 0 : 0.5 * Math.sin(i * 0.7);
  }
  return pcm;
}

/** Feed audio in small blocks, like the microphone does. */
function feed(seg: LiveSegmenter, pcm: Float32Array, block = 128) {
  const chunks = [];
  for (let i = 0; i < pcm.length; i += block) chunks.push(...seg.push(pcm.subarray(i, i + block)));
  return chunks;
}

describe("LiveSegmenter", () => {
  it("waits for minSec, then cuts at the first pause", () => {
    const seg = new LiveSegmenter(SR, { minSec: 8, maxSec: 25 });
    const chunks = feed(
      seg,
      audio(12, [
        [5, 5.5],
        [9.2, 9.6],
      ]),
    );
    expect(chunks).toHaveLength(1);
    // The pause at 5 s is too early; the one at 9.2–9.6 s is used.
    expect(chunks[0]!.startSec).toBe(0);
    const cutSec = chunks[0]!.pcm.length / SR;
    expect(cutSec).toBeGreaterThan(9.2);
    expect(cutSec).toBeLessThan(9.6);
  });

  it("ignores gaps too short to be a pause", () => {
    const seg = new LiveSegmenter(SR, { minSec: 8, maxSec: 25 });
    const chunks = feed(
      seg,
      audio(14, [
        [8.5, 8.6], // 100 ms: a gap inside a word
        [11, 11.4],
      ]),
    );
    expect(chunks).toHaveLength(1);
    const cutSec = chunks[0]!.pcm.length / SR;
    expect(cutSec).toBeGreaterThan(11);
    expect(cutSec).toBeLessThan(11.4);
  });

  it("cuts at maxSec when the speaker never pauses", () => {
    const seg = new LiveSegmenter(SR, { minSec: 8, maxSec: 25 });
    const chunks = feed(seg, audio(60));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.pcm.length / SR).toBeLessThanOrEqual(25);
  });

  it("chunks are contiguous and, with flush, cover the whole recording", () => {
    const seg = new LiveSegmenter(SR, { minSec: 3, maxSec: 10 });
    const pcm = audio(47, [
      [4, 4.4],
      [11, 11.3],
      [20, 21],
    ]);
    const chunks = feed(seg, pcm);
    const last = seg.flush();
    if (last) chunks.push(last);
    let pos = 0;
    for (const c of chunks) {
      expect(c.startSec).toBeCloseTo(pos / SR, 6);
      expect(c.pcm).toEqual(pcm.subarray(pos, pos + c.pcm.length));
      pos += c.pcm.length;
    }
    expect(pos).toBe(pcm.length);
    expect(seg.flush()).toBeNull();
  });
});

describe("RecordingBuffer", () => {
  it("writes a 16-bit mono WAV of everything pushed", async () => {
    const rec = new RecordingBuffer(16000);
    rec.push(new Float32Array([0, 1, -1]));
    rec.push(new Float32Array([0.5]));
    expect(rec.durationSec).toBeCloseTo(4 / 16000);
    const buf = await rec.toWav().arrayBuffer();
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 8);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(8);
    expect([...new Int16Array(buf, 44)]).toEqual([0, 32767, -32768, 16383]);
  });

  it("computes the same peaks as computePeaks", () => {
    const pcm = audio(3.7, [[1, 2]]);
    const rec = new RecordingBuffer(SR);
    for (let i = 0; i < pcm.length; i += 300) rec.push(pcm.subarray(i, i + 300));
    // Compare against the 16-bit-quantised signal the buffer actually holds.
    const quantised = Float32Array.from(pcm, (s) => {
      const q = s < 0 ? Math.round(s * 0x8000) : Math.trunc(s * 0x7fff);
      return q / (q < 0 ? 0x8000 : 0x7fff);
    });
    const want = computePeaks(quantised, 50);
    const got = rec.peaks(50);
    for (let b = 0; b < 50; b++) {
      expect(got.min[b]).toBeCloseTo(want.min[b]!, 3);
      expect(got.max[b]).toBeCloseTo(want.max[b]!, 3);
    }
  });
});
