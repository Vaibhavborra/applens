import type { Device, GpuInfo } from "./models";

/** Browser capabilities that decide which code paths later phases can use. */
export interface Capabilities {
  /** COOP/COEP headers active → SharedArrayBuffer → multi-threaded WASM. */
  crossOriginIsolated: boolean;
  indexedDB: boolean;
}

export function detectCapabilities(): Capabilities {
  return {
    crossOriginIsolated: typeof window !== "undefined" && window.crossOriginIsolated,
    indexedDB: typeof indexedDB !== "undefined",
  };
}

interface MinimalGpu {
  requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null>;
}

let probe: Promise<GpuInfo> | null = null;

/**
 * `navigator.gpu` existing isn't enough (blocklisted GPUs return no adapter),
 * so actually request one. Memoised: every caller shares one probe.
 */
export function probeWebGpu(): Promise<GpuInfo> {
  probe ??= doProbe();
  return probe;
}

async function doProbe(): Promise<GpuInfo> {
  const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu;
  if (!gpu) return { webgpu: false, f16: false };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { webgpu: false, f16: false };
    return { webgpu: true, f16: adapter.features.has("shader-f16") };
  } catch {
    return { webgpu: false, f16: false };
  }
}

/** `?device=wasm` forces the WASM path (for testing / debugging GPU issues). */
export function forcedDevice(): Device | null {
  if (typeof location === "undefined") return null;
  const d = new URLSearchParams(location.search).get("device");
  return d === "wasm" || d === "webgpu" ? d : null;
}
