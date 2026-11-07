import type { Segment } from "@/types/transcript";
import { formatTimestamp } from "../time";
import type { TranscriptChunk } from "./types";

/**
 * Rough token estimate (~4 chars/token for English BPE vocabularies). We only
 * need it to stay comfortably inside a 4K context, not to be exact.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatLine(s: Segment): string {
  return `[${formatTimestamp(s.start)}] ${s.text.trim()}`;
}

/**
 * Group consecutive segments into chunks of at most ~maxTokens, never splitting
 * a segment. A single over-long segment becomes its own chunk.
 */
export function chunkTranscript(segments: readonly Segment[], maxTokens = 1500): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let lines: string[] = [];
  let tokens = 0;
  let start = 0;
  let end = 0;

  const flush = () => {
    if (lines.length === 0) return;
    chunks.push({ index: chunks.length, start, end, text: lines.join("\n") });
    lines = [];
    tokens = 0;
  };

  for (const s of segments) {
    const line = formatLine(s);
    const t = estimateTokens(line) + 1;
    if (lines.length > 0 && tokens + t > maxTokens) flush();
    if (lines.length === 0) start = s.start;
    lines.push(line);
    tokens += t;
    end = s.end;
  }
  flush();
  return chunks;
}
