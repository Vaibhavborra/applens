import { useCallback, useRef, useState } from "react";
import {
  decodeMediaFile,
  TARGET_SAMPLE_RATE,
  type DecodedAudio,
  type DecodeProgress,
} from "@/lib/audio";
import type { Device, ModelId } from "@/lib/models";
import { WhisperClient } from "@/lib/whisper-client";
import type { Segment } from "@/types/transcript";
import type { ReadyInfo } from "@/workers/whisper.protocol";
import type { StepStatus } from "@/components/Steps";

export interface Job {
  id: number;
  file: File;
  decode: { status: StepStatus; progress?: DecodeProgress; audio?: DecodedAudio; error?: string };
  load: { status: StepStatus; loaded: number; total: number; info?: ReadyInfo; error?: string };
  transcribe: {
    status: StepStatus;
    done: number;
    total: number;
    startedAt?: number;
    /** Estimated ms remaining, updated per window. */
    etaMs?: number;
    ms?: number;
    cancelled?: boolean;
    error?: string;
  };
  segments: Segment[];
}

export interface StartOptions {
  model: ModelId;
  device: Device;
  f16: boolean;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Runs decode and model load in parallel, then streams transcription.
 * One job at a time; the Whisper worker (and loaded model) is reused.
 */
export function useTranscriptionJob() {
  const client = useRef<WhisperClient | null>(null);
  const counter = useRef(0);
  const cancelRef = useRef<(() => void) | null>(null);
  const [job, setJob] = useState<Job | null>(null);

  const start = useCallback(async (file: File, opts: StartOptions) => {
    client.current ??= new WhisperClient();
    const whisper = client.current;
    const id = ++counter.current;
    const update = (fn: (j: Job) => Job) => setJob((j) => (j && j.id === id ? fn(j) : j));

    setJob({
      id,
      file,
      decode: { status: "active" },
      load: { status: "active", loaded: 0, total: 0 },
      transcribe: { status: "pending", done: 0, total: 0 },
      segments: [],
    });

    const loadP = whisper.load(opts.model, opts.device, opts.f16, (loaded, total) =>
      update((j) => ({ ...j, load: { ...j.load, loaded, total } })),
    );
    loadP.then(
      (info) => update((j) => ({ ...j, load: { ...j.load, status: "done", info } })),
      (e: unknown) =>
        update((j) => ({ ...j, load: { ...j.load, status: "error", error: errMsg(e) } })),
    );

    let audio: DecodedAudio;
    try {
      audio = await decodeMediaFile(file, (progress) =>
        update((j) => ({ ...j, decode: { ...j.decode, progress } })),
      );
      update((j) => ({ ...j, decode: { status: "done", audio } }));
    } catch (e) {
      console.error(e);
      update((j) => ({ ...j, decode: { status: "error", error: errMsg(e) } }));
      return;
    }

    try {
      await loadP;
    } catch {
      return; // already reflected in state
    }

    const startedAt = performance.now();
    update((j) => ({ ...j, transcribe: { ...j.transcribe, status: "active", startedAt } }));
    const { promise, cancel } = whisper.transcribe(audio.pcm, TARGET_SAMPLE_RATE, {
      onProgress: (done, total, newSegments) =>
        update((j) => {
          const elapsed = performance.now() - startedAt;
          return {
            ...j,
            segments: newSegments.length ? [...j.segments, ...newSegments] : j.segments,
            transcribe: {
              ...j.transcribe,
              done,
              total,
              etaMs: (elapsed / done) * (total - done),
            },
          };
        }),
    });
    cancelRef.current = cancel;
    try {
      const { cancelled, ms } = await promise;
      update((j) => ({
        ...j,
        transcribe: { ...j.transcribe, status: cancelled ? "error" : "done", ms, cancelled },
      }));
    } catch (e) {
      console.error(e);
      update((j) => ({ ...j, transcribe: { ...j.transcribe, status: "error", error: errMsg(e) } }));
    } finally {
      cancelRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => cancelRef.current?.(), []);

  const busy =
    job !== null &&
    (job.decode.status === "active" ||
      job.load.status === "active" ||
      job.transcribe.status === "active" ||
      (job.decode.status === "done" &&
        job.load.status === "done" &&
        job.transcribe.status === "pending"));

  return { job, start, cancel, busy };
}
