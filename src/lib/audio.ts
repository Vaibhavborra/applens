import { extractPcmWithFfmpeg, type FfmpegProgress } from "./ffmpeg";
import { downmixToMono, resampleLinear } from "./pcm";

/** Whisper expects 16 kHz mono float32. */
export const TARGET_SAMPLE_RATE = 16_000;

export type DecodeMethod = "native" | "ffmpeg";

export interface DecodedAudio {
  pcm: Float32Array;
  sampleRate: typeof TARGET_SAMPLE_RATE;
  durationSec: number;
  method: DecodeMethod;
  decodeMs: number;
}

export type DecodeProgress = { stage: "reading" } | { stage: "decoding" } | FfmpegProgress;

export class DecodeError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DecodeError";
    this.cause = cause;
  }
}

/**
 * Decode any audio/video file to 16 kHz mono PCM. Tries the browser's native
 * decoder first (fast, no download), then falls back to ffmpeg.wasm.
 */
export async function decodeMediaFile(
  file: File,
  onProgress?: (p: DecodeProgress) => void,
): Promise<DecodedAudio> {
  const t0 = performance.now();
  let nativeError: unknown;
  try {
    const pcm = await decodeNative(file, onProgress);
    return finish(pcm, "native", t0);
  } catch (err) {
    nativeError = err;
  }

  try {
    const pcm = await extractPcmWithFfmpeg(file, TARGET_SAMPLE_RATE, onProgress);
    return finish(pcm, "ffmpeg", t0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DecodeError(message, { native: nativeError, ffmpeg: err });
  }
}

async function decodeNative(
  file: File,
  onProgress?: (p: DecodeProgress) => void,
): Promise<Float32Array> {
  onProgress?.({ stage: "reading" });
  const bytes = await file.arrayBuffer();
  onProgress?.({ stage: "decoding" });
  // decodeAudioData resamples to the context's rate, so decoding into a 16 kHz
  // context does the resampling in native code and keeps memory at 1/3 of 48 kHz.
  const ctx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(bytes);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  return resampleLinear(downmixToMono(channels), buffer.sampleRate, TARGET_SAMPLE_RATE);
}

function finish(pcm: Float32Array, method: DecodeMethod, t0: number): DecodedAudio {
  if (pcm.length === 0) throw new DecodeError("This file has no audio.");
  return {
    pcm,
    sampleRate: TARGET_SAMPLE_RATE,
    durationSec: pcm.length / TARGET_SAMPLE_RATE,
    method,
    decodeMs: Math.round(performance.now() - t0),
  };
}
