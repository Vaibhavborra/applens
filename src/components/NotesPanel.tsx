import { useLiveQuery } from "dexie-react-hooks";
import { useNotes, type NotesJob } from "@/app/notes";
import { getSettings, updateSettings, useSettings, type NotesEngine } from "@/app/settings";
import { useGpu } from "@/app/useGpu";
import { db, type Lecture, type StoredNotes } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { NOTES_MODELS } from "@/lib/llm-models";
import { formatTimestamp } from "@/lib/time";
import { OllamaSettings } from "./OllamaSettings";
import { Steps, type StepView } from "./Steps";
import { TimeChip } from "./TimeChip";
import { Button } from "./ui";

interface Props {
  lecture: Lecture;
  hasTranscript: boolean;
  onSeek?: ((t: number) => void) | undefined;
}

export function NotesPanel({ lecture, hasTranscript, onSeek }: Props) {
  // undefined = loading, null = no notes yet
  const notes = useLiveQuery(async () => (await db.notes.get(lecture.id)) ?? null, [lecture.id]);
  const { notesJob, notesBusy, startNotes, cancelNotes } = useNotes();
  const job = notesJob?.lectureId === lecture.id ? notesJob : null;
  const busyHere = job !== null && notesBusy;
  const busyElsewhere = notesBusy && !busyHere;
  const transcriptReady = lecture.status === "done" && hasTranscript;
  const generate = () => void startNotes(lecture.id);

  if (busyHere) {
    return (
      <div data-testid="notes-progress">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Writing notes on your device. You can keep using the app.
          </p>
          <Button onClick={cancelNotes}>Cancel</Button>
        </div>
        <Steps steps={notesSteps(job)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {job?.stage === "error" && (
        <p
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          data-testid="notes-error"
        >
          {job.error}
        </p>
      )}
      {job?.stage === "cancelled" && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Note writing was cancelled.</p>
      )}

      {notes ? (
        <>
          <NotesDocument notes={notes} onSeek={onSeek} />
          <NotesFooter
            notes={notes}
            onRegenerate={generate}
            disabled={!transcriptReady || busyElsewhere}
          />
        </>
      ) : notes === null ? (
        <GenerateNotes
          onGenerate={generate}
          transcriptReady={transcriptReady}
          busyElsewhere={busyElsewhere}
        />
      ) : null}
    </div>
  );
}

function notesSteps(job: NotesJob): StepView[] {
  const ollama = getSettings().notesEngine === "ollama";
  const loadDone = job.stage !== "loading";
  const mapDone = job.stage === "reduce" || job.stage === "done";
  const eta =
    job.etaMs !== undefined && job.done > 0 ? ` · ~${formatTimestamp(job.etaMs / 1000)} left` : "";
  return [
    {
      id: "notes-model",
      label: ollama ? "Connecting to Ollama" : "Loading notes model",
      status: loadDone ? "done" : "active",
      detail: loadDone || ollama ? undefined : `${Math.round(job.loadProgress * 100)}%`,
      progress: job.loadProgress,
    },
    {
      id: "notes-map",
      label: "Writing notes",
      status: mapDone ? "done" : job.stage === "map" ? "active" : "pending",
      detail:
        job.total > 0
          ? `part ${Math.min(job.done + 1, job.total)} of ${job.total}${eta}`
          : undefined,
      progress: job.total > 0 ? job.done / job.total : undefined,
    },
    {
      id: "notes-reduce",
      label: "Summarising",
      status: job.stage === "reduce" ? "active" : job.stage === "done" ? "done" : "pending",
    },
  ];
}

function GenerateNotes({
  onGenerate,
  transcriptReady,
  busyElsewhere,
}: {
  onGenerate: () => void;
  transcriptReady: boolean;
  busyElsewhere: boolean;
}) {
  const gpu = useGpu();
  const settings = useSettings();
  const noGpu = gpu !== null && !gpu.webgpu;
  const ollama = settings.notesEngine === "ollama";
  const canRun = ollama || (gpu !== null && !noGpu);

  return (
    <div className="space-y-4" data-testid="notes-empty">
      <div>
        <p className="font-medium">Turn this transcript into study notes</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          A summary, notes with headings, key terms and flashcards. Written by a small language
          model on your own computer; nothing is uploaded.
        </p>
      </div>

      <EnginePicker value={settings.notesEngine} />

      {ollama ? (
        <OllamaSettings />
      ) : noGpu ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          In-browser AI notes need WebGPU, which this browser doesn't provide. Try Chrome or Edge
          113+ (or Safari 26+), or use Ollama. The transcript, player and search still work here.
        </p>
      ) : (
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Notes model</legend>
          {NOTES_MODELS.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 ${
                settings.notesModel === m.id
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="notes-model"
                value={m.id}
                checked={settings.notesModel === m.id}
                onChange={() => updateSettings({ notesModel: m.id })}
                className="sr-only"
              />
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  {formatBytes(m.sizeMB * 1e6)}
                </span>
              </span>
              <span className="mt-0.5 text-zinc-500 dark:text-zinc-400">{m.blurb}</span>
            </label>
          ))}
        </fieldset>
      )}
      {canRun && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={onGenerate}
              disabled={!transcriptReady || busyElsewhere || (!ollama && gpu === null)}
              data-testid="generate-notes"
            >
              Generate notes
            </Button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {!transcriptReady
                ? "Available once the transcript is complete."
                : busyElsewhere
                  ? "Another lecture's notes are being written."
                  : ollama
                    ? `Uses ${settings.ollamaModel} in Ollama.`
                    : `The model downloads once, then it's cached.${gpu?.name ? ` Runs on: ${gpu.name}.` : ""}`}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={settings.autoNotes}
              onChange={(e) => updateSettings({ autoNotes: e.target.checked })}
              className="size-4 accent-indigo-600"
            />
            Write notes automatically after each transcription
          </label>
        </>
      )}
    </div>
  );
}

