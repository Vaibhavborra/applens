import { describe, expect, it } from "vitest";
import { flashcardsToCsv, safeFileName, srtTime, transcriptToSrt, transcriptToTxt } from "./export";

const segs = [
  { start: 0, end: 4.2, text: " Welcome to the lecture. " },
  {
    start: 4,
    end: 9.5,
    text: "Today we talk about recursion and why every recursive function needs a base case.",
  },
  { start: 65, end: 65, text: "Short." },
  { start: 70, end: 72, text: "   " },
];

describe("safeFileName", () => {
  it("removes characters that are illegal in file names", () => {
    expect(safeFileName('Lecture 3: Graphs / "BFS"?')).toBe("Lecture 3 - Graphs - BFS");
    expect(safeFileName("  ...  ")).toBe("lecture");
    expect(safeFileName("a\u0007b")).toBe("ab");
  });
});

describe("transcriptToTxt", () => {
  it("writes one timestamped line per segment, with an optional title", () => {
    expect(transcriptToTxt(segs.slice(0, 1), "Intro")).toBe(
      "Intro\n\n[0:00] Welcome to the lecture.\n",
    );
    expect(transcriptToTxt(segs.slice(2, 3))).toBe("[1:05] Short.\n");
  });
});

describe("srt", () => {
  it("formats SRT timestamps", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(3725.5)).toBe("01:02:05,500");
    expect(srtTime(59.9996)).toBe("00:01:00,000");
  });

  it("numbers cues, prevents overlap, enforces a minimum length, wraps and skips blanks", () => {
    const srt = transcriptToSrt(segs);
    const cues = srt.trim().split("\n\n");
    expect(cues).toHaveLength(3);
    expect(cues[0]).toBe("1\n00:00:00,000 --> 00:00:04,000\nWelcome to the lecture."); // clipped to next start
    expect(cues[1]!.split("\n")[0]).toBe("2");
    expect(
      cues[1]!
        .split("\n")
        .slice(2)
        .every((l) => l.length <= 42),
    ).toBe(true);
    expect(cues[2]).toBe("3\n00:01:05,000 --> 00:01:05,500\nShort."); // zero-length → 0.5 s
  });
});

describe("flashcardsToCsv", () => {
  it("quotes fields, escapes quotes and appends the source time", () => {
    const csv = flashcardsToCsv([
      { question: 'What does "O(n)" mean?', answer: "Linear time,\nroughly.", sourceStart: 75 },
    ]);
    expect(csv).toBe('"What does ""O(n)"" mean?","Linear time,\nroughly. (1:15)"\r\n');
  });
});
