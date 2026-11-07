import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TARGET_SAMPLE_RATE } from "@/lib/audio";
import { appendSegments, attachMedia, createRecordingLecture, db } from "@/lib/db";
import { getEmbedder } from "@/lib/embed-client";
import { probeWebGpu } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { LiveSegmenter, type LiveChunk } from "@/lib/live-segmenter";
import { rms, startMic } from "@/lib/mic";
import { WAVEFORM_BUCKETS } from "@/lib/pcm";
import { RecordingBuffer } from "@/lib/recording";
import { indexLecture } from "@/lib/search-index";
import { estimateStorage, mediaFits, requestPersistence } from "@/lib/storage";
import { getWhisperClient } from "@/lib/whisper-client";
import type { Segment } from "@/types/transcript";
import { resolveDevice, resolveModel, useJob, withLectureLock } from "./job";
import { isLiveBusy, LiveContext, type LiveSession } from "./live";
import { useNotes } from "./notes";
import { getSettings } from "./settings";

const SR = TARGET_SAMPLE_RATE;

function recordingNames(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  return {
    title: `Live recording, ${now.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
    fileName: `Recording ${stamp}.wav`,
  };
}

/**
 * Live microphone mode: audio is cut into chunks at pauses (LiveSegmenter) and
 * each chunk is transcribed as soon as it's ready, so the transcript fills in
 * a few seconds behind the speaker. On Stop the recording is saved as WAV and
 * the lecture goes through the same indexing (and optional notes) as a file.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { busy: jobBusy } = useJob();
  const { startNotes } = useNotes();
  const [session, setSession] = useState<LiveSession | null>(null);
  const running = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);

  const startLive = useCallback(async () => {
    if (running.current) throw new Error("A recording is already running.");
    if (jobBusy) throw new Error("Wait for the current transcription to finish first.");
    running.current = true;
    try {
      return await begin();
    } catch (e) {
      running.current = false;
      throw e;
    }

    async function begin(): Promise<string> {
      const gpu = await probeWebGpu();
      const settings = getSettings();
      const device = resolveDevice(gpu.webgpu);
      const model = resolveModel(settings.model, device, gpu);
      const whisper = getWhisperClient();
      const segmenter = new LiveSegmenter(SR);
      const recording = new RecordingBuffer(SR);

      let id = "";
      const update = (fn: (s: LiveSession) => LiveSession) =>
        setSession((s) => (s && s.lectureId === id ? fn(s) : s));

      let stop!: () => void;
      const stopped = new Promise<void>((r) => (stop = r));
      let failed: unknown = null;
      let transcribedUntil = 0;
      let previousText = "";
      let transcribeMs = 0;

      const loadP = whisper.load(model, device, gpu.f16, (loaded, total) =>
        update((s) => ({ ...s, load: { done: false, loaded, total } })),
      );
      loadP.then(
        () => update((s) => ({ ...s, load: { done: true, loaded: 0, total: 0 } })),
        () => undefined, // reported by the first chunk
      );

      // Chunks are transcribed one at a time, in order, once the lecture exists.
      let markReady!: () => void;
      let queue = new Promise<void>((r) => (markReady = r));
      const enqueue = (chunk: LiveChunk) => {
        queue = queue.then(async () => {
          if (failed) return;
          try {
            await loadP;
            const t0 = performance.now();
            const segments: Segment[] = [];
            const { promise } = whisper.transcribe(
              chunk.pcm,
              SR,
              { onProgress: (_d, _t, segs) => segments.push(...segs) },
              { offsetSec: chunk.startSec, previousText },
            );
            await promise;
            transcribeMs += performance.now() - t0;
            await appendSegments(id, segments);
            previousText = segments.at(-1)?.text ?? previousText;
            transcribedUntil = chunk.startSec + chunk.pcm.length / SR;
            update((s) => ({
              ...s,
              behindSec: Math.max(0, recording.durationSec - transcribedUntil),
            }));
          } catch (e) {
            console.error(e);
            failed = e;
            stop();
          }
        });
      };

      const mic = await startMic(
        SR,
        (pcm) => {
          recording.push(pcm);
          for (const c of segmenter.push(pcm)) enqueue(c);
          update((s) => ({
            ...s,
            elapsedSec: recording.durationSec,
            level: rms(pcm),
            behindSec: Math.max(0, recording.durationSec - transcribedUntil),
          }));
        },
        () => stop(),
      );

      try {
        const names = recordingNames();
        id = (await createRecordingLecture({ ...names, model, device })).id;
      } catch (e) {
        mic.stop();
        throw e;
      }
      void requestPersistence();
      setSession({
        lectureId: id,
        stage: "recording",
        elapsedSec: recording.durationSec,
        behindSec: recording.durationSec,
        level: 0,
        micLabel: mic.label,
        load: { done: false, loaded: 0, total: 0 },
      });
      markReady();
      stopRef.current = stop;

      void withLectureLock(id, async () => {
        await stopped;
        mic.stop();
        stopRef.current = null;
        update((s) => ({ ...s, stage: "finishing", finishing: "transcribing", level: 0 }));
        const last = segmenter.flush();
        if (last) enqueue(last);
        await queue;
        if (failed) {
          const error = errorMessage(failed);
          await db.lectures.update(id, { status: "error", error });
          update((s) => ({ ...s, stage: "error", error }));
          return;
        }

        update((s) => ({ ...s, finishing: "saving", behindSec: 0 }));
        const wav = recording.toWav();
        let mediaSkipped = !getSettings().keepMedia;
        if (!mediaSkipped) {
          if (mediaFits(wav.size, await estimateStorage())) {
            await attachMedia(id, wav).catch((e: unknown) => {
              console.warn("Saving the recording failed", e);
              mediaSkipped = true;
            });
          } else mediaSkipped = true;
        }
        await db.lectures.update(id, {
          status: "done",
          durationSec: recording.durationSec,
          peaks: recording.peaks(WAVEFORM_BUCKETS),
          fileSize: wav.size,
          transcribeMs: Math.round(transcribeMs),
        });

        update((s) => ({ ...s, finishing: "indexing", mediaSkipped }));
        try {
          await indexLecture(id, getEmbedder());
        } catch (e) {
          console.error(e); // the Search tab offers to retry
        }
        update((s) => ({ ...s, stage: "done" }));
        if (getSettings().autoNotes) void startNotes(id);
      })
        .catch((e: unknown) => {
          console.error(e);
          void db.lectures.update(id, { status: "error", error: errorMessage(e) });
          update((s) => ({ ...s, stage: "error", error: errorMessage(e) }));
        })
        .finally(() => {
          running.current = false;
        });
      return id;
    }
  }, [jobBusy, startNotes]);

  const stopLive = useCallback(() => stopRef.current?.(), []);
  const liveBusy = isLiveBusy(session);

  // Closing the tab mid-recording loses the audio not yet saved: ask first.
  useEffect(() => {
    if (session?.stage !== "recording") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [session?.stage]);

  const api = useMemo(
    () => ({ session, liveBusy, startLive, stopLive }),
    [session, liveBusy, startLive, stopLive],
  );
  return <LiveContext.Provider value={api}>{children}</LiveContext.Provider>;
}
