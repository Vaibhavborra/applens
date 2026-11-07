import { createContext, useContext } from "react";
import type { StepStatus } from "@/components/Steps";
import type { DecodedAudio, DecodeProgress } from "@/lib/audio";
import { forcedDevice } from "@/lib/env";
import { getModel, pickVariant, type Device, type ModelId } from "@/lib/models";
import type { ReadyInfo } from "@/workers/whisper.protocol";

export interface Job {
  lectureId: string;
  file: File;
  /** Media wasn't saved because it wouldn't fit in browser storage. */
  mediaSkipped: boolean;
  decode: { status: StepStatus; progress?: DecodeProgress; audio?: DecodedAudio; error?: string };
  load: { status: StepStatus; loaded: number; total: number; info?: ReadyInfo; error?: string };
  transcribe: {
    status: StepStatus;
    done: number;
    total: number;
    /** Estimated ms remaining, updated per window. */
    etaMs?: number;
    ms?: number;
    cancelled?: boolean;
    error?: string;
  };
  /** Embedding passages for semantic search (after transcription). */
  index: { status: StepStatus; done: number; total: number; error?: string };
}

export interface JobApi {
  job: Job | null;
  busy: boolean;
  /**
   * Create (or reset) a lecture and start processing it. Resolves with the
   * lecture id as soon as it's saved; processing continues in the background.
   */
  start: (file: File, existingLectureId?: string) => Promise<string>;
  cancel: () => void;
}

export const JobContext = createContext<JobApi | null>(null);

export function useJob(): JobApi {
  const api = useContext(JobContext);
  if (!api) throw new Error("useJob must be used inside <JobProvider>");
  return api;
}

export const lectureLockName = (id: string) => `lna-lecture:${id}`;

/** Hold a Web Lock for the job's lifetime so other tabs know it's still running. */
export function withLectureLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? locks.request(lectureLockName(id), fn) : fn();
}

export function resolveDevice(webgpu: boolean): Device {
  return forcedDevice() ?? (webgpu ? "webgpu" : "wasm");
}

/** Fall back if the chosen model can't run here (e.g. "best" without WebGPU). */
export function resolveModel(
  model: ModelId,
  device: Device,
  gpu: { webgpu: boolean; f16: boolean },
): ModelId {
  return pickVariant(getModel(model), device, gpu) ? model : "fast";
}
