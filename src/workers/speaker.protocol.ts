export type SpeakerRequest = {
  type: "run";
  pcm: Float32Array;
  sampleRate: number;
  /** [startSec, endSec] per segment to fingerprint. */
  ranges: [number, number][];
};

export type SpeakerResponse =
  | { type: "load-progress"; loaded: number; total: number }
  | { type: "progress"; done: number; total: number }
  /** null where a range had too little speech to fingerprint. */
  | { type: "result"; vectors: (Float32Array | null)[] }
  | { type: "error"; message: string };

/**
 * WeSpeaker ResNet34 (the embedding model pyannote uses): 256-d voice prints,
 * 6.7 MB at q8 with the same accuracy as fp32 on our fixtures. (WavLM-SV's q8
 * build was tried first and its embeddings were unusable.)
 */
export const SPEAKER_MODEL = "onnx-community/wespeaker-voxceleb-resnet34-LM";
export const SPEAKER_MODEL_MB = 7;
/**
 * Average-linkage cosine threshold. Measured: same voice ≥ 0.87, different
 * voices ≤ 0.22, one lecturer's segments ~0.77 on average.
 */
export const SPEAKER_THRESHOLD = 0.45;
