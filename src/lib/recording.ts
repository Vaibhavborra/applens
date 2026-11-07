import type { Peaks } from "./pcm";

/**
 * Accumulates a live recording as 16-bit PCM (half the memory of float: ~115
 * MB per hour at 16 kHz) and turns it into a WAV file and waveform peaks.
 */
export class RecordingBuffer {
  private chunks: Int16Array[] = [];
  private samples = 0;

  constructor(readonly sampleRate: number) {}

  get durationSec(): number {
    return this.samples / this.sampleRate;
  }

  push(pcm: Float32Array): void {
    const out = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]!));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.chunks.push(out);
    this.samples += out.length;
  }

  /** A mono 16-bit WAV of everything recorded (the chunks aren't copied). */
  toWav(): Blob {
    const dataSize = this.samples * 2;
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const ascii = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    ascii(0, "RIFF");
    v.setUint32(4, 36 + dataSize, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, this.sampleRate, true);
    v.setUint32(28, this.sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    ascii(36, "data");
    v.setUint32(40, dataSize, true);
    return new Blob([header, ...this.chunks.map((c) => c.buffer as ArrayBuffer)], {
      type: "audio/wav",
    });
  }

  /** Same result as computePeaks() over the whole recording. */
  peaks(buckets: number): Peaks {
    const total = this.samples;
    const n = Math.max(1, Math.min(buckets, total || 1));
    const min = new Float32Array(n);
    const max = new Float32Array(n);
    const size = total / n;
    let b = 0;
    let bucketEnd = Math.max(1, Math.floor(size));
    let i = 0;
    for (const chunk of this.chunks) {
      for (const raw of chunk) {
        while (i >= bucketEnd && b < n - 1) {
          b++;
          bucketEnd = Math.max(Math.floor(b * size) + 1, Math.floor((b + 1) * size));
        }
        const v = raw / (raw < 0 ? 0x8000 : 0x7fff);
        if (v < min[b]!) min[b] = v;
        if (v > max[b]!) max[b] = v;
        i++;
      }
    }
    return { min, max };
  }
}
