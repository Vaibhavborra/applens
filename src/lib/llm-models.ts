export type NotesModelId = "fast" | "better";

export interface NotesModel {
  id: NotesModelId;
  label: string;
  /** MLC base name; quantisation suffix depends on shader-f16 support. */
  base: string;
  blurb: string;
  /** Download size in MB (same for q4f16 and q4f32 builds). */
  sizeMB: number;
}

// Qwen2.5 Instruct: strong at following JSON schemas for its size, 32K-trained,
// no "thinking" mode to suppress. Sizes from the mlc-ai HF repos (Nov 2026).
export const NOTES_MODELS: readonly NotesModel[] = [
  {
    id: "fast",
    label: "Fast",
    base: "Qwen2.5-1.5B-Instruct",
    blurb: "Qwen2.5 1.5B. Good notes, runs on most GPUs.",
    sizeMB: 880,
  },
  {
    id: "better",
    label: "Better",
    base: "Qwen2.5-3B-Instruct",
    blurb: "Qwen2.5 3B. More accurate; needs ~3 GB of GPU memory.",
    sizeMB: 1748,
  },
];

export function getNotesModel(id: NotesModelId): NotesModel {
  return NOTES_MODELS.find((m) => m.id === id) ?? NOTES_MODELS[0]!;
}

/** q4f16 needs the WebGPU shader-f16 feature; q4f32 runs everywhere WebGPU does. */
export function mlcModelId(id: NotesModelId, f16: boolean): string {
  return `${getNotesModel(id).base}-${f16 ? "q4f16_1" : "q4f32_1"}-MLC`;
}

export function isNotesModelId(x: unknown): x is NotesModelId {
  return x === "fast" || x === "better";
}
