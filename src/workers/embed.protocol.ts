export type EmbedRequest = { type: "embed"; id: number; texts: string[] };

export type EmbedResponse =
  | { type: "load-progress"; loaded: number; total: number }
  | { type: "result"; id: number; vectors: Float32Array[] }
  | { type: "error"; id: number; message: string };

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIMS = 384;
