import { useCallback, useEffect, useRef, useState } from "react";
import { looksLikeVideo } from "@/lib/playback";
import { encodeWav } from "@/lib/wav";

interface Props {
  source: Blob;
  fileName: string;
  fileType: string;
  /**
   * Decoded 16 kHz mono PCM, fetched lazily only if the browser can't play
   * `source` (a live job already has it; a reopened lecture re-decodes).
   */
  loadFallbackPcm: () => Promise<Float32Array>;
  sampleRate: number;
  /** Receives the active <audio>/<video> element (it changes if we switch element type). */
  mediaRef: (el: HTMLMediaElement | null) => void;
}

type Fallback =
  | { state: "none" }
  | { state: "loading" }
  | { state: "ready"; blob: Blob }
  | { state: "failed"; message: string };

/**
 * Plays the original file. Video files get a <video>; video containers with no
 * picture (e.g. audio-only .mp4) are switched to <audio>. If the browser can't
 * play the file at all, plays a WAV made from the decoded PCM instead.
 */
export function MediaPlayer({
  source,
  fileName,
  fileType,
  loadFallbackPcm,
  sampleRate,
  mediaRef,
}: Props) {
  const [kind, setKind] = useState<"video" | "audio">(() =>
    looksLikeVideo({ name: fileName, type: fileType }) ? "video" : "audio",
  );
  const [fallback, setFallback] = useState<Fallback>({ state: "none" });
  const el = useRef<HTMLMediaElement | null>(null);
  const setEl = useCallback(
    (node: HTMLMediaElement | null) => {
      el.current = node;
      mediaRef(node);
    },
    [mediaRef],
  );

  const blob =
    fallback.state === "ready" ? fallback.blob : fallback.state === "none" ? source : null;

  // Object URLs are an external resource: create/revoke alongside the element's src.
  useEffect(() => {
    const node = el.current;
    if (!node || !blob) return;
    const url = URL.createObjectURL(blob);
    node.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob, kind]);

  const onError = () => {
    if (fallback.state !== "none") return;
    setFallback({ state: "loading" });
    loadFallbackPcm().then(
      (pcm) => setFallback({ state: "ready", blob: encodeWav(pcm, sampleRate) }),
      (e: unknown) =>
        setFallback({ state: "failed", message: e instanceof Error ? e.message : String(e) }),
    );
  };

  if (fallback.state === "loading") {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This format can't be played directly. Preparing playable audio…
      </p>
    );
  }
  if (fallback.state === "failed") {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Couldn't play this file: {fallback.message}
      </p>
    );
  }

  const usingFallback = fallback.state === "ready";
  const common = {
    ref: setEl,
    controls: true,
    preload: "auto" as const,
    "data-testid": "media",
    "data-fallback": usingFallback,
    onError,
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
