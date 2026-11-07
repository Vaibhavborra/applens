import type { SpeakerRequest, SpeakerResponse } from "@/workers/speaker.protocol";

export interface FingerprintProgress {
  onLoad?: (loaded: number, total: number) => void;
  onProgress?: (done: number, total: number) => void;
}

/**
 * One voice print (L2-normalised) per [start, end] range, or null where the
 * range has too little speech. Runs in a worker
 * that is terminated afterwards, so the model's memory is freed.
 */
export function fingerprintSegments(
  pcm: Float32Array,
  sampleRate: number,
  ranges: [number, number][],
  { onLoad, onProgress }: FingerprintProgress = {},
): Promise<(Float32Array | null)[]> {
  if (ranges.length === 0) return Promise.resolve([]);
  const worker = new Worker(new URL("../workers/speaker.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<(Float32Array | null)[]>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<SpeakerResponse>) => {
      const msg = e.data;
      if (msg.type === "load-progress") onLoad?.(msg.loaded, msg.total);
      else if (msg.type === "progress") onProgress?.(msg.done, msg.total);
      else if (msg.type === "result") resolve(msg.vectors);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => reject(new Error(e.message || "Speaker worker crashed"));
    const copy = pcm.slice();
    const req: SpeakerRequest = { type: "run", pcm: copy, sampleRate, ranges };
    worker.postMessage(req, [copy.buffer]);
  }).finally(() => worker.terminate());
}
