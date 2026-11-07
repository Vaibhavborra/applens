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

interface MinimalAdapter {
  features: { has(name: string): boolean };
  info?: { vendor?: string; architecture?: string; description?: string };
}

interface MinimalGpu {
  requestAdapter(opts?: {
    powerPreference?: "high-performance" | "low-power";
  }): Promise<MinimalAdapter | null>;
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
    // Same preference WebLLM uses, so the reported GPU matches the one notes run on.
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { webgpu: false, f16: false };
    const i = adapter.info;
    const name = [i?.vendor, i?.architecture || i?.description].filter(Boolean).join(" ") || null;
    return { webgpu: true, f16: adapter.features.has("shader-f16"), name };
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
