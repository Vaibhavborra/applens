import Dexie, { type EntityTable } from "dexie";
import type { Segment } from "@/types/transcript";
import type { Device, ModelId } from "./models";
import type { AssembledNotes, Card, KeyTerm, NotesSection } from "./notes/types";
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
  /** Embedding model the search index was built with; absent = not indexed. */
  searchModel?: string;
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

export interface StoredNotes {
  lectureId: string;
  title: string;
  summary: string;
  sections: NotesSection[];
  keyTerms: KeyTerm[];
  markdown: string;
  /** MLC model id that wrote these notes. */
  model: string;
  createdAt: number;
  ms: number;
  /** Parts where JSON failed and plain-text bullets were used. */
  fallbackParts: number;
}

export interface StoredFlashcard extends Card {
  id?: number;
  lectureId: string;
}

export interface StoredPassage {
  id?: number;
  lectureId: string;
  start: number;
  end: number;
  text: string;
  /** L2-normalised embedding. */
  vector: Float32Array;
}

export class LectureDB extends Dexie {
  lectures!: EntityTable<Lecture, "id">;
  segments!: EntityTable<StoredSegment, "id">;
  media!: EntityTable<StoredMedia, "lectureId">;
  notes!: EntityTable<StoredNotes, "lectureId">;
  flashcards!: EntityTable<StoredFlashcard, "id">;
  passages!: EntityTable<StoredPassage, "id">;

  constructor(name = "lecture-notes-ai") {
    super(name);
    this.version(1).stores({
      lectures: "id, createdAt, status",
      segments: "++id, lectureId, [lectureId+start]",
      media: "lectureId",
    });
    // v2 (Phase 6): AI notes + flashcards. Additive; no data migration needed.
    this.version(2).stores({
      notes: "lectureId",
      flashcards: "++id, lectureId",
    });
    // v3 (Phase 7): semantic search passages.
    this.version(3).stores({ passages: "++id, lectureId" });
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
  await database.transaction(
    "rw",
    [database.lectures, database.segments, database.notes, database.flashcards, database.passages],
    async () => {
      await database.segments.where("lectureId").equals(lectureId).delete();
      // Notes describe the old transcript, so they go too.
      await database.notes.delete(lectureId);
      await database.flashcards.where("lectureId").equals(lectureId).delete();
      await database.passages.where("lectureId").equals(lectureId).delete();
      await database.lectures
        .where("id")
        .equals(lectureId)
        .modify((l) => {
          l.status = "processing";
          delete l.error;
          delete l.transcribeMs;
          delete l.searchModel;
        });
    },
  );
}

export async function deleteLecture(lectureId: string, database: LectureDB = db): Promise<void> {
  await database.transaction(
    "rw",
    [
      database.lectures,
      database.segments,
      database.media,
      database.notes,
      database.flashcards,
      database.passages,
    ],
    async () => {
      await database.segments.where("lectureId").equals(lectureId).delete();
      await database.flashcards.where("lectureId").equals(lectureId).delete();
      await database.passages.where("lectureId").equals(lectureId).delete();
      await database.notes.delete(lectureId);
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

/** Replace a lecture's notes and flashcards atomically. */
export async function saveNotes(
  lectureId: string,
  notes: AssembledNotes,
  meta: { model: string; ms: number; fallbackParts: number },
  database: LectureDB = db,
): Promise<void> {
  await database.transaction("rw", database.notes, database.flashcards, async () => {
    await database.notes.put({
      lectureId,
      title: notes.title,
      summary: notes.summary,
      sections: notes.sections,
      keyTerms: notes.keyTerms,
      markdown: notes.markdown,
      createdAt: Date.now(),
      ...meta,
    });
    await database.flashcards.where("lectureId").equals(lectureId).delete();
    await database.flashcards.bulkAdd(notes.flashcards.map((c) => ({ ...c, lectureId })));
  });
}

export function getFlashcards(
  lectureId: string,
  database: LectureDB = db,
): Promise<StoredFlashcard[]> {
  return database.flashcards.where("lectureId").equals(lectureId).sortBy("sourceStart");
}

/** Replace a lecture's search index atomically and record which model built it. */
export async function savePassages(
  lectureId: string,
  passages: Omit<StoredPassage, "id" | "lectureId">[],
  model: string,
  database: LectureDB = db,
): Promise<void> {
  await database.transaction("rw", database.passages, database.lectures, async () => {
    await database.passages.where("lectureId").equals(lectureId).delete();
    await database.passages.bulkAdd(passages.map((p) => ({ ...p, lectureId })));
    await database.lectures.update(lectureId, { searchModel: model });
  });
}

export function getPassages(lectureId: string, database: LectureDB = db): Promise<StoredPassage[]> {
  return database.passages.where("lectureId").equals(lectureId).sortBy("start");
}
