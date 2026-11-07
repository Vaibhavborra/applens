import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { decodeMediaFile, TARGET_SAMPLE_RATE, type DecodedAudio } from "@/lib/audio";
import { appendSegments, createLecture, db, resetTranscript } from "@/lib/db";
import { probeWebGpu } from "@/lib/env";
import type { Device, ModelId } from "@/lib/models";
import { computePeaks, WAVEFORM_BUCKETS } from "@/lib/pcm";
import { estimateStorage, mediaFits, requestPersistence } from "@/lib/storage";
import { WhisperClient } from "@/lib/whisper-client";
import { JobContext, lectureLockName, resolveDevice, resolveModel, type Job } from "./job";
import { useNotes } from "./notes";
import { getSettings } from "./settings";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Hold a Web Lock for the job's lifetime so other tabs know it's still running. */
function withLectureLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? locks.request(lectureLockName(id), fn) : fn();
}

export function JobProvider({ children }: { children: ReactNode }) {
  const client = useRef<WhisperClient | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const { startNotes } = useNotes();

  const start = useCallback(
    async (file: File, existingLectureId?: string) => {
      const gpu = await probeWebGpu();
      const settings = getSettings();
      const device = resolveDevice(gpu.webgpu);
      const model = resolveModel(settings.model, device, gpu);

      let keepMedia = settings.keepMedia && !existingLectureId; // re-runs reuse stored media
      let mediaSkipped = false;
      if (keepMedia && !mediaFits(file.size, await estimateStorage())) {
        keepMedia = false;
        mediaSkipped = true;
      }

      let lectureId: string;
      if (existingLectureId) {
        await resetTranscript(existingLectureId);
        await db.lectures.update(existingLectureId, { model, device });
        lectureId = existingLectureId;
      } else {
        try {
          lectureId = (await createLecture(file, { keepMedia, model, device })).id;
        } catch (e) {
          // Most likely QuotaExceededError on the media blob: retry without it.
          if (!keepMedia) throw e;
          console.warn("Saving media failed, continuing without it", e);
          mediaSkipped = true;
          lectureId = (await createLecture(file, { keepMedia: false, model, device })).id;
        }
        void requestPersistence();
      }

      setJob({
        lectureId,
        file,
        mediaSkipped,
        decode: { status: "active" },
        load: { status: "active", loaded: 0, total: 0 },
        transcribe: { status: "pending", done: 0, total: 0 },
      });

      void withLectureLock(lectureId, () =>
        run(lectureId, file, model, device, gpu.f16).catch((e: unknown) => {
          console.error(e);
          void db.lectures.update(lectureId, { status: "error", error: errMsg(e) });
        }),
      );
      return lectureId;

      async function run(id: string, f: File, m: ModelId, d: Device, f16: boolean) {
        client.current ??= new WhisperClient();
        const whisper = client.current;
        const update = (fn: (j: Job) => Job) =>
          setJob((j) => (j && j.lectureId === id ? fn(j) : j));

        const loadP = whisper.load(m, d, f16, (loaded, total) =>
          update((j) => ({ ...j, load: { ...j.load, loaded, total } })),
        );
        loadP.then(
          (info) => update((j) => ({ ...j, load: { ...j.load, status: "done", info } })),
          (e: unknown) =>
            update((j) => ({ ...j, load: { ...j.load, status: "error", error: errMsg(e) } })),
        );

        let audio: DecodedAudio;
        try {
          audio = await decodeMediaFile(f, (progress) =>
            update((j) => ({ ...j, decode: { ...j.decode, progress } })),
          );
        } catch (e) {
          update((j) => ({ ...j, decode: { status: "error", error: errMsg(e) } }));
          await db.lectures.update(id, { status: "error", error: errMsg(e) });
          return;
        }
        update((j) => ({ ...j, decode: { status: "done", audio } }));
        await db.lectures.update(id, {
          durationSec: audio.durationSec,
          peaks: computePeaks(audio.pcm, WAVEFORM_BUCKETS),
        });

        try {
          await loadP;
        } catch (e) {
          await db.lectures.update(id, { status: "error", error: errMsg(e) });
          return;
        }

        const startedAt = performance.now();
        update((j) => ({ ...j, transcribe: { ...j.transcribe, status: "active" } }));
        // Serialise writes so segments land in order and all are flushed before "done".
        let writes = Promise.resolve();
        const { promise, cancel } = whisper.transcribe(audio.pcm, TARGET_SAMPLE_RATE, {
          onProgress: (done, total, segments) => {
            writes = writes.then(() => appendSegments(id, segments));
            const elapsed = performance.now() - startedAt;
            update((j) => ({
              ...j,
              transcribe: {
                ...j.transcribe,
                done,
                total,
                etaMs: (elapsed / done) * (total - done),
              },
            }));
          },
        });
        cancelRef.current = cancel;
        try {
          const { cancelled, ms } = await promise;
          await writes;
          await db.lectures.update(id, {
            status: cancelled ? "cancelled" : "done",
            transcribeMs: ms,
          });
          update((j) => ({
            ...j,
            transcribe: { ...j.transcribe, status: cancelled ? "error" : "done", ms, cancelled },
          }));
          if (!cancelled && getSettings().autoNotes) void startNotes(id);
        } catch (e) {
          await writes.catch(() => undefined);
          await db.lectures.update(id, { status: "error", error: errMsg(e) });
          update((j) => ({
            ...j,
            transcribe: { ...j.transcribe, status: "error", error: errMsg(e) },
          }));
        } finally {
          cancelRef.current = null;
        }
      }
    },
    [startNotes],
  );

  const cancel = useCallback(() => cancelRef.current?.(), []);

  const busy =
    job !== null &&
    (job.decode.status === "active" ||
      job.load.status === "active" ||
      job.transcribe.status === "active" ||
      (job.decode.status === "done" &&
        job.load.status === "done" &&
        job.transcribe.status === "pending"));

  const api = useMemo(() => ({ job, busy, start, cancel }), [job, busy, start, cancel]);
  return <JobContext.Provider value={api}>{children}</JobContext.Provider>;
}
