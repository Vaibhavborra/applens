import type { ReadyInfo, WhisperRequest, WhisperResponse } from "@/workers/whisper.protocol";
import type { Segment } from "@/types/transcript";
import type { Device, ModelId } from "./models";

export interface TranscribeHandlers {
  onProgress: (done: number, total: number, newSegments: Segment[]) => void;
}

export interface TranscribeResult {
  cancelled: boolean;
  ms: number;
}

interface LoadWaiter {
  resolve: (r: ReadyInfo) => void;
  reject: (e: Error) => void;
  onProgress: (loaded: number, total: number) => void;
}

interface Job extends TranscribeHandlers {
  resolve: (r: TranscribeResult) => void;
  reject: (e: Error) => void;
}

/** Main-thread handle on the Whisper worker. The worker (and its loaded model) is reused across files. */
export class WhisperClient {
  private worker: Worker | null = null;
  private nextJob = 1;
  private loadWaiter: LoadWaiter | null = null;
  private jobs = new Map<number, Job>();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (e: MessageEvent<WhisperResponse>) => this.handle(e.data);
      this.worker.onerror = (e) => this.failAll(new Error(e.message || "Whisper worker crashed"));
    }
    return this.worker;
  }

  private send(msg: WhisperRequest, transfer: Transferable[] = []) {
    this.getWorker().postMessage(msg, transfer);
  }

  load(
    model: ModelId,
    device: Device,
    f16: boolean,
    onProgress: (loaded: number, total: number) => void,
  ): Promise<ReadyInfo> {
    this.loadWaiter?.reject(new Error("Superseded by another model load"));
    return new Promise((resolve, reject) => {
      this.loadWaiter = { resolve, reject, onProgress };
      this.send({ type: "load", model, device, f16 });
    });
  }

  /** The PCM is copied, so the caller keeps its buffer for playback/waveform. */
  transcribe(
    pcm: Float32Array,
    sampleRate: number,
    handlers: TranscribeHandlers,
    live: { offsetSec: number; previousText: string } | null = null,
  ): { promise: Promise<TranscribeResult>; cancel: () => void } {
    const jobId = this.nextJob++;
    const copy = pcm.slice();
    const promise = new Promise<TranscribeResult>((resolve, reject) => {
      this.jobs.set(jobId, { ...handlers, resolve, reject });
      this.send({ type: "transcribe", jobId, pcm: copy, sampleRate, ...live }, [copy.buffer]);
    });
    return { promise, cancel: () => this.send({ type: "cancel", jobId }) };
  }

  private handle(msg: WhisperResponse) {
    switch (msg.type) {
      case "load-progress":
        this.loadWaiter?.onProgress(msg.loaded, msg.total);
        break;
      case "ready":
        this.loadWaiter?.resolve({
          model: msg.model,
          device: msg.device,
          dtype: msg.dtype,
          loadMs: msg.loadMs,
        });
        this.loadWaiter = null;
        break;
      case "progress":
        this.jobs.get(msg.jobId)?.onProgress(msg.done, msg.total, msg.segments);
        break;
      case "result":
        this.jobs.get(msg.jobId)?.resolve({ cancelled: msg.cancelled, ms: msg.ms });
        this.jobs.delete(msg.jobId);
        break;
      case "error": {
        const err = new Error(msg.message);
        if (msg.jobId !== undefined) {
          this.jobs.get(msg.jobId)?.reject(err);
          this.jobs.delete(msg.jobId);
        } else {
          this.loadWaiter?.reject(err);
          this.loadWaiter = null;
        }
        break;
      }
    }
  }

  private failAll(err: Error) {
    this.loadWaiter?.reject(err);
    this.loadWaiter = null;
    for (const j of this.jobs.values()) j.reject(err);
    this.jobs.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}

let shared: WhisperClient | null = null;

/** One worker (and loaded model) for the whole app: file jobs and live recording share it. */
export function getWhisperClient(): WhisperClient {
  return (shared ??= new WhisperClient());
}
