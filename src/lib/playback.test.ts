import { describe, expect, it } from "vitest";
import { findActiveSegment, looksLikeVideo } from "./playback";

const segs = [
  { start: 0, end: 4, text: "a" },
  { start: 5, end: 9, text: "b" },
  { start: 9, end: 15, text: "c" },
];

describe("findActiveSegment", () => {
  it("finds the segment containing t", () => {
    expect(findActiveSegment(segs, 0)).toBe(0);
    expect(findActiveSegment(segs, 6)).toBe(1);
    expect(findActiveSegment(segs, 9)).toBe(2);
    expect(findActiveSegment(segs, 100)).toBe(2);
  });

  it("keeps the previous line through gaps", () => {
    expect(findActiveSegment(segs, 4.5)).toBe(0);
  });

  it("returns -1 before the first segment or when empty", () => {
    expect(findActiveSegment([{ start: 2, end: 3, text: "x" }], 1)).toBe(-1);
    expect(findActiveSegment([], 5)).toBe(-1);
  });
});

describe("looksLikeVideo", () => {
  it("prefers the MIME type", () => {
    expect(looksLikeVideo({ name: "x.mp4", type: "audio/mp4" })).toBe(false);
    expect(looksLikeVideo({ name: "x.bin", type: "video/webm" })).toBe(true);
  });

  it("falls back to the extension", () => {
    expect(looksLikeVideo({ name: "Lecture.MKV", type: "" })).toBe(true);
    expect(looksLikeVideo({ name: "talk.m4a", type: "" })).toBe(false);
  });
});
