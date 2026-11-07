/// <reference lib="webworker" />
import {
  AutoModel,
  AutoProcessor,
  env,
  type ProgressInfo,
  type Tensor,
} from "@huggingface/transformers";
import { voicedAudio } from "@/lib/speakers";
import { SPEAKER_MODEL, type SpeakerRequest, type SpeakerResponse } from "./speaker.protocol";

declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false;

const post = (msg: SpeakerResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

/** Longer segments are trimmed to their middle: enough for a voice print, bounded cost. */
const MAX_SEC = 8;

self.onmessage = async (e: MessageEvent<SpeakerRequest>) => {
  const { pcm, sampleRate, ranges } = e.data;
  try {
    const progress_callback = (p: ProgressInfo) => {
      if (p.status === "progress_total")
        post({ type: "load-progress", loaded: p.loaded, total: p.total });
    };
    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(SPEAKER_MODEL, { progress_callback }),
      // CPU (WASM): small enough, and no contention with Whisper/WebLLM on the GPU.
      AutoModel.from_pretrained(SPEAKER_MODEL, {
        device: "wasm",
        dtype: "q8",
        progress_callback,
      }),
    ]);

    const vectors: (Float32Array | null)[] = [];
    for (let i = 0; i < ranges.length; i++) {
      let [start, end] = ranges[i]!;
      if (end - start > MAX_SEC) {
        const mid = (start + end) / 2;
        start = mid - MAX_SEC / 2;
        end = mid + MAX_SEC / 2;
      }
      const audio = voicedAudio(
        pcm.subarray(Math.floor(start * sampleRate), Math.ceil(end * sampleRate)),
        sampleRate,
      );
      if (!audio) {
        vectors.push(null);
        post({ type: "progress", done: i + 1, total: ranges.length });
        continue;
      }
      const inputs = (await processor(audio)) as Record<string, Tensor>;
      const out = (await model(inputs)) as { last_hidden_state: Tensor };
      const v = Float32Array.from(out.last_hidden_state.data as Float32Array);
      let norm = 0;
      for (const x of v) norm += x * x;
      norm = Math.sqrt(norm) || 1;
      for (let k = 0; k < v.length; k++) v[k]! /= norm;
      vectors.push(v);
      post({ type: "progress", done: i + 1, total: ranges.length });
    }
    post(
      { type: "result", vectors },
      vectors.flatMap((v) => (v ? [v.buffer] : [])),
    );
  } catch (err) {
    console.error(err);
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
