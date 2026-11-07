# Lecture Notes AI

Turn any lecture recording (mp3, mp4, m4a, wav, webm, mov…) into a timestamped transcript, notes, a summary, flashcards and semantic search — **entirely in your browser**. No backend, no API keys, $0 to host.

> Status: Phase 6 (on-device AI notes, summary, key terms and flashcards). See [PLAN.md](PLAN.md) for the roadmap.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest unit tests
npm run lint         # ESLint
npm run typecheck    # tsc (strict)
npm run format       # Prettier
npm run build        # production build → dist/
npm run e2e          # decode smoke test in your installed Chrome (playwright-core)
node scripts/e2e-transcribe.mjs <file> [--device=wasm] [--model=fast|balanced|best] [--expect=word,word]
node scripts/e2e-player.mjs <speech-file>   # seek, highlight, shortcuts, fallback playback
node scripts/e2e-persist.mjs <short-speech> <long-speech>   # save, reload, interrupt, delete
node scripts/e2e-notes.mjs <speech-file> [--model=fast|better] [--hp]   # AI notes (needs WebGPU)
```

## Deploy (Cloudflare Pages)

```bash
npm run build
npx wrangler login                 # first time only
npx wrangler pages deploy          # uses wrangler.toml → ./dist
```

Or connect the repo in the Cloudflare dashboard with build command `npm run build` and output directory `dist`.

`public/_headers` sets `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`, so the page is cross-origin isolated (`SharedArrayBuffer` → multi-threaded WASM). The Vite dev/preview servers send the same headers.

## Media decoding

Files are decoded with the browser's own decoder (`decodeAudioData` into a 16 kHz `OfflineAudioContext`). If that fails (e.g. .avi, .au, some .mkv/.mov), ffmpeg.wasm is loaded on demand from jsDelivr (~31 MB, cached by the browser after the first time) and reads the file via WORKERFS without copying it into wasm memory. The core isn't self-hosted because Cloudflare Pages caps files at 25 MiB.

## Transcription

Whisper runs in a Web Worker via Transformers.js, on WebGPU when the browser has a usable adapter, otherwise WebAssembly (`?device=wasm` forces the CPU path). Audio is split into ≤30 s windows cut at the quietest point between 20–30 s, so words aren't split and the transcript streams in window by window. Silent windows/segments are skipped to avoid Whisper's "Thank you." hallucinations.

| Quality  | Model                  | WebGPU download | WASM download | Measured (67 s clip, WebGPU) |
| -------- | ---------------------- | --------------- | ------------- | ---------------------------- |
| Fast     | whisper-base           | 206 MB          | 77 MB         | ~6–9× realtime               |
| Balanced | whisper-small          | 410 MB (fp16)   | 249 MB        | ~5× realtime                 |
| Best     | whisper-large-v3-turbo | 564 MB (fp16)   | —             | ~2× realtime                 |

Weights are cached in the browser after the first download. WASM (q8) ran Fast at ~6.7× realtime on the dev machine. Model and ONNX Runtime wasm files come from Hugging Face / jsDelivr (both CORS + CORP friendly, so they work under COEP).

## Playback

The original file plays in a `<video>` or `<audio>` element (audio-only video containers are detected and shown as audio). If the browser can't play the format, a WAV is built from the decoded audio so every file that decodes also plays. Click a transcript line or the waveform to seek; the line under the playhead is highlighted and kept in view (paused for a few seconds after you scroll yourself). Shortcuts: Space play/pause, ←/→ ±5 s.

## Saved lectures

Lectures live in IndexedDB (Dexie): `lectures` (metadata + waveform peaks), `segments` (written window-by-window as transcription runs, so a closed tab keeps what's done), and `media` (the original file, kept separate so listing lectures never loads blobs). Saving the recording is optional; without it you keep the transcript and can re-attach the file later. A tab running a job holds a Web Lock per lecture, so on startup only genuinely abandoned jobs are marked "interrupted" and can be transcribed again.

## AI notes

Notes are written by a small instruct model running on WebGPU via WebLLM (in a Web Worker): **Fast** = Qwen2.5 1.5B (~880 MB), **Better** = Qwen2.5 3B (~1.75 GB). Map-reduce keeps every prompt inside a 4K context:

1. **Map** – the transcript is split into ~500-token chunks (~1.5–2 min of speech) fed as `[m:ss] text` lines. Each chunk gets one grammar-constrained JSON call returning a title, timestamped bullets, key terms and flashcards. The schema's `minItems` scales with chunk length, which stops small models from summarising only the first idea. Invalid output is retried once, then falls back to plain-text bullets. Cited timestamps are clamped to the chunk.
2. **Reduce** – one call sees only part titles and top bullets and returns the lecture title, a summary and (for 4+ parts) a grouping of parts under headings, repaired if it's invalid. The final notes are assembled from the map output in code, so the reduce step can't drop content.

Measured on an RTX (Ampere) laptop GPU, 4.4-min lecture: Fast ≈ 50 s, Better ≈ 107 s (both after the model is cached).

**Integrated GPUs:** on an AMD Vega iGPU, WebLLM loses the WebGPU device on any prompt over ~300 tokens (Windows GPU watchdog), regardless of model size or precision. The app detects this and explains how to switch the browser to the dedicated GPU (Chrome on Windows ignores WebGPU's `powerPreference`; Windows' per-app Graphics setting decides). Transcription still works on iGPUs.

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind CSS v4 · Transformers.js · WebLLM · Dexie · Vitest · ESLint · Prettier
