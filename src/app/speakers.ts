import { useSyncExternalStore } from "react";
import { errorMessage } from "@/lib/errors";
import { identifySpeakers, type SpeakerStage } from "@/lib/speaker-run";

/** Speaker identification runs, per lecture; module-level so they survive tab switches. */
export type SpeakerStatus =
  | { kind: "idle" }
  | {
      kind: "running";
      stage: SpeakerStage;
      done: number;
      total: number;
      loaded: number;
      loadTotal: number;
    }
  | { kind: "error"; message: string };

const IDLE: SpeakerStatus = { kind: "idle" };
const states = new Map<string, SpeakerStatus>();
const listeners = new Set<() => void>();

function set(id: string, s: SpeakerStatus) {
  if (s.kind === "idle") states.delete(id);
  else states.set(id, s);
  for (const l of listeners) l();
}

export function startSpeakers(lectureId: string): void {
  if (states.get(lectureId)?.kind === "running") return;
  let p = {
    stage: "decode" as SpeakerStage,
    done: 0,
    total: 0,
    loaded: 0,
    loadTotal: 0,
  };
  const report = (patch: Partial<typeof p>) => {
    p = { ...p, ...patch };
    set(lectureId, { kind: "running", ...p });
  };
  report({});
  identifySpeakers(lectureId, {
    onStage: (stage) => report({ stage }),
    onLoad: (loaded, loadTotal) => report({ loaded, loadTotal }),
    onProgress: (done, total) => report({ done, total }),
  }).then(
    () => set(lectureId, IDLE),
    (e: unknown) => {
      console.error(e);
      set(lectureId, { kind: "error", message: errorMessage(e) });
    },
  );
}

export function useSpeakerStatus(lectureId: string): SpeakerStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => states.get(lectureId) ?? IDLE,
  );
}
