/// <reference lib="webworker" />
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";
import { isSilent, planWindows } from "@/lib/chunking";
import { getModel, pickVariant, type Device, type ModelId } from "@/lib/models";
import { cleanSegments } from "@/lib/segments";
import type { Segment } from "@/types/transcript";
import type { WhisperRequest, WhisperResponse } from "./whisper.protocol";

declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false; // always fetch from the Hub (cached in Cache Storage)

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey = "";
let cancelledJob = -1;

const post = (msg: WhisperResponse) => self.postMessage(msg);

async function load(model: ModelId, device: Device, f16: boolean) {
  const spec = getModel(model);
  const variant = pickVariant(spec, device, { webgpu: device === "webgpu", f16 });
  if (!variant)
    throw new Error(`${spec.label} needs WebGPU, which isn't available in this browser.`);

  const key = `${spec.repo}|${device}|${JSON.stringify(variant.dtype)}`;
  const dtypeLabel = `${variant.dtype.encoder_model}/${variant.dtype.decoder_model_merged}`;
  if (asr && key === loadedKey) {
    post({ type: "ready", model, device, dtype: dtypeLabel, loadMs: 0 });
    return;
  }
  if (asr) {
    await asr.dispose();
    asr = null;
    loadedKey = "";
  }

  const t0 = performance.now();
  const created = await pipeline("automatic-speech-recognition", spec.repo, {
    device,
    // Our config uses plain strings; Transformers.js validates them at runtime.
    dtype: variant.dtype as never,
    progress_callback: (p: ProgressInfo) => {
      if (p.status === "progress_total") {
        post({ type: "load-progress", loaded: p.loaded, total: p.total });
      }
    },
  });
  asr = created as AutomaticSpeechRecognitionPipeline;
  loadedKey = key;

  // Warm-up compiles WebGPU shaders now rather than on the first real window.
  await asr(new Float32Array(16_000), { return_timestamps: true });

  post({
    type: "ready",
    model,
    device,
    dtype: dtypeLabel,
    loadMs: Math.round(performance.now() - t0),
  });
}

async function transcribe(
  jobId: number,
  pcm: Float32Array,
  sampleRate: number,
  offsetSec = 0,
  initialText = "",
) {
  if (!asr) throw new Error("Model not loaded");
  const t0 = performance.now();
  const windows = planWindows(pcm, sampleRate);
  let previousText = initialText;

  for (let i = 0; i < windows.length; i++) {
    if (cancelledJob === jobId) {
      post({ type: "result", jobId, cancelled: true, ms: Math.round(performance.now() - t0) });
      return;
    }
    const w = windows[i]!;
    const offset = w.start / sampleRate;
    const windowEnd = w.end / sampleRate;
    let segments: Segment[] = [];

    if (!isSilent(pcm, w)) {
      const out = await asr(pcm.subarray(w.start, w.end), { return_timestamps: true });
      const result = Array.isArray(out) ? out[0] : out;
      for (const c of result?.chunks ?? []) {
        const text = c.text.trim();
        if (!text) continue;
        const [s, e] = c.timestamp as [number | null, number | null];
        const start = Math.min(offset + (s ?? 0), windowEnd);
        // The last chunk's end is null when speech runs to the window edge.
        const end = Math.min(e === null ? windowEnd : offset + e, windowEnd);
        segments.push({ start, end: Math.max(start, end), text });
      }
      segments = cleanSegments(segments, pcm, sampleRate, previousText);
      previousText = segments.at(-1)?.text ?? previousText;
    }
    if (offsetSec) {
      segments = segments.map((s) => ({
        ...s,
        start: s.start + offsetSec,
        end: s.end + offsetSec,
      }));
    }
    post({ type: "progress", jobId, done: i + 1, total: windows.length, segments });
  }
  post({ type: "result", jobId, cancelled: false, ms: Math.round(performance.now() - t0) });
}

// Serialise load/transcribe; handle cancel immediately so it's seen between windows.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<WhisperRequest>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelledJob = msg.jobId;
    return;
  }
  queue = queue.then(async () => {
    try {
      if (msg.type === "load") await load(msg.model, msg.device, msg.f16);
      else await transcribe(msg.jobId, msg.pcm, msg.sampleRate, msg.offsetSec, msg.previousText);
    } catch (err) {
      console.error(err);
      post({
        type: "error",
        ...(msg.type === "transcribe" ? { jobId: msg.jobId } : {}),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
