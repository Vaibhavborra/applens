/** A slice of transcript sized to fit the notes model's context. */
export interface TranscriptChunk {
  index: number;
  start: number;
  end: number;
  /** Lines formatted as "[m:ss] text" for the prompt. */
  text: string;
}

export interface TimedText {
  text: string;
  /** Seconds from the start of the media. */
  start: number;
}

export interface KeyTerm {
  term: string;
  definition: string;
}

export interface Card {
  question: string;
  answer: string;
  sourceStart: number;
}

/** Validated output of the map step for one chunk. */
export interface ChunkNotes {
  title: string;
  bullets: TimedText[];
  terms: KeyTerm[];
  flashcards: Card[];
  /** true when JSON failed and we fell back to plain-text bullets. */
  fallback: boolean;
}

export interface ReducePlan {
  title: string;
  summary: string;
  /** Headings with the (0-based) chunk indices they cover, in order. */
  sections: { heading: string; chunks: number[] }[];
}

export interface NotesSection {
  heading: string;
  start: number;
  bullets: TimedText[];
}

export interface AssembledNotes {
  title: string;
  summary: string;
  sections: NotesSection[];
  keyTerms: KeyTerm[];
  flashcards: Card[];
  markdown: string;
}
