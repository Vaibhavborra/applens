import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { getSegments, saveNotes } from "@/lib/db";
import { probeWebGpu } from "@/lib/env";
import type { WebLlmNotes } from "@/lib/llm-client";
import { deviceLostMessage, isGpuDeviceLost } from "@/lib/llm-errors";
import { mlcModelId } from "@/lib/llm-models";
import { NotesCancelled, runNotes } from "@/lib/notes/run";
import { isNotesBusy, NotesContext, type NotesJob } from "./notes";
import { getSettings } from "./settings";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs one notes job at a time; the WebLLM engine (and loaded model) is reused. */
export function NotesProvider({ children }: { children: ReactNode }) {
  const llm = useRef<WebLlmNotes | null>(null);
  const cancelled = useRef(false);
  const running = useRef(false);
  const [notesJob, setNotesJob] = useState<NotesJob | null>(null);

  const startNotes = useCallback(async (lectureId: string) => {
    if (running.current) return;
    running.current = true;
    cancelled.current = false;
    const update = (patch: Partial<NotesJob>) =>
      setNotesJob((j) => (j && j.lectureId === lectureId ? { ...j, ...patch } : j));
    setNotesJob({ lectureId, stage: "loading", loadProgress: 0, loadText: "", done: 0, total: 0 });

    const t0 = performance.now();
    try {
      const gpu = await probeWebGpu();
      if (!gpu.webgpu) {
        throw new Error(
          "AI notes need WebGPU (Chrome or Edge 113+, or Safari 26+). Your transcript is still available.",
        );
      }
      const segments = await getSegments(lectureId);
      const mlcId = mlcModelId(getSettings().notesModel, gpu.f16);

      // WebLLM is ~6 MB of JS: load it only when notes are actually requested.
      if (!llm.current) {
        const { WebLlmNotes } = await import("@/lib/llm-client");
        llm.current = new WebLlmNotes();
      }
      await llm.current.load(mlcId, ({ progress, text }) =>
        update({ loadProgress: progress, loadText: text }),
      );
      if (cancelled.current) throw new NotesCancelled();

      let mapStarted = 0;
      const notes = await runNotes(segments, llm.current, {
        isCancelled: () => cancelled.current,
        onProgress: (p) => {
          if (p.stage === "reduce") {
            update({ stage: "reduce" });
            return;
          }
          if (p.done === 0) mapStarted = performance.now();
          const elapsed = performance.now() - mapStarted;
          update({
            stage: "map",
            done: p.done,
            total: p.total,
            ...(p.done > 0 ? { etaMs: (elapsed / p.done) * (p.total - p.done) } : {}),
          });
        },
      });
      const ms = Math.round(performance.now() - t0);
      await saveNotes(lectureId, notes, { model: mlcId, ms, fallbackParts: notes.fallbackParts });
      update({ stage: "done", ms });
    } catch (e) {
      if (e instanceof NotesCancelled || cancelled.current) update({ stage: "cancelled" });
      else if (isGpuDeviceLost(e)) {
        console.error(e);
        // The engine is unusable after a device loss; start fresh next time.
        llm.current?.dispose();
        llm.current = null;
        update({ stage: "error", error: deviceLostMessage((await probeWebGpu()).name ?? null) });
      } else {
        console.error(e);
        update({ stage: "error", error: errMsg(e) });
      }
    } finally {
      running.current = false;
    }
  }, []);

  const cancelNotes = useCallback(() => {
    cancelled.current = true;
    llm.current?.interrupt();
  }, []);

  const api = useMemo(
    () => ({ notesJob, notesBusy: isNotesBusy(notesJob), startNotes, cancelNotes }),
    [notesJob, startNotes, cancelNotes],
  );
  return <NotesContext.Provider value={api}>{children}</NotesContext.Provider>;
}
