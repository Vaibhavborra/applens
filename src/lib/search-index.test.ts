import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMBED_MODEL } from "@/workers/embed.protocol";
import {
  appendSegments,
  createLecture,
  deleteLecture,
  getPassages,
  LectureDB,
  resetTranscript,
} from "./db";
import type { Embedder } from "./embed-client";
import { indexLecture, needsIndex } from "./search-index";

let database: LectureDB;
beforeEach(() => {
  database = new LectureDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

/** Fake embedder: vector = [text length, 1]; records batch sizes. */
function fake() {
  const batches: number[] = [];
  const embedder: Embedder = {
    embed(texts) {
      batches.push(texts.length);
      return Promise.resolve(texts.map((t) => new Float32Array([t.length, 1])));
    },
  };
  return { embedder, batches };
}

async function lectureWithSegments(n: number) {
  const file = new File(["x"], "a.mp3", { type: "audio/mpeg" });
  const l = await createLecture(
    file,
    { keepMedia: false, model: "fast", device: "wasm" },
    database,
  );
  await appendSegments(
    l.id,
    Array.from({ length: n }, (_, i) => ({ start: i * 5, end: i * 5 + 4, text: `segment ${i}` })),
    database,
  );
  return l;
}

describe("indexLecture", () => {
  it("embeds overlapping passages in batches and records the model", async () => {
    const l = await lectureWithSegments(101); // 3-segment windows, stride 2 → 50 passages
    const { embedder, batches } = fake();
    const progress: string[] = [];
    const n = await indexLecture(l.id, embedder, (d, t) => progress.push(`${d}/${t}`), database);
    expect(n).toBe(50);
    expect(batches).toEqual([32, 18]);
    expect(progress).toEqual(["0/50", "32/50", "50/50"]);
    const passages = await getPassages(l.id, database);
    expect(passages).toHaveLength(50);
    expect(passages[0]!.vector).toBeInstanceOf(Float32Array);
    expect(passages[0]!.text).toBe("segment 0 segment 1 segment 2");
    expect((await database.lectures.get(l.id))?.searchModel).toBe(EMBED_MODEL);
  });

  it("replaces an existing index instead of appending", async () => {
    const l = await lectureWithSegments(5);
    await indexLecture(l.id, fake().embedder, undefined, database);
    await indexLecture(l.id, fake().embedder, undefined, database);
    expect(await getPassages(l.id, database)).toHaveLength(2);
  });

  it("is cleared by re-transcription and deletion", async () => {
    const l = await lectureWithSegments(5);
    await indexLecture(l.id, fake().embedder, undefined, database);
    await resetTranscript(l.id, database);
    expect(await getPassages(l.id, database)).toEqual([]);
    expect((await database.lectures.get(l.id))?.searchModel).toBeUndefined();
    await indexLecture(l.id, fake().embedder, undefined, database);
    await deleteLecture(l.id, database);
    expect(await database.passages.count()).toBe(0);
  });
});

describe("needsIndex", () => {
  it("indexes finished lectures without a current index", () => {
    expect(needsIndex({ status: "done" })).toBe(true);
    expect(needsIndex({ status: "done", searchModel: "old-model" })).toBe(true);
    expect(needsIndex({ status: "done", searchModel: EMBED_MODEL })).toBe(false);
    expect(needsIndex({ status: "processing" })).toBe(false);
  });
});
