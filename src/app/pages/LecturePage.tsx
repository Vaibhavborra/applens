import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState, type ReactNode } from "react";
import { ExportMenu } from "@/components/ExportMenu";
import { FlashcardsPanel } from "@/components/FlashcardsPanel";
import { JobSteps } from "@/components/JobSteps";
import { LectureStatusBadge } from "@/components/LectureStatusBadge";
import { MediaPlayer } from "@/components/MediaPlayer";
import { NotesPanel } from "@/components/NotesPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { TabPanel, Tabs, type TabDef } from "@/components/Tabs";
import { TranscriptView } from "@/components/TranscriptView";
import { Button, Card } from "@/components/ui";
import { Waveform } from "@/components/Waveform";
import { decodeMediaFile, TARGET_SAMPLE_RATE } from "@/lib/audio";
import { attachMedia, db, deleteLecture, getSegments, removeMedia, type Lecture } from "@/lib/db";
import { formatBytes, formatDate } from "@/lib/format";
import { getModel } from "@/lib/models";
import { formatTimestamp } from "@/lib/time";
import { useJob, type Job } from "../job";
import { isLiveBusy, useLive } from "../live";
import { LiveRecordingCard } from "@/components/LiveRecordingCard";
import { useDocumentTitle } from "../useDocumentTitle";
import { useNotes } from "../notes";
import { Link } from "../Link";
import { navigate } from "../router";
import {
  useActiveSegment,
  useIsPlaying,
  useMediaElement,
  usePlayerShortcuts,
} from "../usePlayback";

export function LecturePage({ id }: { id: string }) {
  // undefined = loading, null = not found
  const lecture = useLiveQuery(async () => (await db.lectures.get(id)) ?? null, [id]);
  const segments = useLiveQuery(() => getSegments(id), [id], []);
  const { job } = useJob();
  const live = job?.lectureId === id ? job : null;

  if (lecture === undefined) return null;
  if (lecture === null) {
    return (
      <Card>
        <p className="font-medium">This lecture doesn't exist (it may have been deleted).</p>
        <Link
          to="/"
          className="mt-2 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          ← Back to all lectures
        </Link>
      </Card>
    );
  }
  return <LectureView lecture={lecture} segments={segments} live={live} />;
}

type LectureTab = "notes" | "transcript" | "flashcards" | "search";

interface MediaSource {
  blob: Blob;
  /** Identity for remounting the player when the source changes. */
  key: string;
}

