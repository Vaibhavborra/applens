/** Sample-index range `[start, end)` of the PCM buffer. */
export interface AudioWindow {
  start: number;
  end: number;
}

export interface WindowOptions {
  /** Whisper's receptive field is 30 s; windows never exceed this. */
  maxSec?: number;
  /** Search for a cut point no earlier than this. */
  minSec?: number;
  /** Energy frame size used to find the quietest cut point. */
  frameSec?: number;
}

/**
 * Split audio into ≤30 s windows, cutting each at the quietest frame between
 * minSec and maxSec. Cutting in pauses avoids splitting words across windows,
 * so each window can be transcribed independently (and streamed to the UI)
 * without overlap/merge logic.
 */
export function planWindows(
  pcm: Float32Array,
  sampleRate: number,
  { maxSec = 30, minSec = 20, frameSec = 0.1 }: WindowOptions = {},
): AudioWindow[] {
  const max = Math.floor(maxSec * sampleRate);
  const min = Math.floor(minSec * sampleRate);
  const frame = Math.max(1, Math.floor(frameSec * sampleRate));
  const windows: AudioWindow[] = [];

  let start = 0;
  while (start < pcm.length) {
    if (pcm.length - start <= max) {
      windows.push({ start, end: pcm.length });
      break;
    }
    let bestCut = start + max;
    let bestEnergy = Infinity;
    for (let f = start + min; f + frame <= start + max; f += frame) {
      const e = meanSquare(pcm, f, f + frame);
      if (e < bestEnergy) {
        bestEnergy = e;
        bestCut = f + Math.floor(frame / 2);
      }
    }
    windows.push({ start, end: bestCut });
    start = bestCut;
  }
  return windows;
}

export function meanSquare(pcm: Float32Array, start: number, end: number): number {
  const s = Math.max(0, start);
  const e = Math.min(pcm.length, end);
  if (e <= s) return 0;
  let sum = 0;
  for (let i = s; i < e; i++) sum += pcm[i]! * pcm[i]!;
  return sum / (e - s);
}

/**
 * Whisper hallucinates ("Thank you.", "Subtitles by…") on silence, so we skip
 * windows that are effectively silent. Threshold ≈ −60 dBFS RMS.
 */
export function isSilent(pcm: Float32Array, w: AudioWindow, rmsThreshold = 0.001): boolean {
  return Math.sqrt(meanSquare(pcm, w.start, w.end)) < rmsThreshold;
}
