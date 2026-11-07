import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { looksLikeVideo } from "@/lib/playback";
import { encodeWav } from "@/lib/wav";

interface Props {
  file: File;
  /** Decoded 16 kHz audio; used to synthesise a WAV if the browser can't play the file. */
  fallbackPcm?: Float32Array | undefined;
  sampleRate: number;
  /** Receives the active <audio>/<video> element (it changes if we switch element type). */
  mediaRef: (el: HTMLMediaElement | null) => void;
}

/**
 * Plays the original file. Video files get a <video>; video containers with no
 * picture (e.g. audio-only .mp4) are switched to <audio>. If the browser can't
 * play the file at all, plays a WAV made from the decoded PCM instead.
 */
export function MediaPlayer({ file, fallbackPcm, sampleRate, mediaRef }: Props) {
  const [kind, setKind] = useState<"video" | "audio">(() =>
    looksLikeVideo(file) ? "video" : "audio",
  );
  const [failed, setFailed] = useState(false);
  const el = useRef<HTMLMediaElement | null>(null);
  const setEl = useCallback(
    (node: HTMLMediaElement | null) => {
      el.current = node;
      mediaRef(node);
    },
    [mediaRef],
  );

  // Only built once the original fails and decoded PCM exists (~115 MB per hour).
  const fallback = useMemo(
    () => (failed && fallbackPcm ? encodeWav(fallbackPcm, sampleRate) : null),
    [failed, fallbackPcm, sampleRate],
  );
  const source: Blob | null = failed ? fallback : file;
  const usingFallback = failed && fallback !== null;

  // Object URLs are an external resource: create/revoke alongside the element's src.
  useEffect(() => {
    const node = el.current;
    if (!node || !source) return;
    const url = URL.createObjectURL(source);
    node.src = url;
    return () => URL.revokeObjectURL(url);
  }, [source, kind]);

  if (failed && !fallback) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This format can't be played directly. Preparing playable audio…
      </p>
    );
  }

  const common = {
    ref: setEl,
    controls: true,
    preload: "auto" as const,
    "data-testid": "media",
    "data-fallback": usingFallback,
    onError: () => {
      if (!failed) setFailed(true);
    },
  };

  return (
    <div>
      {kind === "video" && !usingFallback ? (
        <video
          {...common}
          playsInline
          className="max-h-[50vh] w-full rounded-lg bg-black"
          onLoadedMetadata={(e) => {
            if (e.currentTarget.videoWidth === 0) setKind("audio");
          }}
        />
      ) : (
        <audio {...common} className="w-full" />
      )}
      {usingFallback && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Your browser can't play this file's format, so you're hearing the extracted audio.
        </p>
      )}
    </div>
  );
}
