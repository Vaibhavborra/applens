import { useEffect, useMemo, useRef } from "react";
import { computePeaks } from "@/lib/pcm";

const PEAK_BUCKETS = 4000;

/** Static min/max waveform. Colour comes from CSS `color` (currentColor). */
export function Waveform({ pcm, className = "" }: { pcm: Float32Array; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const peaks = useMemo(() => computePeaks(pcm, PEAK_BUCKETS), [pcm]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(el.clientWidth * dpr));
      const height = Math.max(1, Math.round(el.clientHeight * dpr));
      el.width = width;
      el.height = height;
      const ctx = el.getContext("2d");
      if (!ctx) return;

      // Normalise so quiet recordings are still visible.
      let peak = 0;
      for (let i = 0; i < peaks.max.length; i++) {
        peak = Math.max(peak, peaks.max[i]!, -peaks.min[i]!);
      }
      const gain = peak > 0 ? 0.95 / peak : 1;
      const mid = height / 2;
      const n = peaks.max.length;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = getComputedStyle(el).color;
      for (let x = 0; x < width; x++) {
        const from = Math.floor((x / width) * n);
        const to = Math.max(from + 1, Math.floor(((x + 1) / width) * n));
        let lo = 0;
        let hi = 0;
        for (let b = from; b < to && b < n; b++) {
          lo = Math.min(lo, peaks.min[b]!);
          hi = Math.max(hi, peaks.max[b]!);
        }
        const top = mid - hi * gain * mid;
        const bottom = mid - lo * gain * mid;
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [peaks]);

  return (
    <canvas
      ref={canvas}
      aria-label="Audio waveform"
      role="img"
      className={`block w-full ${className}`}
    />
  );
}
