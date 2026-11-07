import { formatTimestamp } from "../time";
import type { AssembledNotes, Card, ChunkNotes, KeyTerm, NotesSection, ReducePlan } from "./types";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** First definition wins; case/punctuation-insensitive. */
export function dedupeTerms(terms: readonly KeyTerm[]): KeyTerm[] {
  const seen = new Set<string>();
  return terms.filter((t) => {
    const k = norm(t.term);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Drop flashcards whose normalised question repeats an earlier one. */
export function dedupeCards(cards: readonly Card[]): Card[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    const k = norm(c.question);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function assembleNotes(chunks: readonly ChunkNotes[], plan: ReducePlan): AssembledNotes {
  const sections: NotesSection[] = plan.sections.map((s) => {
    const bullets = s.chunks.flatMap((i) => chunks[i]?.bullets ?? []);
    return { heading: s.heading, start: bullets[0]?.start ?? 0, bullets };
  });
  const keyTerms = dedupeTerms(chunks.flatMap((c) => c.terms)).sort((a, b) =>
    a.term.localeCompare(b.term),
  );
  const flashcards = dedupeCards(chunks.flatMap((c) => c.flashcards));
  const title = plan.title;
  const summary = plan.summary || chunks.map((c) => c.title).join("; ");

  return {
    title,
    summary,
    sections,
    keyTerms,
    flashcards,
    markdown: toMarkdown({ title, summary, sections, keyTerms }),
  };
}

export function toMarkdown(
  n: Pick<AssembledNotes, "title" | "summary" | "sections" | "keyTerms">,
): string {
  const out: string[] = [];
  if (n.title) out.push(`# ${n.title}`, "");
  if (n.summary) out.push("## Summary", "", n.summary, "");
  for (const s of n.sections) {
    out.push(`## ${s.heading}`, "");
    for (const b of s.bullets) out.push(`- ${b.text} [${formatTimestamp(b.start)}]`);
    out.push("");
  }
  if (n.keyTerms.length > 0) {
    out.push("## Key terms", "");
    for (const t of n.keyTerms) out.push(`- **${t.term}**: ${t.definition}`);
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}
