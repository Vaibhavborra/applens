import type { Segment } from "@/types/transcript";

/** Segments shorter than this give unreliable voice prints; they inherit a neighbour's label. */
export const MIN_SPEAKER_SEC = 1;

/**
 * Average-linkage agglomerative clustering on cosine similarity (vectors must
 * be L2-normalised). Clusters keep merging while the most similar pair is
 * above `threshold`, so the number of speakers comes out of the data. Returns
 * a cluster index per vector, numbered by first appearance.
 */
export function clusterSpeakers(vectors: readonly Float32Array[], threshold: number): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  const dot = (a: Float32Array, b: Float32Array) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
    return s;
  };
  // sim[i][j]: average similarity between clusters i and j (i, j = representative indices).
  const sim = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) sim[i]![j] = sim[j]![i] = dot(vectors[i]!, vectors[j]!);
  const size = new Array<number>(n).fill(1);
  const alive = new Array<boolean>(n).fill(true);
  const owner = Array.from({ length: n }, (_, i) => i);

  for (;;) {
    let best = -Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const row = sim[i]!;
      for (let j = i + 1; j < n; j++) {
        if (alive[j] && row[j]! > best) {
          best = row[j]!;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best < threshold) break;
    // Merge bj into bi; Lance–Williams update for average linkage.
    const si = size[bi]!;
    const sj = size[bj]!;
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bi || k === bj) continue;
      const v = (si * sim[bi]![k]! + sj * sim[bj]![k]!) / (si + sj);
      sim[bi]![k] = sim[k]![bi] = v;
    }
    size[bi] = si + sj;
    alive[bj] = false;
    for (let k = 0; k < n; k++) if (owner[k] === bj) owner[k] = bi;
  }

  const renumber = new Map<number, number>();
  return owner.map((o) => {
    if (!renumber.has(o)) renumber.set(o, renumber.size);
    return renumber.get(o)!;
  });
}

/**
 * Speaker index per segment. `labels` covers the segments listed in
 * `measured` (those long enough to fingerprint); the rest take the label of
 * the nearest measured segment in time. Re-numbered by first appearance.
 */
export function assignSpeakers(
  segments: readonly Segment[],
  measured: readonly number[],
  labels: readonly number[],
): number[] {
  if (measured.length === 0) return segments.map(() => 0);
  const out = new Array<number>(segments.length);
  measured.forEach((segIdx, k) => (out[segIdx] = labels[k]!));
  for (let i = 0; i < segments.length; i++) {
    if (out[i] !== undefined) continue;
    const mid = (segments[i]!.start + segments[i]!.end) / 2;
    let best = measured[0]!;
    let bestDist = Infinity;
    for (const m of measured) {
      const s = segments[m]!;
      const d = mid < s.start ? s.start - mid : mid > s.end ? mid - s.end : 0;
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    out[i] = out[best]!;
  }
  const renumber = new Map<number, number>();
  return out.map((l) => {
    if (!renumber.has(l)) renumber.set(l, renumber.size);
    return renumber.get(l)!;
  });
}

/** Voice prints need at least this much actual speech. */
export const MIN_VOICED_SEC = 0.8;

/**
 * The voiced part of an audio clip: 30 ms frames louder than 10% of the
 * clip's loudest frame (and above a noise floor), concatenated. Whisper
 * segments often include pauses, and a voice print of mostly silence matches
 * nobody. Returns null when there's too little speech to fingerprint.
 */
export function voicedAudio(pcm: Float32Array, sampleRate: number): Float32Array | null {
  const frame = Math.round(0.03 * sampleRate);
  const frames = Math.floor(pcm.length / frame);
  const rms = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += pcm[i]! * pcm[i]!;
    rms[f] = Math.sqrt(sum / frame);
    peak = Math.max(peak, rms[f]!);
  }
  const threshold = Math.max(0.005, peak * 0.1);
  const keep: number[] = [];
  for (let f = 0; f < frames; f++) if (rms[f]! >= threshold) keep.push(f);
  if (keep.length * frame < MIN_VOICED_SEC * sampleRate) return null;
  const out = new Float32Array(keep.length * frame);
  keep.forEach((f, k) => out.set(pcm.subarray(f * frame, (f + 1) * frame), k * frame));
  return out;
}

/** Indices of segments long enough to fingerprint. */
export function measurableSegments(segments: readonly Segment[]): number[] {
  return segments.flatMap((s, i) => (s.end - s.start >= MIN_SPEAKER_SEC ? [i] : []));
}

/** Names to show for a lecture, or null when there's nothing to distinguish (0–1 speakers). */
export function shownSpeakerNames(lecture: {
  speakerCount?: number;
  speakerNames?: string[];
}): readonly string[] | null {
  return (lecture.speakerCount ?? 0) > 1 ? (lecture.speakerNames ?? []) : null;
}

export function speakerName(index: number, names?: readonly string[]): string {
  return names?.[index]?.trim() || `Speaker ${index + 1}`;
}
