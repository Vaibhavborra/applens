/** Browser capabilities that decide which code paths later phases can use. */
export interface Capabilities {
  /** WebGPU present → Whisper on GPU + WebLLM notes. */
  webgpu: boolean;
  /** COOP/COEP headers active → SharedArrayBuffer → multi-threaded WASM. */
  crossOriginIsolated: boolean;
  indexedDB: boolean;
}

export function detectCapabilities(): Capabilities {
  return {
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    crossOriginIsolated: typeof window !== "undefined" && window.crossOriginIsolated,
    indexedDB: typeof indexedDB !== "undefined",
  };
}
