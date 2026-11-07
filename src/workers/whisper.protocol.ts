import type { Device, ModelId } from "@/lib/models";
import type { Segment } from "@/types/transcript";

export type WhisperRequest =
  | { type: "load"; model: ModelId; device: Device; f16: boolean }
  | { type: "transcribe"; jobId: number; pcm: Float32Array; sampleRate: number }
  | { type: "cancel"; jobId: number };

export interface ReadyInfo {
  model: ModelId;
  device: Device;
  dtype: string;
  loadMs: number;
}

export type WhisperResponse =
  | { type: "load-progress"; loaded: number; total: number }
  | ({ type: "ready" } & ReadyInfo)
  | {
      type: "progress";
      jobId: number;
      /** Windows finished / total. */
      done: number;
      total: number;
      /** Segments from the window that just finished, in absolute seconds. */
      segments: Segment[];
    }
  | { type: "result"; jobId: number; cancelled: boolean; ms: number }
  | { type: "error"; jobId?: number; message: string };
