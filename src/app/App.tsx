import { useEffect, useState } from "react";
import { DropZone } from "@/components/DropZone";
import { ModelPicker } from "@/components/ModelPicker";
import { Steps, type StepView } from "@/components/Steps";
import { TranscriptView } from "@/components/TranscriptView";
import { Waveform } from "@/components/Waveform";
import type { DecodeProgress } from "@/lib/audio";
import { detectCapabilities, forcedDevice, probeWebGpu } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import {
  getModel,
  isModelId,
  pickVariant,
  type Device,
  type GpuInfo,
  type ModelId,
} from "@/lib/models";
import { formatTimestamp } from "@/lib/time";
import { useTranscriptionJob, type Job } from "./useTranscriptionJob";

const MODEL_KEY = "lna.model";

function loadSavedModel(): ModelId {
  try {
    const v = localStorage.getItem(MODEL_KEY);
    if (isModelId(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return "fast";
}

export function App() {
  const [caps] = useState(detectCapabilities);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [model, setModel] = useState<ModelId>(loadSavedModel);
  const { job, start, cancel, busy } = useTranscriptionJob();

  useEffect(() => {
    void probeWebGpu().then(setGpu);
  }, []);

  const device = resolveDevice(gpu);
  const effectiveModel = resolveModel(model, device, gpu);

  const chooseModel = (id: ModelId) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* storage unavailable */
    }
  };

  // The GPU probe usually resolves in a few ms, but a file can arrive first; wait for it.
  const onFile = (file: File) => {
    void probeWebGpu().then((g) => {
      const d = resolveDevice(g);
      return start(file, { model: resolveModel(model, d, g), device: d, f16: g.f16 });
    });
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

        <div className="mt-8 space-y-5">
          {gpu && (
            <ModelPicker
              value={effectiveModel}
              onChange={chooseModel}
              device={device}
              gpu={gpu}
              disabled={busy}
            />
          )}
          <DropZone onFile={onFile} disabled={busy} />
        </div>

        {job && <JobView job={job} onCancel={cancel} />}

        <section className="mt-10 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Browser support</h2>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <Capability
              ok={gpu?.webgpu ?? false}
              label="WebGPU"
              hint={gpu === null ? "checking…" : "fast transcription + AI notes"}
            />
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

function resolveDevice(gpu: GpuInfo | null): Device {
  return forcedDevice() ?? (gpu?.webgpu ? "webgpu" : "wasm");
}

/** Fall back if the saved choice can't run here (e.g. "best" without WebGPU). */
function resolveModel(model: ModelId, device: Device, gpu: GpuInfo | null): ModelId {
  return gpu && !pickVariant(getModel(model), device, gpu) ? "fast" : model;
}

function decodeDetail(p: DecodeProgress | undefined): { detail: string; progress?: number } {
  switch (p?.stage) {
    case undefined:
    case "reading":
      return { detail: "Reading file…" };
    case "decoding":
      return { detail: "Decoding…" };
    case "loading":
      return {
        detail: `Downloading ffmpeg ${formatBytes(p.received)} / ${formatBytes(p.total)} (first time only)`,
        progress: p.received / p.total,
      };
    case "converting":
      return {
        detail: `Extracting audio with ffmpeg ${Math.round(p.ratio * 100)}%`,
        progress: p.ratio,
      };
  }
}

function buildSteps(job: Job): StepView[] {
  const { decode, load, transcribe } = job;
  const audio = decode.audio;
  const d = decodeDetail(decode.progress);

  const loadDetail =
    load.status === "error"
      ? load.error
      : load.info
        ? `${load.info.device === "webgpu" ? "WebGPU" : "WASM"} · ${load.info.dtype}`
        : load.total > 0
          ? `${formatBytes(load.loaded)} / ${formatBytes(load.total)}`
          : "Starting…";

  let tDetail: string | undefined;
  if (transcribe.status === "active" && transcribe.total > 0) {
    const eta =
      transcribe.etaMs !== undefined ? ` · ~${formatTimestamp(transcribe.etaMs / 1000)} left` : "";
    tDetail = `${Math.round((transcribe.done / transcribe.total) * 100)}%${eta}`;
  } else if (transcribe.status === "done" && transcribe.ms !== undefined && audio) {
    const speed = audio.durationSec / (transcribe.ms / 1000);
    tDetail = `${formatTimestamp(transcribe.ms / 1000)} · ${speed.toFixed(1)}× realtime`;
  } else if (transcribe.cancelled) {
    tDetail = "Cancelled";
  } else if (transcribe.error) {
    tDetail = transcribe.error;
  }

  return [
    {
      id: "decode",
      label: "Decoding audio",
      status: decode.status,
      detail:
        decode.status === "error"
          ? decode.error
          : audio
            ? `${formatTimestamp(audio.durationSec)} · ${audio.method === "native" ? "browser" : "ffmpeg.wasm"}`
            : d.detail,
      progress: d.progress,
    },
    {
      id: "model",
      label: "Loading speech model",
      status: load.status,
      detail: loadDetail,
      progress: load.total > 0 ? load.loaded / load.total : undefined,
    },
    {
      id: "transcribe",
      label: "Transcribing",
      status: transcribe.status,
      detail: tDetail,
      progress: transcribe.total > 0 ? transcribe.done / transcribe.total : undefined,
    },
  ];
}

function JobView({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const audio = job.decode.audio;
  const transcribing = job.transcribe.status === "active";
  const showTranscript = job.transcribe.status !== "pending";

  return (
    <>
      <Card>
        <div className="mb-4 flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate font-medium">{job.file.name}</p>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {formatBytes(job.file.size)}
          </span>
          {transcribing && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          )}
        </div>
        <Steps steps={buildSteps(job)} />
        {audio && (
          <div
            data-testid="decode-result"
            data-method={audio.method}
            data-duration={audio.durationSec}
          >
            <Waveform pcm={audio.pcm} className="mt-5 h-16 text-indigo-500 dark:text-indigo-400" />
          </div>
        )}
        {job.decode.status === "error" && (
          <p className="sr-only" data-testid="decode-error">
            Couldn't read “{job.file.name}”: {job.decode.error}
          </p>
        )}
      </Card>

      {showTranscript && (
        <Card>
          <h2
            className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400"
            data-testid="transcript-status"
            data-status={job.transcribe.status}
          >
            Transcript
          </h2>
          <TranscriptView segments={job.segments} live={transcribing} />
        </Card>
      )}
    </>
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
