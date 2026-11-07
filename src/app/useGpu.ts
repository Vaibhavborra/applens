import { useEffect, useState } from "react";
import { probeWebGpu } from "@/lib/env";
import type { GpuInfo } from "@/lib/models";

/** WebGPU availability; null until the (memoised) probe resolves. */
export function useGpu(): GpuInfo | null {
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void probeWebGpu().then((g) => alive && setGpu(g));
    return () => {
      alive = false;
    };
  }, []);
  return gpu;
}
