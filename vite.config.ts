/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Cross-origin isolation enables SharedArrayBuffer (multi-threaded WASM for
// ffmpeg.wasm / onnxruntime). Mirrors public/_headers used by Cloudflare Pages.
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * onnxruntime-web references its ~27 MB wasm via `new URL(..., import.meta.url)`, so
 * Vite emits it, but Transformers.js points ORT at jsDelivr at runtime and never
 * requests the local copy. Dropping it keeps dist/ under Cloudflare Pages' 25 MiB
 * per-file limit.
 */
function dropUnusedOrtWasm(): Plugin {
  return {
    name: "drop-unused-ort-wasm",
    apply: "build",
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) {
        // Deleting from the bundle object is Rollup's documented way to drop an asset.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        if (/ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name];
      }
    },
  };
}

/**
 * Offline support. The app shell is precached (~1.5 MB). The WebLLM chunks
 * (~12 MB, only needed for in-browser notes) and the versioned CDN files
 * (ffmpeg core, onnxruntime wasm) are cached the first time they're used.
 * Models cache themselves (Transformers.js and WebLLM use Cache Storage).
 */
const pwa = VitePWA({
  registerType: "prompt",
  injectRegister: false,
  manifest: {
    name: "Lecture Notes AI",
    short_name: "Lecture Notes",
    description:
      "Turn any lecture recording into notes, flashcards and searchable timestamps, entirely in your browser.",
    theme_color: "#4f46e5",
    background_color: "#ffffff",
    display: "standalone",
    start_url: "/",
    icons: [
      { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
      { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,svg,png}"],
    globIgnores: ["**/llm*.js"],
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    navigateFallback: "/index.html",
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && /^\/assets\/llm[^/]*\.js$/.test(url.pathname),
        handler: "CacheFirst",
        options: { cacheName: "app-notes-engine", expiration: { maxEntries: 6 } },
      },
      {
        // Only version-pinned package URLs: their content never changes.
        urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[^/]+\/)?[^/@]+@\d[^/]*\//,
        handler: "CacheFirst",
        options: {
          cacheName: "cdn",
          expiration: { maxEntries: 40 },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), dropUnusedOrtWasm(), pwa],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: "es", plugins: () => [dropUnusedOrtWasm()] },
  // ffmpeg.wasm spawns its worker via new URL(..., import.meta.url); pre-bundling breaks that.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg"] },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
