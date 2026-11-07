import type { Segment } from "@/types/transcript";

/**
 * Index of the segment playing at time `t`: the last segment that has started.
 * Gaps between segments keep the previous line highlighted, which reads better
 * than flickering off during pauses. Returns -1 before the first segment.
 * Segments must be sorted by start (the transcriber guarantees this).
 */
export function findActiveSegment(segments: readonly Segment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Imperative media helpers. Kept outside components so the React Compiler
 * lint doesn't treat DOM element writes as mutating props/state.
 */
export function seekMedia(media: HTMLMediaElement, t: number, play = false): void {
  const max = Number.isFinite(media.duration) ? media.duration : Infinity;
  media.currentTime = Math.max(0, Math.min(t, max));
  if (play) void media.play().catch(() => undefined); // autoplay policy may refuse
}

export function nudgeMedia(media: HTMLMediaElement, deltaSec: number): void {
  seekMedia(media, media.currentTime + deltaSec);
}

/** Video containers by extension, for files whose MIME type the OS didn't report. */
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i;

export function looksLikeVideo(file: { name: string; type: string }): boolean {
  if (file.type) return file.type.startsWith("video/");
  return VIDEO_EXT.test(file.name);
}
