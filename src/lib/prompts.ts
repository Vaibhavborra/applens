import { formatTimestamp } from "./time";
import type { ChunkNotes, TranscriptChunk } from "./notes/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SYSTEM = `You are a careful teaching assistant who turns lecture transcripts into study material.
Use only information stated in the transcript. Do not invent facts, examples or numbers.
Write in the same language as the transcript. Be concise and specific.`;

/**
 * Small models stop after a few bullets and skip the end of a chunk. The
 * grammar's minItems makes them keep going: ~1 bullet per 30 s of speech.
 */
export function minBullets(chunk: Pick<TranscriptChunk, "start" | "end">): number {
  return Math.max(3, Math.min(10, Math.round((chunk.end - chunk.start) / 30)));
}

/** JSON schema for the map step (grammar-constrained decoding in WebLLM). */
export function mapSchema(chunk: Pick<TranscriptChunk, "start" | "end">): string {
  return JSON.stringify({
    type: "object",
    properties: {
      title: { type: "string" },
      bullets: {
        type: "array",
        minItems: minBullets(chunk),
        maxItems: 12,
        items: {
          type: "object",
          properties: { text: { type: "string" }, t: { type: "string" } },
          required: ["text", "t"],
        },
      },
      terms: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          properties: { term: { type: "string" }, definition: { type: "string" } },
          required: ["term", "definition"],
        },
      },
      flashcards: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
            t: { type: "string" },
          },
          required: ["question", "answer", "t"],
        },
      },
    },
    required: ["title", "bullets", "terms", "flashcards"],
  });
}

export function mapPrompt(chunk: TranscriptChunk, total: number): ChatMessage[] {
  const n = minBullets(chunk);
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Below is part ${chunk.index + 1} of ${total} of a lecture transcript (${formatTimestamp(chunk.start)}–${formatTimestamp(chunk.end)}). Each line starts with its timestamp.

<transcript>
${chunk.text}
</transcript>

Return a JSON object with:
- "title": a specific 3–8 word title naming the topic(s) of this part.
- "bullets": at least ${n} bullets, one per distinct idea, in the order discussed, from the first line to the last. Each is {"text": one short sentence stating a single fact or idea, "t": the timestamp (like "12:34") of the line it comes from}. The last bullets must cover the end of the transcript.
- "terms": 1–5 technical terms that are defined or explained here, each {"term", "definition"} with a one-sentence definition taken from the transcript.
- "flashcards": 2–4 question/answer pairs testing the most important ideas, each {"question", "answer", "t"}. Answers are one or two sentences.`,
    },
  ];
}

/** Plain-text fallback when JSON fails twice. */
export function mapFallbackPrompt(chunk: TranscriptChunk): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `<transcript>
${chunk.text}
</transcript>

Write 3–8 concise study-note bullets for this transcript. Output only the bullets, one per line, each starting with "- ".`,
    },
  ];
}

/** Below this many parts, part titles are the headings and we don't ask the model to group. */
export const MIN_PARTS_TO_GROUP = 4;

export function reduceSchema(withSections: boolean): string {
  return JSON.stringify({
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      ...(withSections && {
        sections: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              parts: { type: "array", minItems: 1, items: { type: "integer" } },
            },
            required: ["heading", "parts"],
          },
        },
      }),
    },
    required: withSections ? ["title", "summary", "sections"] : ["title", "summary"],
  });
}

/**
 * The reduce step sees each part's title and top bullets (not the transcript),
 * so it fits the context window even for multi-hour lectures. `bulletsPerPart`
 * is lowered by the caller if the prompt is still too long.
 */
export function reducePrompt(parts: readonly ChunkNotes[], bulletsPerPart: number): ChatMessage[] {
  const n = parts.length;
  const group = n >= MIN_PARTS_TO_GROUP;
  const outline = parts
    .map((p, i) => {
      const bullets = p.bullets.slice(0, bulletsPerPart).map((b) => `   - ${b.text}`);
      return [
        `Part ${i + 1} [${formatTimestamp(p.bullets[0]?.start ?? 0)}]: ${p.title}`,
        ...bullets,
      ].join("\n");
    })
    .join("\n");
  const maxHeadings = Math.max(2, Math.min(8, Math.ceil(n / 2)));
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Here is an outline of a lecture, split into ${n} consecutive parts:

${outline}

Return a JSON object with:
- "title": a short, specific title for the whole lecture.
- "summary": 3–5 sentences summarising everything the lecture covers, from the first part to the last, and its main takeaways.${
        group
          ? `
- "sections": group the parts, in order, under 2–${maxHeadings} specific headings that name their topics. Each is {"heading", "parts": [part numbers]}. Use only part numbers 1 to ${n}; every one must appear exactly once, and parts in a section must be consecutive.`
          : ""
      }`,
    },
  ];
}
