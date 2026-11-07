import { createContext, useContext } from "react";

export type NotesStage = "loading" | "map" | "reduce" | "done" | "error" | "cancelled";

export interface NotesJob {
  lectureId: string;
  stage: NotesStage;
  /** Model download/compile progress, 0–1. */
  loadProgress: number;
  loadText: string;
  done: number;
  total: number;
  etaMs?: number;
  ms?: number;
  error?: string;
}

export interface NotesApi {
  notesJob: NotesJob | null;
  notesBusy: boolean;
  /** Generate (or regenerate) notes for a lecture from its saved transcript. */
  startNotes: (lectureId: string) => Promise<void>;
  cancelNotes: () => void;
}

export const NotesContext = createContext<NotesApi | null>(null);

export function useNotes(): NotesApi {
  const api = useContext(NotesContext);
  if (!api) throw new Error("useNotes must be used inside <NotesProvider>");
  return api;
}

export const isNotesBusy = (j: NotesJob | null) =>
  j !== null && (j.stage === "loading" || j.stage === "map" || j.stage === "reduce");
