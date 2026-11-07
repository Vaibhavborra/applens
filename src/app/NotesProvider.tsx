import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/errors";
import { getSegments, saveNotes } from "@/lib/db";
import { probeWebGpu } from "@/lib/env";
import type { WebLlmNotes } from "@/lib/llm-client";
import { deviceLostMessage, isGpuDeviceLost } from "@/lib/llm-errors";
import { mlcModelId } from "@/lib/llm-models";
import { NotesCancelled, runNotes, type NotesLLM } from "@/lib/notes/run";
import { OllamaNotes } from "@/lib/ollama";
import { isNotesBusy, NotesContext, type NotesJob } from "./notes";
import { getSettings } from "./settings";

const errMsg = errorMessage;

/**
 * Runs one notes job at a time, in the browser (WebLLM; the engine and loaded
 * model are reused) or through a local Ollama server, per settings.
 */
export function NotesProvider({ children }: { children: ReactNode }) {
  const llm = useRef<WebLlmNotes | null>(null);
  const ollama = useRef<OllamaNotes | null>(null);
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
      const settings = getSettings();
      const segments = await getSegments(lectureId);
      let engine: NotesLLM;
      let modelName: string;
      if (settings.notesEngine === "ollama") {
        const o = new OllamaNotes(settings.ollamaUrl, settings.ollamaModel);
        ollama.current = o;
        await o.check();
        engine = o;
        modelName = `ollama:${o.model}`;
        update({ loadProgress: 1 });
      } else {
        const gpu = await probeWebGpu();
        if (!gpu.webgpu) {
          throw new Error(
            "In-browser AI notes need WebGPU (Chrome or Edge 113+, or Safari 26+). You can use Ollama instead. Your transcript is still available.",
          );
        }
        modelName = mlcModelId(settings.notesModel, gpu.f16);
        // WebLLM is ~6 MB of JS: load it only when notes are actually requested.
        if (!llm.current) {
          const { WebLlmNotes } = await import("@/lib/llm-client");
          llm.current = new WebLlmNotes();
        }
        await llm.current.load(modelName, ({ progress, text }) =>
          update({ loadProgress: progress, loadText: text }),
        );
        engine = llm.current;
      }
      if (cancelled.current) throw new NotesCancelled();

      let mapStarted = 0;
      const notes = await runNotes(segments, engine, {
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
      await saveNotes(lectureId, notes, {
        model: modelName,
        ms,
        fallbackParts: notes.fallbackParts,
      });
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
      ollama.current = null;
      running.current = false;
    }
  }, []);

  const cancelNotes = useCallback(() => {
    cancelled.current = true;
    llm.current?.interrupt();
    ollama.current?.interrupt();
  }, []);

  const api = useMemo(
    () => ({ notesJob, notesBusy: isNotesBusy(notesJob), startNotes, cancelNotes }),
    [notesJob, startNotes, cancelNotes],
  );
  return <NotesContext.Provider value={api}>{children}</NotesContext.Provider>;
}
