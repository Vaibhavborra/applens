/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

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

export default defineConfig({
  plugins: [react(), tailwindcss(), dropUnusedOrtWasm()],
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
