import { useEffect, useRef } from "react";
import type { Peaks } from "@/lib/pcm";
import { nudgeMedia, seekMedia } from "@/lib/playback";
import { formatTimestamp } from "@/lib/time";

interface Props {
  /** Min/max buckets from computePeaks (stored with the lecture). */
  peaks: Peaks;
  /** Duration of the audio in seconds. */
  durationSec: number;
  /** When given, shows a playhead and click/keyboard seeking. */
  media?: HTMLMediaElement | null;
  className?: string;
}

/** Min/max waveform. Colour comes from CSS `color` (currentColor). */
export function Waveform({ peaks, durationSec, media = null, className = "" }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

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

  // Move the playhead with a style write per frame: no React re-renders.
  useEffect(() => {
    const head = playhead.current;
    if (!media || !head) return;
    let raf = 0;
    const place = () => {
      const ratio = durationSec > 0 ? Math.min(1, media.currentTime / durationSec) : 0;
      head.style.left = `${ratio * 100}%`;
      box.current?.setAttribute("aria-valuenow", String(Math.round(media.currentTime)));
      box.current?.setAttribute("aria-valuetext", formatTimestamp(media.currentTime));
    };
    const loop = () => {
      place();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      loop();
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      place();
    };
    media.addEventListener("play", start);
    media.addEventListener("pause", stop);
    media.addEventListener("seeked", place);
    media.addEventListener("ended", stop);
    if (media.paused) place();
    else start();
    return () => {
      cancelAnimationFrame(raf);
      media.removeEventListener("play", start);
      media.removeEventListener("pause", stop);
      media.removeEventListener("seeked", place);
      media.removeEventListener("ended", stop);
    };
  }, [media, durationSec]);

  const seekTo = (ratio: number) => {
    if (media) seekMedia(media, Math.max(0, Math.min(1, ratio)) * durationSec);
  };

  // Same element tree with or without media, so the canvas isn't recreated
  // (the draw effect only re-runs when the peaks change).
  const interactive = media
    ? {
        role: "slider",
        tabIndex: 0,
        "aria-label": "Seek",
        "aria-valuemin": 0,
        "aria-valuemax": Math.round(durationSec),
        onClick: (e: React.MouseEvent<HTMLDivElement>) => {
          const r = e.currentTarget.getBoundingClientRect();
          seekTo((e.clientX - r.left) / r.width);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            nudgeMedia(media, e.key === "ArrowLeft" ? -5 : 5);
          }
        },
      }
    : { role: "img", "aria-label": "Audio waveform" };

  return (
    <div
      ref={box}
      {...interactive}
      data-testid="waveform"
      className={`relative rounded outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${media ? "cursor-pointer" : ""} ${className}`}
    >
      <canvas ref={canvas} aria-hidden className="block h-full w-full" />
      <div
        ref={playhead}
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-zinc-900 dark:bg-white ${media ? "" : "hidden"}`}
        style={{ left: "0%" }}
      />
    </div>
  );
}
