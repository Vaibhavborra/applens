import type { Job } from "@/app/job";
import type { Lecture } from "@/lib/db";
import { Badge } from "./ui";

/** Status chip; uses the live job (if this tab runs it) for a percentage. */
export function LectureStatusBadge({
  lecture,
  job,
  recording = false,
}: {
  lecture: Lecture;
  job: Job | null;
  /** A live recording in this tab is writing this lecture. */
  recording?: boolean;
}) {
  const live = job?.lectureId === lecture.id ? job : null;
  switch (lecture.status) {
    case "done":
      return <Badge tone="green">Transcribed</Badge>;
    case "processing": {
      if (recording) return <Badge tone="red">Live</Badge>;
      const t = live?.transcribe;
      const pct = t && t.total > 0 ? ` ${Math.round((t.done / t.total) * 100)}%` : "";
      return (
        <Badge tone="indigo">{live ? `Transcribing${pct}` : "Processing in another tab"}</Badge>
      );
    }
    case "cancelled":
      return <Badge tone="zinc">Cancelled</Badge>;
    case "interrupted":
      return <Badge tone="amber">Interrupted</Badge>;
    case "error":
      return <Badge tone="red">Failed</Badge>;
  }
}
