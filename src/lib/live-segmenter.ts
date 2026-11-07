import { meanSquare } from "./chunking";

export interface LiveChunk {
  pcm: Float32Array;
  /** Position of the chunk's first sample in the recording, in seconds. */
  startSec: number;
}

export interface LiveSegmenterOptions {
  /** Don't cut before this much audio: Whisper needs context to be accurate. */
  minSec?: number;
  /** Always cut by this point (Whisper's limit is 30 s). */
  maxSec?: number;
  frameSec?: number;
  /** A frame is quiet when its RMS is below this fraction of the buffer's RMS. */
  pauseRatio?: number;
  /** A pause is at least this much quiet in a row (gaps inside words are shorter). */
  minPauseSec?: number;
}

/**
 * Turns a live stream of samples into chunks for Whisper. A chunk is cut at
 * the first real pause after `minSec` (so words aren't split and text appears
 * every few seconds), or at the quietest point before `maxSec` if the speaker
 * never pauses. Chunks are contiguous: together they are the whole recording.
 */
export class LiveSegmenter {
  private buf: Float32Array;
  private length = 0;
  private emitted = 0;
  private readonly min: number;
  private readonly max: number;
  private readonly frame: number;
  private readonly pauseRatio: number;
  private readonly pauseFrames: number;

  constructor(
    private readonly sampleRate: number,
    {
      minSec = 8,
      maxSec = 25,
      frameSec = 0.05,
      pauseRatio = 0.2,
      minPauseSec = 0.25,
    }: LiveSegmenterOptions = {},
  ) {
    this.min = Math.floor(minSec * sampleRate);
    this.max = Math.floor(maxSec * sampleRate);
    this.frame = Math.max(1, Math.floor(frameSec * sampleRate));
    this.pauseRatio = pauseRatio;
    this.pauseFrames = Math.max(1, Math.round(minPauseSec / frameSec));
    this.buf = new Float32Array(this.max + sampleRate);
  }

  /** Seconds of audio received but not yet emitted in a chunk. */
  get bufferedSec(): number {
    return this.length / this.sampleRate;
  }

  push(samples: Float32Array): LiveChunk[] {
    const out: LiveChunk[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(samples.length - offset, this.buf.length - this.length);
      this.buf.set(samples.subarray(offset, offset + take), this.length);
      this.length += take;
      offset += take;
      for (let cut = this.findCut(); cut > 0; cut = this.findCut()) out.push(this.emit(cut));
    }
    return out;
  }

  /** Emit whatever is left (call when recording stops). */
  flush(): LiveChunk | null {
    return this.length > 0 ? this.emit(this.length) : null;
  }

  /** Sample index to cut at, or 0 to wait for more audio. */
  private findCut(): number {
    if (this.length < this.min + this.frame) return 0;
    const limit = Math.min(this.length, this.max);
    const threshold = meanSquare(this.buf, 0, limit) * this.pauseRatio ** 2;
    let best = this.min;
    let bestEnergy = Infinity;
    let quietRun = 0;
    for (let f = this.min; f + this.frame <= limit; f += this.frame) {
      const e = meanSquare(this.buf, f, f + this.frame);
      quietRun = e <= threshold ? quietRun + 1 : 0;
      // First real pause: cut in its middle.
      if (quietRun === this.pauseFrames) {
        return f + this.frame - Math.floor((this.pauseFrames * this.frame) / 2);
      }
      if (e < bestEnergy) {
        bestEnergy = e;
        best = f + Math.floor(this.frame / 2);
      }
    }
    return this.length >= this.max ? best : 0;
  }

  private emit(cut: number): LiveChunk {
    const chunk = { pcm: this.buf.slice(0, cut), startSec: this.emitted / this.sampleRate };
    this.buf.copyWithin(0, cut, this.length);
    this.length -= cut;
    this.emitted += cut;
    return chunk;
  }
}
