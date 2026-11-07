import Dexie, { type EntityTable } from "dexie";
import type { Segment } from "@/types/transcript";
import type { Device, ModelId } from "./models";
import type { Peaks } from "./pcm";

export type LectureStatus = "processing" | "done" | "cancelled" | "interrupted" | "error";

export interface Lecture {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: number;
  status: LectureStatus;
  error?: string;
  durationSec?: number;
  /** Waveform min/max buckets, so reopening needs no re-decode. */
  peaks?: Peaks;
  /** Whether a media blob is stored in the `media` table. */
  hasMedia: boolean;
  model?: ModelId;
  device?: Device;
  transcribeMs?: number;
}

export interface StoredSegment extends Segment {
  id?: number;
  lectureId: string;
}

/** Kept apart from `lectures` so listing lectures never touches large blobs. */
export interface StoredMedia {
  lectureId: string;
  blob: Blob;
}

export class LectureDB extends Dexie {
  lectures!: EntityTable<Lecture, "id">;
  segments!: EntityTable<StoredSegment, "id">;
  media!: EntityTable<StoredMedia, "lectureId">;

  constructor(name = "lecture-notes-ai") {
    super(name);
    this.version(1).stores({
      lectures: "id, createdAt, status",
      segments: "++id, lectureId, [lectureId+start]",
      media: "lectureId",
    });
  }
}

export const db = new LectureDB();

export function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim();
  return base || "Untitled lecture";
}

export async function createLecture(
  file: File,
  opts: { keepMedia: boolean; model: ModelId; device: Device },
  database: LectureDB = db,
): Promise<Lecture> {
  const lecture: Lecture = {
    id: crypto.randomUUID(),
    title: titleFromFileName(file.name),
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    createdAt: Date.now(),
    status: "processing",
    hasMedia: false,
    model: opts.model,
    device: opts.device,
  };
  await database.transaction("rw", database.lectures, database.media, async () => {
    await database.lectures.add(lecture);
    if (opts.keepMedia) {
      await database.media.put({ lectureId: lecture.id, blob: file });
      await database.lectures.update(lecture.id, { hasMedia: true });
      lecture.hasMedia = true;
    }
  });
  return lecture;
}

export async function appendSegments(
  lectureId: string,
  segments: readonly Segment[],
  database: LectureDB = db,
): Promise<void> {
  if (segments.length === 0) return;
  await database.segments.bulkAdd(segments.map((s) => ({ ...s, lectureId })));
}

export function getSegments(lectureId: string, database: LectureDB = db): Promise<StoredSegment[]> {
  return database.segments
    .where("[lectureId+start]")
    .between([lectureId, Dexie.minKey], [lectureId, Dexie.maxKey])
    .toArray();
}

/** Clear the transcript (and per-run fields) before transcribing a lecture again. */
export async function resetTranscript(lectureId: string, database: LectureDB = db): Promise<void> {
  await database.transaction("rw", database.lectures, database.segments, async () => {
    await database.segments.where("lectureId").equals(lectureId).delete();
    await database.lectures
      .where("id")
      .equals(lectureId)
      .modify((l) => {
        l.status = "processing";
        delete l.error;
        delete l.transcribeMs;
      });
  });
}

export async function deleteLecture(lectureId: string, database: LectureDB = db): Promise<void> {
  await database.transaction(
    "rw",
    [database.lectures, database.segments, database.media],
    async () => {
      await database.segments.where("lectureId").equals(lectureId).delete();
      await database.media.delete(lectureId);
      await database.lectures.delete(lectureId);
    },
  );
}

export async function removeMedia(lectureId: string, database: LectureDB = db): Promise<void> {
  await database.transaction("rw", database.lectures, database.media, async () => {
    await database.media.delete(lectureId);
    await database.lectures.update(lectureId, { hasMedia: false });
  });
}

export async function attachMedia(
  lectureId: string,
  blob: Blob,
  database: LectureDB = db,
): Promise<void> {
  await database.transaction("rw", database.lectures, database.media, async () => {
    await database.media.put({ lectureId, blob });
    await database.lectures.update(lectureId, { hasMedia: true });
  });
}

/**
 * Lectures left in "processing" by a closed tab or crash. `isActive` reports
 * whether some tab still runs the job (see the Web Lock in the job hook).
 */
export async function markInterrupted(
  isActive: (lectureId: string) => boolean,
  database: LectureDB = db,
): Promise<number> {
  const stale = (await database.lectures.where("status").equals("processing").toArray()).filter(
    (l) => !isActive(l.id),
  );
  await Promise.all(stale.map((l) => database.lectures.update(l.id, { status: "interrupted" })));
  return stale.length;
}
