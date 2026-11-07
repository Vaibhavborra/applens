/** Pure PCM helpers: no Web Audio dependency, so they're unit-testable in Node. */

/** Average N channels into one. Returns the input unchanged for mono. */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  const [first, ...rest] = channels;
  if (!first) return new Float32Array(0);
  if (rest.length === 0) return first;

  const out = new Float32Array(first.length);
  for (const ch of channels) {
    for (let i = 0; i < out.length; i++) out[i]! += ch[i] ?? 0;
  }
  const scale = 1 / channels.length;
  for (let i = 0; i < out.length; i++) out[i]! *= scale;
  return out;
}

/**
 * Linear-interpolation resampler. Only a safety net: browsers normally resample
 * during decodeAudioData because we decode into a 16 kHz OfflineAudioContext.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const outLength = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLength);
  const step = fromRate / toRate;
  const last = input.length - 1;
  for (let i = 0; i < outLength; i++) {
    const pos = i * step;
    const i0 = Math.min(Math.floor(pos), last);
    const i1 = Math.min(i0 + 1, last);
    const frac = pos - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

/** Resolution of stored/drawn waveforms (~32 KB per lecture). */
export const WAVEFORM_BUCKETS = 4000;

/** Min/max per bucket for waveform drawing. */
export function computePeaks(pcm: Float32Array, buckets: number): Peaks {
  const n = Math.max(1, Math.min(buckets, pcm.length || 1));
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  const size = pcm.length / n;
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * size);
    const end = Math.max(start + 1, Math.floor((b + 1) * size));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end && i < pcm.length; i++) {
      const v = pcm[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}
