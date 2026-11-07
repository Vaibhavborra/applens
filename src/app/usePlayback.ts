import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { findActiveSegment, nudgeMedia, seekMedia } from "@/lib/playback";
import type { Segment } from "@/types/transcript";

/** Holds the current media element and exposes seek. */
export function useMediaElement() {
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const mediaRef = useCallback((el: HTMLMediaElement | null) => setMedia(el), []);
  const seek = useCallback(
    (t: number, play = true) => {
      if (media) seekMedia(media, t, play);
    },
    [media],
  );
  return { media, mediaRef, seek };
}

const noop = () => undefined;

/**
 * Subscribe to a media element's playback position. While playing, notifies
 * every animation frame; React only re-renders when the snapshot changes.
 */
function usePlaybackSubscription(media: HTMLMediaElement | null) {
  return useCallback(
    (notify: () => void) => {
      if (!media) return noop;
      let raf = 0;
      const loop = () => {
        notify();
        raf = requestAnimationFrame(loop);
      };
      const onPlay = () => {
        cancelAnimationFrame(raf);
        loop();
      };
      const onStop = () => {
        cancelAnimationFrame(raf);
        notify();
      };
      const events: [string, () => void][] = [
        ["play", onPlay],
        ["pause", onStop],
        ["ended", onStop],
        ["seeked", notify],
        ["emptied", notify],
        ["loadedmetadata", notify],
      ];
      for (const [ev, fn] of events) media.addEventListener(ev, fn);
      if (!media.paused) onPlay();
      return () => {
        cancelAnimationFrame(raf);
        for (const [ev, fn] of events) media.removeEventListener(ev, fn);
      };
    },
    [media],
  );
}

/** Index of the segment under the playhead, or -1. */
export function useActiveSegment(media: HTMLMediaElement | null, segments: readonly Segment[]) {
  const subscribe = usePlaybackSubscription(media);
  return useSyncExternalStore(subscribe, () =>
    media ? findActiveSegment(segments, media.currentTime) : -1,
  );
}

export function useIsPlaying(media: HTMLMediaElement | null): boolean {
  const subscribe = usePlaybackSubscription(media);
  return useSyncExternalStore(subscribe, () => (media ? !media.paused && !media.ended : false));
}

const INTERACTIVE =
  "input, textarea, select, button, a, [role=button], [role=slider], audio, video, [contenteditable]";

/** Space = play/pause, ←/→ = ±5 s, unless focus is on a control. */
export function usePlayerShortcuts(media: HTMLMediaElement | null) {
  useEffect(() => {
    if (!media) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && t.closest(INTERACTIVE)) return;
      if (e.key === " ") {
        e.preventDefault();
        if (media.paused) void media.play().catch(noop);
        else media.pause();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        nudgeMedia(media, e.key === "ArrowLeft" ? -5 : 5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media]);
}
