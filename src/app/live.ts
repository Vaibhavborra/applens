import { createContext, useContext } from "react";

export type LiveStage = "recording" | "finishing" | "done" | "error";

export interface LiveSession {
  lectureId: string;
  stage: LiveStage;
  /** Seconds recorded so far. */
  elapsedSec: number;
  /** Seconds of audio recorded but not transcribed yet. */
  behindSec: number;
  /** Input level of the last block, 0–1. */
  level: number;
  micLabel: string;
  /** Whisper model download, while it's still loading. */
  load: { done: boolean; loaded: number; total: number };
  /** Finishing step shown after Stop. */
  finishing?: "transcribing" | "saving" | "indexing";
  /** Recording wasn't saved for playback (setting off or not enough storage). */
  mediaSkipped?: boolean;
  error?: string;
}

export interface LiveApi {
  session: LiveSession | null;
  /** Recording or finishing up. */
  liveBusy: boolean;
  /** Ask for the microphone, create a lecture and start transcribing. Resolves with its id. */
  startLive: () => Promise<string>;
  stopLive: () => void;
}

export const LiveContext = createContext<LiveApi | null>(null);

export function useLive(): LiveApi {
  const api = useContext(LiveContext);
  if (!api) throw new Error("useLive must be used inside <LiveProvider>");
  return api;
}

export const isLiveBusy = (s: LiveSession | null) =>
  s !== null && (s.stage === "recording" || s.stage === "finishing");
