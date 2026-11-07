import type { Job } from "@/app/job";
import type { DecodeProgress } from "@/lib/audio";
import { formatBytes } from "@/lib/format";
import { formatTimestamp } from "@/lib/time";
import { Steps, type StepView } from "./Steps";

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
    const speed = audio.durationSec / Math.max(0.001, transcribe.ms / 1000);
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

export function JobSteps({ job }: { job: Job }) {
  return <Steps steps={buildSteps(job)} />;
}
