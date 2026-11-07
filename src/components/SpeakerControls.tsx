import { useState } from "react";
import { startSpeakers, useSpeakerStatus } from "@/app/speakers";
import { renameSpeaker, type Lecture } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { speakerName } from "@/lib/speakers";
import { SPEAKER_MODEL_MB } from "@/workers/speaker.protocol";
import { speakerColor } from "./speaker-colors";
import { Button } from "./ui";

const STAGES = {
  decode: "Reading the recording…",
  fingerprint: "Listening for voices…",
  save: "Saving…",
} as const;

/** "Identify speakers" button, progress, and speaker renaming for the Transcript tab. */
export function SpeakerControls({ lecture, disabled }: { lecture: Lecture; disabled: boolean }) {
  const status = useSpeakerStatus(lecture.id);
  const run = () => startSpeakers(lecture.id);

  if (status.kind === "running") {
    const detail =
      status.stage === "fingerprint" && status.total > 0
        ? ` ${status.done} of ${status.total} lines`
        : status.stage === "fingerprint" && status.loadTotal > 0
          ? ` (model ${formatBytes(status.loaded)} of ${formatBytes(status.loadTotal)})`
          : "";
    return (
      <div
        className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
        data-testid="speakers-progress"
      >
        <span
          aria-hidden
          className="size-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
        />
        {STAGES[status.stage]}
        {detail}
      </div>
    );
  }

  const count = lecture.speakerCount;
  return (
    <div className="space-y-2 text-sm" data-testid="speakers">
      {status.kind === "error" && (
        <p className="text-red-600 dark:text-red-400" data-testid="speakers-error">
          {status.message}
        </p>
      )}
      {count === undefined ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={run}
            disabled={disabled || !lecture.hasMedia}
            data-testid="identify-speakers"
          >
            Identify speakers
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {lecture.hasMedia
              ? `Labels who's talking (lecturer, questions). Downloads a ${SPEAKER_MODEL_MB} MB voice model once; runs on your device.`
              : "Needs the saved recording."}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-zinc-500 dark:text-zinc-400" data-testid="speaker-count">
            {count === 1 ? "1 speaker found" : `${count} speakers found`}
          </span>
          {count > 1 &&
            Array.from({ length: count }, (_, i) => (
              <SpeakerName
                key={`${i}-${lecture.speakerNames?.[i] ?? ""}`}
                lecture={lecture}
                index={i}
              />
            ))}
          <Button variant="ghost" className="text-xs" onClick={run} disabled={disabled}>
            Run again
          </Button>
        </div>
      )}
    </div>
  );
}

function SpeakerName({ lecture, index }: { lecture: Lecture; index: number }) {
  const [value, setValue] = useState(lecture.speakerNames?.[index] ?? "");
  const save = () => void renameSpeaker(lecture.id, index, value);
  return (
    <label className="flex items-center gap-1">
      <span className="sr-only">Name for speaker {index + 1}</span>
      <input
        value={value}
        placeholder={speakerName(index)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`w-28 rounded-md border border-zinc-200 bg-transparent px-2 py-0.5 text-sm font-medium placeholder:font-medium dark:border-zinc-700 ${speakerColor(index)} placeholder:opacity-70`}
        data-testid={`speaker-name-${index}`}
      />
    </label>
  );
}
