/// <reference lib="webworker" />
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";
import { EMBED_DIMS, EMBED_MODEL, type EmbedRequest, type EmbedResponse } from "./embed.protocol";

declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false;

const post = (msg: EmbedResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let extractor: Promise<FeatureExtractionPipeline> | null = null;

/**
 * MiniLM is small (23 MB q8) and fast on the CPU, so it runs on WASM: no
 * WebGPU contention with Whisper/WebLLM, and it works on GPUs that can't run
 * the notes model.
 */
function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= pipeline("feature-extraction", EMBED_MODEL, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (p: ProgressInfo) => {
      if (p.status === "progress_total")
        post({ type: "load-progress", loaded: p.loaded, total: p.total });
    },
  }).catch((e: unknown) => {
    extractor = null;
    throw e;
  }) as Promise<FeatureExtractionPipeline>;
  return extractor;
}

let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<EmbedRequest>) => {
  const { id, texts } = e.data;
  queue = queue.then(async () => {
    try {
      const fx = await getExtractor();
      const out = await fx(texts, { pooling: "mean", normalize: true });
      const data = out.data as Float32Array;
      const vectors = texts.map((_, i) => data.slice(i * EMBED_DIMS, (i + 1) * EMBED_DIMS));
      post(
        { type: "result", id, vectors },
        vectors.map((v) => v.buffer),
      );
    } catch (err) {
      post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