function LectureView({
  lecture,
  segments,
  live,
}: {
  lecture: Lecture;
  segments: Awaited<ReturnType<typeof getSegments>>;
  live: Job | null;
}) {
  const { job, busy: jobBusy, start, cancel } = useJob();
  const { session, liveBusy, stopLive } = useLive();
  const rec = session?.lectureId === lecture.id ? session : null;
  const recording = rec !== null && isLiveBusy(rec);
  const busy = jobBusy || liveBusy;
  const running = (live !== null && jobBusy) || recording;
  const transcribing = live?.transcribe.status === "active";

  const stored = useLiveQuery(
    () => (lecture.hasMedia && !live ? db.media.get(lecture.id) : undefined),
    [lecture.id, lecture.hasMedia, live !== null],
  );
  const source: MediaSource | null = live
    ? { blob: live.file, key: "live" }
    : stored
      ? { blob: stored.blob, key: `stored-${stored.blob.size}` }
      : null;

  const { media, mediaRef, seek } = useMediaElement();
  const playing = useIsPlaying(media);
  const active = useActiveSegment(media, segments);
  usePlayerShortcuts(media);

  const liveAudio = live?.decode.audio;
  const loadFallbackPcm = (blob: Blob) => () =>
    liveAudio
      ? Promise.resolve(liveAudio.pcm)
      : decodeMediaFile(new File([blob], lecture.fileName, { type: lecture.fileType })).then(
          (a) => a.pcm,
        );

  const transcribeAgain = () => {
    if (!source) return;
    const file =
      source.blob instanceof File
        ? source.blob
        : new File([source.blob], lecture.fileName, { type: lecture.fileType });
    void start(file, lecture.id);
  };
  const canRerun = !busy && source !== null && lecture.status !== "processing";
  useDocumentTitle(lecture.title);
  const seekTo = media && source ? (t: number) => seek(t) : undefined;

  // Default to Notes once they exist, else Transcript, until the user picks a tab.
  const [tab, setTab] = useState<LectureTab | null>(null);
  const hasNotes = useLiveQuery(
    async () => (await db.notes.get(lecture.id)) !== undefined,
    [lecture.id],
  );
  const cardCount = useLiveQuery(
    () => db.flashcards.where("lectureId").equals(lecture.id).count(),
    [lecture.id],
  );
  const { notesJob, notesBusy } = useNotes();
  const writingNotes = notesBusy && notesJob?.lectureId === lecture.id;
  const currentTab: LectureTab = tab ?? (hasNotes ? "notes" : "transcript");
  const tabs: TabDef<LectureTab>[] = [
    {
      id: "notes",
      label: (
        <span className="inline-flex items-center gap-1.5">
          Notes
          {writingNotes && (
            <span
              aria-label="writing"
              className="size-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
            />
          )}
        </span>
      ),
    },
    { id: "transcript", label: "Transcript" },
    { id: "flashcards", label: cardCount ? `Flashcards (${cardCount})` : "Flashcards" },
    { id: "search", label: "Search" },
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← All lectures
      </Link>

      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <EditableTitle lecture={lecture} />
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {formatDate(lecture.createdAt)}
            {lecture.durationSec !== undefined && ` · ${formatTimestamp(lecture.durationSec)}`}
            {lecture.model && ` · Whisper ${getModel(lecture.model).label}`}
            {lecture.device && ` (${lecture.device === "webgpu" ? "WebGPU" : "WASM"})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LectureStatusBadge lecture={lecture} job={job} recording={recording} />
          <ExportMenu lecture={lecture} segments={segments} />
        </div>
      </header>

      <StatusBanner lecture={lecture} live={live} canRerun={canRerun} onRerun={transcribeAgain} />

      {rec && <LiveRecordingCard session={rec} onStop={stopLive} />}

      {live && (
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate font-medium">{lecture.fileName}</p>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {formatBytes(lecture.fileSize)}
            </span>
            {transcribing && <Button onClick={cancel}>Cancel</Button>}
          </div>
          <JobSteps job={live} />
          {live.decode.status === "error" && (
            <p className="sr-only" data-testid="decode-error">
              Couldn't read “{lecture.fileName}”: {live.decode.error}
            </p>
          )}
          {liveAudio && (
            <span
              hidden
              data-testid="decode-result"
              data-method={liveAudio.method}
              data-duration={liveAudio.durationSec}
            />
          )}
        </Card>
      )}

      {!(live?.decode.status === "error") && !recording && (
        <Card>
          {source ? (
            <MediaPlayer
              key={source.key}
              source={source.blob}
              fileName={lecture.fileName}
              fileType={lecture.fileType}
              loadFallbackPcm={loadFallbackPcm(source.blob)}
              sampleRate={TARGET_SAMPLE_RATE}
              mediaRef={mediaRef}
            />
          ) : (
            <NoMedia lecture={lecture} />
          )}
          {lecture.peaks && lecture.durationSec !== undefined && (
            <Waveform
              peaks={lecture.peaks}
              durationSec={lecture.durationSec}
              media={source ? media : null}
              className="mt-4 h-16 text-indigo-500 dark:text-indigo-400"
            />
          )}
          {source && !live && <MediaActions lecture={lecture} />}
        </Card>
      )}

      {(segments.length > 0 ||
        lecture.status !== "processing" ||
        live?.transcribe.status !== "pending") &&
        !(live?.decode.status === "error") && (
          // Invisible until we know whether notes exist, so the default tab doesn't flash.
          <Card className={`pt-2 ${hasNotes === undefined ? "invisible" : ""}`}>
            <Tabs idPrefix="lecture" tabs={tabs} value={currentTab} onChange={setTab} />
            {/* Panels stay mounted (scroll position, flipped cards survive tab switches). */}
            <div hidden={currentTab !== "notes"}>
              <TabPanel idPrefix="lecture" id="notes">
                <NotesPanel lecture={lecture} hasTranscript={segments.length > 0} onSeek={seekTo} />
              </TabPanel>
            </div>
            <div hidden={currentTab !== "transcript"}>
              <TabPanel idPrefix="lecture" id="transcript">
                <h2
                  className="mb-3 flex items-baseline justify-between text-sm font-medium text-zinc-500 dark:text-zinc-400"
                  data-testid="transcript-status"
                  data-status={
                    live?.transcribe.status ?? (lecture.status === "done" ? "done" : lecture.status)
                  }
                >
                  <span className="sr-only">Transcript</span>
                  {media && source && segments.length > 0 && (
                    <span className="text-xs font-normal">
                      Click a line to jump there · Space play/pause · ←/→ 5 s
                    </span>
                  )}
                </h2>
                <TranscriptView
                  segments={segments}
                  live={transcribing || recording}
                  active={source ? active : -1}
                  follow={playing && currentTab === "transcript"}
                  onSeek={seekTo}
                />
              </TabPanel>
            </div>
            <div hidden={currentTab !== "flashcards"}>
              <TabPanel idPrefix="lecture" id="flashcards">
                <FlashcardsPanel lectureId={lecture.id} onSeek={seekTo} />
              </TabPanel>
            </div>
            <div hidden={currentTab !== "search"}>
              <TabPanel idPrefix="lecture" id="search">
                <SearchPanel
                  lecture={lecture}
                  segments={segments}
                  active={currentTab === "search"}
                  processing={running}
                  onSeek={seekTo}
                />
              </TabPanel>
            </div>
          </Card>
        )}

      <DangerZone lecture={lecture} disabled={running} />
    </div>
  );
}

function StatusBanner({
  lecture,
  live,
  canRerun,
  onRerun,
}: {
  lecture: Lecture;
  live: Job | null;
  canRerun: boolean;
  onRerun: () => void;
}) {
  let message: ReactNode = null;
  if (live?.mediaSkipped) {
    message =
      "There wasn't enough browser storage to keep this recording, so only the transcript will be saved. Attach the file again later to play it.";
  } else if (!live && lecture.status === "interrupted") {
    message =
      "Transcription was interrupted (the tab was closed or reloaded). The transcript below is partial.";
  } else if (!live && lecture.status === "cancelled") {
    message = "Transcription was cancelled. The transcript below is partial.";
  } else if (!live && lecture.status === "error") {
    message = `Processing failed: ${lecture.error ?? "unknown error"}`;
  }
  if (!message) return null;

  const rerunnable = !live && lecture.status !== "done";
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      role="status"
      data-testid="status-banner"
    >
      <p className="min-w-0 flex-1">{message}</p>
      {rerunnable && (
        <Button
          variant="primary"
          onClick={onRerun}
          disabled={!canRerun}
          title={
            canRerun ? undefined : "Needs the saved recording, and no other transcription running"
          }
        >
          Transcribe again
        </Button>
      )}
    </div>
  );
}

function EditableTitle({ lecture }: { lecture: Lecture }) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const save = () => {
    const title = input.current?.value.trim();
    if (title && title !== lecture.title) void db.lectures.update(lecture.id, { title });
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={input}
        defaultValue={lecture.title}
        autoFocus
        aria-label="Lecture title"
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-2xl font-semibold tracking-tight outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
    );
  }
  return (
    <h1 className="group flex items-center gap-2 text-2xl font-semibold tracking-tight">
      <span className="truncate" data-testid="lecture-title">
        {lecture.title}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Rename lecture"
        className="rounded p-1 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-700 focus-visible:opacity-100 dark:hover:text-zinc-200"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          aria-hidden
        >
          <path d="m13.5 3.5 3 3L7 16H4v-3l9.5-9.5Z" strokeLinejoin="round" />
        </svg>
      </button>
    </h1>
  );
}

function NoMedia({ lecture }: { lecture: Lecture }) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div
      className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400"
      data-testid="no-media"
    >
      <p className="min-w-0 flex-1">
        The recording isn't saved in this browser. Attach{" "}
        <span className="font-medium">{lecture.fileName}</span> to play it alongside the transcript.
      </p>
      <Button onClick={() => input.current?.click()}>Attach file…</Button>
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*"
        hidden
        data-testid="attach-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size !== lecture.fileSize) {
            setNote(
              `Heads up: "${f.name}" isn't the same size as the original, so timestamps may not line up.`,
            );
          }
          void attachMedia(lecture.id, f);
        }}
      />
      {note && <p className="w-full text-amber-700 dark:text-amber-400">{note}</p>}
    </div>
  );
}

function MediaActions({ lecture }: { lecture: Lecture }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      {confirming ? (
        <>
          <span>
            Remove the saved recording ({formatBytes(lecture.fileSize)})? The transcript stays.
          </span>
          <Button variant="danger" onClick={() => void removeMedia(lecture.id)}>
            Remove
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </>
      ) : (
        <Button variant="ghost" onClick={() => setConfirming(true)} className="text-xs">
          Free up {formatBytes(lecture.fileSize)} by removing the recording
        </Button>
      )}
    </div>
  );
}

function DangerZone({ lecture, disabled }: { lecture: Lecture; disabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      {confirming ? (
        <>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Delete this lecture and its transcript permanently?
          </span>
          <Button
            variant="danger"
            onClick={() => {
              void deleteLecture(lecture.id).then(() => navigate("/", { replace: true }));
            }}
          >
            Delete
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </>
      ) : (
        <Button
          variant="danger-ghost"
          onClick={() => setConfirming(true)}
          disabled={disabled}
          title={disabled ? "Cancel transcription before deleting" : undefined}
        >
          Delete lecture
        </Button>
      )}
    </div>
  );
}