function NotesDocument({
  notes,
  onSeek,
}: {
  notes: StoredNotes;
  onSeek?: ((t: number) => void) | undefined;
}) {
  return (
    <article className="space-y-6" data-testid="notes">
      {notes.summary && (
        <section>
          <h3 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Summary
          </h3>
          <p className="mt-2 leading-relaxed">{notes.summary}</p>
        </section>
      )}
      {notes.sections.map((s, i) => (
        <section key={i} data-testid="notes-section">
          <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            {s.heading}
            <TimeChip t={s.start} onSeek={onSeek} label={`Jump to “${s.heading}” at`} />
          </h3>
          <ul className="mt-2 space-y-1.5">
            {s.bullets.map((b, j) => (
              <li key={j} className="flex gap-2 leading-relaxed">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-zinc-400" />
                <span className="min-w-0 flex-1">
                  {b.text} <TimeChip t={b.start} onSeek={onSeek} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {notes.keyTerms.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold tracking-tight">Key terms</h3>
          <dl
            className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]"
            data-testid="key-terms"
          >
            {notes.keyTerms.map((t) => (
              <div key={t.term} className="contents">
                <dt className="font-medium">{t.term}</dt>
                <dd className="text-zinc-600 dark:text-zinc-400">{t.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </article>
  );
}

function NotesFooter({
  notes,
  onRegenerate,
  disabled,
}: {
  notes: StoredNotes;
  onRegenerate: () => void;
  disabled: boolean;
}) {
  const modelName = notes.model.startsWith("ollama:")
    ? `${notes.model.slice(7)} (Ollama)`
    : notes.model.replace(/-q4f(16|32)_1-MLC$/, "").replace(/-/g, " ");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <span>
        Written by {modelName} in {formatTimestamp(notes.ms / 1000)}
        {notes.fallbackParts > 0 && ` · ${notes.fallbackParts} part(s) simplified`}. AI notes can
        contain mistakes; check against the transcript.
      </span>
      <Button variant="ghost" onClick={onRegenerate} disabled={disabled} className="text-xs">
        Regenerate
      </Button>
    </div>
  );
}

const ENGINES: { id: NotesEngine; label: string }[] = [
  { id: "browser", label: "In this browser" },
  { id: "ollama", label: "Ollama on this computer" },
];

function EnginePicker({ value }: { value: NotesEngine }) {
  return (
    <div
      role="radiogroup"
      aria-label="Where notes are written"
      className="inline-flex rounded-lg border border-zinc-200 p-0.5 text-sm dark:border-zinc-800"
    >
      {ENGINES.map((e) => (
        <button
          key={e.id}
          type="button"
          role="radio"
          aria-checked={value === e.id}
          onClick={() => updateSettings({ notesEngine: e.id })}
          className={`rounded-md px-3 py-1 ${
            value === e.id
              ? "bg-indigo-600 text-white"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
          data-testid={`engine-${e.id}`}
        >
          {e.label}
        </button>
      ))}
    </div>
  );
}
