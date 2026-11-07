import { useState } from "react";
import { DropZone } from "@/components/DropZone";
import { ProgressBar } from "@/components/ProgressBar";
import { Waveform } from "@/components/Waveform";
import { decodeMediaFile, type DecodedAudio, type DecodeProgress } from "@/lib/audio";
import { detectCapabilities } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { formatTimestamp } from "@/lib/time";

type State =
  | { kind: "idle" }
  | { kind: "decoding"; file: File; progress: DecodeProgress }
  | { kind: "ready"; file: File; audio: DecodedAudio }
  | { kind: "error"; file: File; message: string };

export function App() {
  const [caps] = useState(detectCapabilities);
  const [state, setState] = useState<State>({ kind: "idle" });

  const handleFile = async (file: File) => {
    setState({ kind: "decoding", file, progress: { stage: "reading" } });
    try {
      const audio = await decodeMediaFile(file, (progress) =>
        setState({ kind: "decoding", file, progress }),
      );
      setState({ kind: "ready", file, audio });
    } catch (err) {
      console.error(err);
      setState({ kind: "error", file, message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="font-semibold tracking-tight">Lecture Notes AI</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Lecture recordings → notes, flashcards, search.
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Everything runs on your device. Your audio never leaves the browser.
        </p>

        <div className="mt-8">
          <DropZone onFile={(f) => void handleFile(f)} disabled={state.kind === "decoding"} />
        </div>

        {state.kind === "decoding" && <Decoding file={state.file} progress={state.progress} />}
        {state.kind === "ready" && <Decoded file={state.file} audio={state.audio} />}
        {state.kind === "error" && (
          <Card>
            <p className="font-medium text-red-600 dark:text-red-400" data-testid="decode-error">
              Couldn't read “{state.file.name}”
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{state.message}</p>
          </Card>
        )}

        <section className="mt-10 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Browser support</h2>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <Capability ok={caps.webgpu} label="WebGPU" hint="fast transcription + AI notes" />
            <Capability
              ok={caps.crossOriginIsolated}
              label="Cross-origin isolated"
              hint="multi-threaded WASM"
            />
            <Capability ok={caps.indexedDB} label="IndexedDB" hint="saved lectures" />
          </ul>
        </section>
      </main>
    </div>
  );
}

function describeProgress(p: DecodeProgress): { label: string; value?: number } {
  switch (p.stage) {
    case "reading":
      return { label: "Reading file…" };
    case "decoding":
      return { label: "Decoding audio…" };
    case "loading":
      return {
        label: `This format needs ffmpeg. Downloading converter (${formatBytes(p.received)} / ${formatBytes(p.total)}, first time only)…`,
        value: p.received / p.total,
      };
    case "converting":
      return {
        label: `Extracting audio with ffmpeg… ${Math.round(p.ratio * 100)}%`,
        value: p.ratio,
      };
  }
}

function Decoding({ file, progress }: { file: File; progress: DecodeProgress }) {
  const { label, value } = describeProgress(progress);
  return (
    <Card>
      <p className="truncate font-medium">{file.name}</p>
      <p className="mt-1 mb-3 text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      <ProgressBar label={label} value={value} />
    </Card>
  );
}

function Decoded({ file, audio }: { file: File; audio: DecodedAudio }) {
  return (
    <Card>
      <div data-testid="decode-result" data-method={audio.method} data-duration={audio.durationSec}>
        <p className="truncate font-medium">{file.name}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Stat label="Duration" value={formatTimestamp(audio.durationSec)} />
          <Stat label="File size" value={formatBytes(file.size)} />
          <Stat
            label="Decoded with"
            value={`${audio.method === "native" ? "Browser" : "ffmpeg.wasm"} · ${(audio.decodeMs / 1000).toFixed(1)}s`}
          />
          <Stat label="PCM" value={`16 kHz mono · ${formatBytes(audio.pcm.byteLength)}`} />
        </dl>
        <Waveform pcm={audio.pcm} className="mt-5 h-24 text-indigo-500 dark:text-indigo-400" />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </section>
  );
}

function Capability({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className={`mt-1.5 size-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      <span>
        <span className="font-medium">{label}</span>{" "}
        <span className="text-zinc-500 dark:text-zinc-400">
          {ok ? "" : "unavailable · "}
          {hint}
        </span>
      </span>
    </li>
  );
}
