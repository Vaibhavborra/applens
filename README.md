# Lecture Notes AI

Turn any lecture recording (mp3, mp4, m4a, wav, webm, mov…) into a timestamped transcript, notes, a summary, flashcards and semantic search — **entirely in your browser**. No backend, no API keys, $0 to host.

> Status: Phase 2 (decode audio/video → 16 kHz PCM + waveform). See [PLAN.md](PLAN.md) for the roadmap.

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

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind CSS v4 · Vitest · ESLint · Prettier
