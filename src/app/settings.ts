import { useSyncExternalStore } from "react";
import { isModelId, type ModelId } from "@/lib/models";

/** User preferences, persisted to localStorage and shared across pages. */
export interface Settings {
  model: ModelId;
  /** Store the original file in IndexedDB so lectures can be replayed later. */
  keepMedia: boolean;
}

const KEY = "lna.settings";
const DEFAULTS: Settings = { model: "fast", keepMedia: true };

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<
      Record<keyof Settings, unknown>
    >;
    return {
      model: isModelId(raw.model) ? raw.model : DEFAULTS.model,
      keepMedia: typeof raw.keepMedia === "boolean" ? raw.keepMedia : DEFAULTS.keepMedia,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: keep in memory */
  }
  for (const l of listeners) l();
}

export function useSettings(): Settings {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getSettings);
}
