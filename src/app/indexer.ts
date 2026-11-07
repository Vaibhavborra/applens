import { useSyncExternalStore } from "react";
import { errorMessage } from "@/lib/errors";
import { getEmbedder } from "@/lib/embed-client";
import { indexLecture } from "@/lib/search-index";

/**
 * On-demand search indexing for lectures that weren't indexed during
 * transcription (older lectures, or a failed step). Module-level so progress
 * survives tab switches and a lecture is never indexed twice at once.
 */
export type IndexStatus =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number; loaded: number; loadTotal: number }
  | { kind: "error"; message: string }
  /** Finished in this tab; stays set so a lagging live query can't trigger a second run. */
  | { kind: "done" };

const IDLE: IndexStatus = { kind: "idle" };
const DONE: IndexStatus = { kind: "done" };
const states = new Map<string, IndexStatus>();
const listeners = new Set<() => void>();

function set(id: string, s: IndexStatus) {
  if (s.kind === "idle") states.delete(id);
  else states.set(id, s);
  for (const l of listeners) l();
}

export function startIndexing(lectureId: string): void {
  if (states.get(lectureId)?.kind === "running") return;
  // A finished lecture can be re-indexed later (e.g. after re-transcription).
  const embedder = getEmbedder();
  let progress = { done: 0, total: 0, loaded: 0, loadTotal: 0 };
  const report = (patch: Partial<typeof progress>) => {
    progress = { ...progress, ...patch };
    set(lectureId, { kind: "running", ...progress });
  };
  report({});
  const off = embedder.onLoadProgress((loaded, loadTotal) => report({ loaded, loadTotal }));
  indexLecture(lectureId, embedder, (done, total) => report({ done, total }))
    .then(
      () => set(lectureId, DONE),
      (e: unknown) => set(lectureId, { kind: "error", message: errorMessage(e) }),
    )
    .finally(off);
}

export function useIndexStatus(lectureId: string): IndexStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => states.get(lectureId) ?? IDLE,
  );
}
