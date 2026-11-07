import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendSegments,
  attachMedia,
  createLecture,
  deleteLecture,
  getSegments,
  LectureDB,
  markInterrupted,
  removeMedia,
  resetTranscript,
  titleFromFileName,
} from "./db";

let database: LectureDB;
const opts = { keepMedia: true, model: "fast", device: "wasm" } as const;
const file = () =>
  new File([new Uint8Array([1, 2, 3])], "CS101_lecture-3.mp3", { type: "audio/mpeg" });

beforeEach(() => {
  database = new LectureDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

describe("titleFromFileName", () => {
  it("strips the extension and underscores", () => {
    expect(titleFromFileName("CS101_lecture-3.mp3")).toBe("CS101 lecture-3");
    expect(titleFromFileName(".mp4")).toBe("Untitled lecture");
  });
});

describe("lecture lifecycle", () => {
  it("creates a lecture with media and reads it back", async () => {
    const l = await createLecture(file(), opts, database);
    expect(l.status).toBe("processing");
    expect((await database.lectures.get(l.id))?.hasMedia).toBe(true);
    const media = await database.media.get(l.id);
    expect(media?.blob.size).toBe(3);
  });

  it("skips media when keepMedia is off", async () => {
    const l = await createLecture(file(), { ...opts, keepMedia: false }, database);
    expect(l.hasMedia).toBe(false);
    expect(await database.media.count()).toBe(0);
  });

  it("returns segments ordered by start, scoped to the lecture", async () => {
    const a = await createLecture(file(), opts, database);
    const b = await createLecture(file(), opts, database);
    await appendSegments(a.id, [{ start: 30, end: 35, text: "second" }], database);
    await appendSegments(b.id, [{ start: 0, end: 1, text: "other lecture" }], database);
    await appendSegments(a.id, [{ start: 0, end: 5, text: "first" }], database);
    expect((await getSegments(a.id, database)).map((s) => s.text)).toEqual(["first", "second"]);
  });

  it("stores waveform peaks as typed arrays", async () => {
    const l = await createLecture(file(), opts, database);
    const peaks = { min: new Float32Array([-0.5, -0.1]), max: new Float32Array([0.5, 0.2]) };
    await database.lectures.update(l.id, { peaks, durationSec: 12.5 });
    const back = await database.lectures.get(l.id);
    expect(back?.peaks?.min).toBeInstanceOf(Float32Array);
    expect(Array.from(back!.peaks!.max)).toEqual([0.5, Math.fround(0.2)]);
  });

  it("deletes a lecture with its segments and media", async () => {
    const l = await createLecture(file(), opts, database);
    const keep = await createLecture(file(), opts, database);
    await appendSegments(l.id, [{ start: 0, end: 1, text: "x" }], database);
    await appendSegments(keep.id, [{ start: 0, end: 1, text: "y" }], database);
    await deleteLecture(l.id, database);
    expect(await database.lectures.get(l.id)).toBeUndefined();
    expect(await database.media.get(l.id)).toBeUndefined();
    expect(await getSegments(l.id, database)).toEqual([]);
    expect(await getSegments(keep.id, database)).toHaveLength(1);
  });

  it("removes and re-attaches media without touching the transcript", async () => {
    const l = await createLecture(file(), opts, database);
    await appendSegments(l.id, [{ start: 0, end: 1, text: "x" }], database);
    await removeMedia(l.id, database);
    expect((await database.lectures.get(l.id))?.hasMedia).toBe(false);
    expect(await database.media.get(l.id)).toBeUndefined();
    expect(await getSegments(l.id, database)).toHaveLength(1);
    await attachMedia(l.id, new Blob(["abcd"]), database);
    expect((await database.lectures.get(l.id))?.hasMedia).toBe(true);
    expect((await database.media.get(l.id))?.blob.size).toBe(4);
  });

  it("resets a transcript for another run", async () => {
    const l = await createLecture(file(), opts, database);
    await appendSegments(l.id, [{ start: 0, end: 1, text: "x" }], database);
    await database.lectures.update(l.id, { status: "cancelled", transcribeMs: 5 });
    await resetTranscript(l.id, database);
    const back = await database.lectures.get(l.id);
    expect(back?.status).toBe("processing");
    expect(back?.transcribeMs).toBeUndefined();
    expect(await getSegments(l.id, database)).toEqual([]);
  });

  it("marks only inactive processing lectures as interrupted", async () => {
    const running = await createLecture(file(), opts, database);
    const stale = await createLecture(file(), opts, database);
    const done = await createLecture(file(), opts, database);
    await database.lectures.update(done.id, { status: "done" });
    const n = await markInterrupted((id) => id === running.id, database);
    expect(n).toBe(1);
    expect((await database.lectures.get(running.id))?.status).toBe("processing");
    expect((await database.lectures.get(stale.id))?.status).toBe("interrupted");
    expect((await database.lectures.get(done.id))?.status).toBe("done");
  });
});
