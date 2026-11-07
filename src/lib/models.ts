export type ModelId = "fast" | "balanced" | "best";
export type Device = "webgpu" | "wasm";

/** Per-file precision, keyed by ONNX file name (see Transformers.js dtype docs). */
export type DtypeConfig = Record<"encoder_model" | "decoder_model_merged", string>;

export interface Variant {
  dtype: DtypeConfig;
  /** Download size in MB (encoder + decoder), for the "first run downloads" notice. */
  sizeMB: number;
}

export interface WhisperModel {
  id: ModelId;
  label: string;
  repo: string;
  blurb: string;
  /** WebGPU with shader-f16, WebGPU without f16, and WASM. null = unsupported. */
  variants: { webgpuF16: Variant; webgpu: Variant; wasm: Variant | null };
}

// Sizes from the onnx-community repos (Nov 2026). Encoders are kept at fp32/fp16
// where practical: quantising Whisper's encoder costs noticeably more accuracy
// than quantising the decoder.
export const MODELS: readonly WhisperModel[] = [
  {
    id: "fast",
    label: "Fast",
    repo: "onnx-community/whisper-base",
    blurb: "Whisper Base. Good for clear audio.",
    variants: {
      webgpuF16: { dtype: { encoder_model: "fp32", decoder_model_merged: "q4" }, sizeMB: 206 },
      webgpu: { dtype: { encoder_model: "fp32", decoder_model_merged: "q4" }, sizeMB: 206 },
      wasm: { dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, sizeMB: 77 },
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    repo: "onnx-community/whisper-small",
    blurb: "Whisper Small. Better with accents and jargon.",
    variants: {
      webgpuF16: { dtype: { encoder_model: "fp16", decoder_model_merged: "q4" }, sizeMB: 410 },
      webgpu: { dtype: { encoder_model: "fp32", decoder_model_merged: "q4" }, sizeMB: 586 },
      wasm: { dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, sizeMB: 249 },
    },
  },
  {
    id: "best",
    label: "Best",
    repo: "onnx-community/whisper-large-v3-turbo",
    blurb: "Whisper Large v3 Turbo. Most accurate; needs WebGPU.",
    variants: {
      webgpuF16: {
        dtype: { encoder_model: "q4f16", decoder_model_merged: "q4f16" },
        sizeMB: 564,
      },
      webgpu: { dtype: { encoder_model: "q4", decoder_model_merged: "q4" }, sizeMB: 759 },
      wasm: null,
    },
  },
];

export function getModel(id: ModelId): WhisperModel {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model ${id}`);
  return m;
}

export interface GpuInfo {
  webgpu: boolean;
  f16: boolean;
  /** e.g. "nvidia ampere"; null when unknown. */
  name?: string | null;
}

export function pickVariant(model: WhisperModel, device: Device, gpu: GpuInfo): Variant | null {
  if (device === "wasm") return model.variants.wasm;
  return gpu.f16 ? model.variants.webgpuF16 : model.variants.webgpu;
}

export function isModelId(x: unknown): x is ModelId {
  return x === "fast" || x === "balanced" || x === "best";
}
