import type { Card } from "./notes/types";
import { speakerName } from "./speakers";
import { formatTimestamp } from "./time";
import type { Segment } from "@/types/transcript";

/** "Lecture 3: Graphs / BFS?" → "Lecture 3 - Graphs - BFS" (safe on Windows/macOS/Linux). */
export function safeFileName(title: string, fallback = "lecture"): string {
  const s = title
    .replace(/[<>:"/\\|?*]+/g, " - ")
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .replace(/\s+-\s+(-\s+)+/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, 100);
  return s || fallback;
}

/** "Name: " for a segment when speakers are shown (names given), else "". */
function speakerPrefix(s: Segment, names: readonly string[] | null): string {
  return names && s.speaker !== undefined ? `${speakerName(s.speaker, names)}: ` : "";
}

/** Plain transcript: one "[m:ss] text" line per segment, with speaker names if given. */
export function transcriptToTxt(
  segments: readonly Segment[],
  title?: string,
  speakerNames: readonly string[] | null = null,
): string {
  const lines = segments.map(
    (s) => `[${formatTimestamp(s.start)}] ${speakerPrefix(s, speakerNames)}${s.text.trim()}`,
  );
  return (title ? `${title}\n\n` : "") + lines.join("\n") + "\n";
}

/** 3725.5 → "01:02:05,500" */
export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/**
 * SubRip subtitles. Cues never overlap the next one and always last at least
 * `minSec`; long lines are wrapped at ~42 chars (two lines per cue max is a
 * convention players handle, more lines are fine too).
 */
export function transcriptToSrt(
  segments: readonly Segment[],
  minSec = 0.5,
  speakerNames: readonly string[] | null = null,
): string {
  const cues = segments
    .filter((s) => s.text.trim())
    .map((s, i, all) => {
      const next = all[i + 1];
      let end = Math.max(s.end, s.start + minSec);
      if (next && end > next.start) end = Math.max(s.start + 0.001, next.start);
      // Name the speaker where it changes (subtitle convention).
      const prefix = s.speaker !== all[i - 1]?.speaker ? speakerPrefix(s, speakerNames) : "";
      return `${i + 1}\n${srtTime(s.start)} --> ${srtTime(end)}\n${wrap(prefix + s.text.trim(), 42)}\n`;
    });
  return cues.join("\n");
}

function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function csvField(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

/**
 * Two-column CSV (front, back) that Anki imports directly (File → Import,
 * comma separated). The source timestamp is appended to the back so a card
 * can be traced to the recording. Fields are always quoted; newlines kept.
 */
export function flashcardsToCsv(cards: readonly Card[]): string {
  return (
    cards
      .map((c) =>
        [csvField(c.question), csvField(`${c.answer} (${formatTimestamp(c.sourceStart)})`)].join(
          ",",
        ),
      )
      .join("\r\n") + "\r\n"
  );
}

/** Trigger a browser download of text content. */
export function downloadText(fileName: string, content: string, mime: string): void {
  // BOM so Excel/Notepad open UTF-8 CSV/text with accents intact.
  const blob = new Blob(["﻿", content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
