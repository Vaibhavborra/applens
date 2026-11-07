# Lecture Notes AI

Turn any lecture recording (mp3, mp4, m4a, wav, webm, mov…) into a timestamped transcript, notes, a summary, flashcards and semantic search — **entirely in your browser**. No backend, no API keys, $0 to host.

> Status: Phase 3 (on-device Whisper transcription with live timestamped transcript). See [PLAN.md](PLAN.md) for the roadmap.

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

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind CSS v4 · Vitest · ESLint · Prettier
