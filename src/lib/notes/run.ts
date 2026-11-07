import type { Segment } from "@/types/transcript";
import {
  mapFallbackPrompt,
  mapSchema,
  MIN_PARTS_TO_GROUP,
  mapPrompt,
  reduceSchema,
  reducePrompt,
  type ChatMessage,
} from "../prompts";
import { assembleNotes } from "./assemble";
import { chunkTranscript, estimateTokens } from "./chunk";
import type { AssembledNotes, ChunkNotes } from "./types";
import { fallbackChunkNotes, parseChunkNotes, parseReducePlan } from "./validate";

/** What the orchestrator needs from a language model (WebLLM, Ollama, or a test fake). */
export interface NotesLLM {
  /** `schema` set → constrained JSON output. Returns the raw completion text. */
  complete(messages: ChatMessage[], opts: { schema?: string; maxTokens: number }): Promise<string>;
}

export type NotesProgress = { stage: "map"; done: number; total: number } | { stage: "reduce" };

export class NotesCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "NotesCancelled";
  }
}

export interface RunNotesOptions {
  onProgress?: (p: NotesProgress) => void;
  isCancelled?: () => boolean;
  /**
   * Per-chunk transcript budget (~3–4 min of speech). Small models compress a
   * long chunk into a few vague bullets, so smaller chunks give fuller notes.
   */
  chunkTokens?: number;
}

/** Budget for the reduce prompt's outline (4K context minus prompt and output). */
const REDUCE_OUTLINE_TOKENS = 2600;

/**
 * Map-reduce notes generation:
 *  map    – per ~1.5K-token chunk: title, timestamped bullets, terms, flashcards
 *           (JSON; one retry; then plain-text bullets);
 *  reduce – from part titles + top bullets: lecture title, summary, and a
 *           grouping of parts under headings (repaired if invalid).
 * Final notes are assembled from the map output, so nothing is lost in reduce.
 */
export async function runNotes(
  segments: readonly Segment[],
  llm: NotesLLM,
  { onProgress, isCancelled = () => false, chunkTokens = 500 }: RunNotesOptions = {},
): Promise<AssembledNotes & { fallbackParts: number }> {
  const chunks = chunkTranscript(segments, chunkTokens);
  if (chunks.length === 0) throw new Error("There's no transcript to write notes from.");
  const check = () => {
    if (isCancelled()) throw new NotesCancelled();
  };

  const parts: ChunkNotes[] = [];
  for (const chunk of chunks) {
    check();
    onProgress?.({ stage: "map", done: parts.length, total: chunks.length });
    let notes: ChunkNotes | null = null;
    for (let attempt = 0; attempt < 2 && !notes; attempt++) {
      const raw = await llm.complete(mapPrompt(chunk, chunks.length), {
        schema: mapSchema(chunk),
        maxTokens: 900,
      });
      check();
      notes = parseChunkNotes(raw, chunk);
    }
    if (!notes) {
      const raw = await llm.complete(mapFallbackPrompt(chunk), { maxTokens: 500 });
      check();
      notes = fallbackChunkNotes(raw, chunk);
    }
    parts.push(notes);
  }
  onProgress?.({ stage: "map", done: parts.length, total: chunks.length });

  check();
  onProgress?.({ stage: "reduce" });
  let bulletsPerPart = 3;
  let messages = reducePrompt(parts, bulletsPerPart);
  while (
    bulletsPerPart > 0 &&
    estimateTokens(messages.map((m) => m.content).join("\n")) > REDUCE_OUTLINE_TOKENS
  ) {
    bulletsPerPart--;
    messages = reducePrompt(parts, bulletsPerPart);
  }
  const titles = parts.map((p) => p.title);
  let plan = parseReducePlan("", titles);
  for (let attempt = 0; attempt < 2; attempt++) {
    const group = parts.length >= MIN_PARTS_TO_GROUP;
    const raw = await llm.complete(messages, { schema: reduceSchema(group), maxTokens: 700 });
    check();
    // Too few parts to group: parseReducePlan falls back to one section per part (titled).
    plan = parseReducePlan(raw, titles);
    if (!group) plan = { ...plan, sections: parseReducePlan("", titles).sections };
    if (plan.summary) break;
  }

  return { ...assembleNotes(parts, plan), fallbackParts: parts.filter((p) => p.fallback).length };
}
