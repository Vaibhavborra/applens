import { FFFSType, FFmpeg } from "@ffmpeg/ffmpeg";

/**
 * ffmpeg.wasm is a lazy fallback for files the browser can't decode.
 *
 * The core (~32 MB wasm) is fetched from jsDelivr rather than bundled: Cloudflare
 * Pages rejects files over 25 MiB. jsDelivr sends ACAO/CORP headers, so this works
 * under our COEP: require-corp policy. We use the single-threaded core for
 * robustness; it doesn't need SharedArrayBuffer.
 */
const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
export const FFMPEG_DOWNLOAD_BYTES = 32_232_419;

export type FfmpegProgress =
  { stage: "loading"; received: number; total: number } | { stage: "converting"; ratio: number };

let instance: Promise<FFmpeg> | null = null;

function load(onProgress?: (p: FfmpegProgress) => void): Promise<FFmpeg> {
  instance ??= (async () => {
    const ffmpeg = new FFmpeg();
    const [coreURL, wasmURL] = await Promise.all([
      fetchBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      fetchBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm", (received) =>
        onProgress?.({
          stage: "loading",
          received,
          total: Math.max(received, FFMPEG_DOWNLOAD_BYTES),
        }),
      ),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });
    return ffmpeg;
  })().catch((err: unknown) => {
    instance = null; // allow retry after e.g. a network failure
    throw err;
  });
  return instance;
}

/**
 * Download to a blob: URL with progress. (@ffmpeg/util's toBlobURL compares
 * decompressed bytes against a compressed Content-Length and fails on CDNs that
 * gzip/brotli the wasm, so we report against the known uncompressed size.)
 */
async function fetchBlobURL(
  url: string,
  type: string,
  onProgress?: (received: number) => void,
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download ffmpeg (${res.status}).`);
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received);
  }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

let jobCounter = 0;

/** Extract audio as 16 kHz mono float32 PCM. Throws with ffmpeg's log tail on failure. */
export async function extractPcmWithFfmpeg(
  file: File,
  sampleRate: number,
  onProgress?: (p: FfmpegProgress) => void,
): Promise<Float32Array> {
  const ffmpeg = await load(onProgress);
  const dir = `/job${++jobCounter}`;
  const out = `${dir}-out.f32`;
  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
    if (logs.length > 30) logs.shift();
  };
  const onProg = ({ progress }: { progress: number }) =>
    onProgress?.({ stage: "converting", ratio: Math.min(1, Math.max(0, progress)) });

  ffmpeg.on("log", onLog);
  ffmpeg.on("progress", onProg);
  await ffmpeg.createDir(dir);
  // WORKERFS reads the File lazily instead of copying it into wasm memory,
  // which matters for multi-GB video files.
  await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, dir);
  try {
    const code = await ffmpeg.exec([
      "-i", `${dir}/${file.name}`,
      "-vn", "-ac", "1", "-ar", String(sampleRate),
      "-f", "f32le", out,
    ]); // prettier-ignore
    if (code !== 0) throw new FfmpegError(logs);
    const data = await ffmpeg.readFile(out);
    if (typeof data === "string") throw new FfmpegError(logs);
    await ffmpeg.deleteFile(out);
    // Copy into an aligned buffer; byteOffset isn't guaranteed to be a multiple of 4.
    return new Float32Array(data.slice().buffer, 0, Math.floor(data.byteLength / 4));
  } finally {
    ffmpeg.off("log", onLog);
    ffmpeg.off("progress", onProg);
    await ffmpeg.unmount(dir).catch(() => undefined);
    await ffmpeg.deleteDir(dir).catch(() => undefined);
  }
}

export class FfmpegError extends Error {
  readonly log: string[];
  constructor(log: string[]) {
    const text = log.join("\n");
    super(
      /does not contain any stream|matches no streams/i.test(text)
        ? "This file has no audio track."
        : "This file couldn't be read as audio or video. It may be corrupted or in an unsupported format.",
    );
    this.name = "FfmpegError";
    this.log = log;
  }
}
