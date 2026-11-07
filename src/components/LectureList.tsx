import { useState } from "react";
import { useJob } from "@/app/job";
import { Link } from "@/app/Link";
import { deleteLecture, type Lecture } from "@/lib/db";
import { formatBytes, formatDate } from "@/lib/format";
import { formatTimestamp } from "@/lib/time";
import { LectureStatusBadge } from "./LectureStatusBadge";
import { Button } from "./ui";

export function LectureList({ lectures }: { lectures: Lecture[] }) {
  if (lectures.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 px-5 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No saved lectures yet. Transcripts are saved in this browser automatically.
      </p>
    );
  }
  return (
    <ul
      className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900"
      data-testid="lecture-list"
    >
      {lectures.map((l) => (
        <LectureRow key={l.id} lecture={l} />
      ))}
    </ul>
  );
}

function LectureRow({ lecture: l }: { lecture: Lecture }) {
  const { job, busy } = useJob();
  const [confirming, setConfirming] = useState(false);
  const running = busy && job?.lectureId === l.id;

  return (
    <li className="flex items-center gap-4 px-4 py-3" data-lecture-id={l.id}>
      <div className="min-w-0 flex-1">
        <Link
          to={`/lecture/${l.id}`}
          className="block truncate font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {l.title}
        </Link>
        <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
          {formatDate(l.createdAt)}
          {l.durationSec !== undefined && ` · ${formatTimestamp(l.durationSec)}`}
          {l.hasMedia ? ` · ${formatBytes(l.fileSize)} media` : " · transcript only"}
        </p>
      </div>
      <LectureStatusBadge lecture={l} job={job} />
      {confirming ? (
        <span className="flex items-center gap-1">
          <Button
            variant="danger"
            onClick={() => void deleteLecture(l.id)}
            aria-label={`Confirm delete ${l.title}`}
          >
            Delete
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setConfirming(true)}
          disabled={running}
          title={running ? "Cancel transcription before deleting" : "Delete lecture"}
          aria-label={`Delete ${l.title}`}
        >
          <svg
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            aria-hidden
          >
            <path
              d="M4 6h12M8 6V4h4v2m-6 0 .7 10h6.6L14 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
      )}
    </li>
  );
}
