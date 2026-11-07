import type { LiveSession } from "@/app/live";
import { formatBytes } from "@/lib/format";
import { formatTimestamp } from "@/lib/time";
import { Button, Card } from "./ui";

const FINISHING = {
  transcribing: "Transcribing the last few seconds…",
  saving: "Saving the recording…",
  indexing: "Preparing search…",
} as const;

/** Recording controls and status for a live session, shown on its lecture page. */
export function LiveRecordingCard({
  session,
  onStop,
}: {
  session: LiveSession;
  onStop: () => void;
}) {
  if (session.stage === "done") {
    return session.mediaSkipped ? (
      <p className="text-sm text-zinc-500 dark:text-zinc-400" data-testid="live-media-skipped">
        The recording wasn't kept for playback (the “save the recording” setting is off, or there
        wasn't enough storage). The transcript is saved.
      </p>
    ) : null;
  }
  if (session.stage === "error") {
    return (
      <p
        className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        data-testid="live-error"
      >
        Live transcription stopped: {session.error}
      </p>
    );
  }

  const recording = session.stage === "recording";
  // Perceptual-ish meter: speech RMS is ~0.02–0.3.
  const meter = Math.min(1, Math.sqrt(session.level) * 1.6);
  return (
    <div data-testid="live-card">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {recording ? (
            <span className="flex items-center gap-2 font-medium" data-testid="live-recording">
              <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-red-500" />
              Recording
            </span>
          ) : (
            <span className="flex items-center gap-2 font-medium" data-testid="live-finishing">
              <span
                aria-hidden
                className="size-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
              />
              {FINISHING[session.finishing ?? "transcribing"]}
            </span>
          )}
          <span className="font-mono text-sm tabular-nums" data-testid="live-elapsed">
            {formatTimestamp(session.elapsedSec)}
          </span>
          {recording && (
            <div
              className="h-2 w-28 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={Number(meter.toFixed(2))}
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-150"
                style={{ width: `${meter * 100}%` }}
              />
            </div>
          )}
          {recording && (
            <Button variant="primary" className="ml-auto" onClick={onStop} data-testid="live-stop">
              Stop
            </Button>
          )}
        </div>
        {recording && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {!session.load.done
              ? `Loading the speech model${session.load.total ? ` (${formatBytes(session.load.loaded)} of ${formatBytes(session.load.total)})` : ""}. Recording has started; the transcript will catch up.`
              : session.behindSec > 15
                ? `The transcript is ${Math.round(session.behindSec)} s behind. It will catch up after you stop.`
                : "Text appears every few seconds, at natural pauses."}
            {session.micLabel && ` Microphone: ${session.micLabel}.`}
          </p>
        )}
      </Card>
    </div>
  );
}
