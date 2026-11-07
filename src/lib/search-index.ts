import { EMBED_MODEL } from "@/workers/embed.protocol";
import { db, getSegments, savePassages, type LectureDB } from "./db";
import type { Embedder } from "./embed-client";
import { buildPassages } from "./search";

const BATCH = 32;

/** True when a finished lecture has no index, or one built with a different model. */
export function needsIndex(lecture: { searchModel?: string; status: string }): boolean {
  return lecture.status === "done" && lecture.searchModel !== EMBED_MODEL;
}

/**
 * Build (or rebuild) a lecture's semantic search index: passages of ~3
 * segments, embedded in batches, then saved in one transaction.
 */
export async function indexLecture(
  lectureId: string,
  embedder: Embedder,
  onProgress?: (done: number, total: number) => void,
  database: LectureDB = db,
): Promise<number> {
  const passages = buildPassages(await getSegments(lectureId, database));
  const vectors: Float32Array[] = [];
  onProgress?.(0, passages.length);
  for (let i = 0; i < passages.length; i += BATCH) {
    const batch = passages.slice(i, i + BATCH);
    vectors.push(...(await embedder.embed(batch.map((p) => p.text))));
    onProgress?.(vectors.length, passages.length);
  }
  await savePassages(
    lectureId,
    passages.map((p, i) => ({ start: p.start, end: p.end, text: p.text, vector: vectors[i]! })),
    EMBED_MODEL,
    database,
  );
  return passages.length;
}
