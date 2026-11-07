import { useState } from "react";
import { detectCapabilities } from "@/lib/env";

export function App() {
  const [caps] = useState(detectCapabilities);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="font-semibold tracking-tight">Lecture Notes AI</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Lecture recordings → notes, flashcards, search.
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Everything runs on your device. Your audio never leaves the browser.
        </p>

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
