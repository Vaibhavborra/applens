import type { Segment } from "@/types/transcript";
import { meanSquare } from "./chunking";

/** Same −60 dBFS RMS threshold as window-level silence skipping. */
const SILENCE_RMS = 0.001;

/**
 * Post-process one window's segments:
 * - drop segments over (near-)silent audio: Whisper's classic "you" / "Thank you."
 *   hallucinations on trailing silence;
 * - capitalise a segment that starts a sentence. Each window is decoded without the
 *   previous window's text, so Whisper often starts it lowercase mid-flow.
 */
export function cleanSegments(
  segments: readonly Segment[],
  pcm: Float32Array,
  sampleRate: number,
  previousText: string,
): Segment[] {
  const out: Segment[] = [];
  let prev = previousText.trim();
  for (const seg of segments) {
    const rms = Math.sqrt(
      meanSquare(pcm, Math.floor(seg.start * sampleRate), Math.ceil(seg.end * sampleRate)),
    );
    if (rms < SILENCE_RMS) continue;

    let text = capitaliseInner(seg.text.trim());
    if (!text) continue;
    if ((prev === "" || /[.?!]["')\]]?$/.test(prev)) && /^\p{Ll}/u.test(text)) {
      text = text[0]!.toUpperCase() + text.slice(1);
    }
    out.push({ ...seg, text });
    prev = text;
  }
  return out;
}

const ABBREVIATION = /^(e\.g|i\.e|etc|vs|cf|approx|dr|mr|mrs|ms|prof|fig|eq|no)$/i;

/** "is 1. that is" → "is 1. That is", but not after abbreviations like "e.g." or "Dr.". */
function capitaliseInner(text: string): string {
  return text.replace(
    /([.?!])(\s+)(\p{Ll})/gu,
    (match, punct: string, space: string, ch: string, offset: number) => {
      const word = /(\S+)$/.exec(text.slice(0, offset))?.[1] ?? "";
      if (punct === "." && (ABBREVIATION.test(word) || /^\p{L}$/u.test(word))) return match;
      return punct + space + ch.toUpperCase();
    },
  );
}
